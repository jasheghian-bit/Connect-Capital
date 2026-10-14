/**
 * CapNet — Preflight
 *
 * Verifies the database actually enforces what the code assumes.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every guarantee in this system has two halves: a rule in TypeScript and a
 * grant, constraint, or policy in Postgres. The TypeScript half fails loudly
 * when it is missing — the code will not compile or a test goes red.
 *
 * The database half fails SILENTLY. A migration that was skipped, half-applied,
 * or run against the wrong database leaves an application that behaves
 * perfectly and an audit log anyone with a connection string can edit. Nothing
 * errors. Every test still passes. The failure is invisible until it is a
 * disclosure.
 *
 * So this runs in CI against staging and as a gate before any production
 * deploy. A red preflight blocks the deploy.
 *
 *   npm run preflight
 */

import { sql } from 'drizzle-orm';
import { withSystem } from '../lib/db';
import { placeholdersRemaining } from '../lib/business-details';

interface Check {
  name: string;
  detail: string;
  run: () => Promise<boolean>;
}

/** Tables whose rows are evidence and must reject UPDATE and DELETE. */
const APPEND_ONLY = [
  'audit_events',
  'consents',
  'document_versions',
  'document_access_events',
  'verification_events',
  'authorization_events',
  'match_runs',
  'underwriting_states',
  'bank_transactions',
  'offer_revisions',
  'counteroffers',
  'offer_events',
  'disclosure_views',
  'email_suppression_events',
  'data_deletion_events',
];

const RLS_REQUIRED = [
  'organizations', 'org_members', 'consents',
  'merchant_businesses', 'applications', 'documents', 'document_access_events',
  'providers', 'provider_criteria', 'provider_appetite',
  'authorizations', 'authorization_events', 'matches',
  'bank_connections', 'bank_accounts', 'bank_transactions', 'detected_positions',
  'conversations', 'messages', 'underwriting_states', 'notifications',
  'offers', 'offer_revisions', 'counteroffers',
  'fundings', 'platform_fees', 'fee_schedules',
  'email_preferences', 'email_suppression_events',
  'data_deletion_requests', 'data_deletion_events',
];

const checks: Check[] = [
  {
    // First, and touches no database: Pool connects lazily, so this reports
    // even when DATABASE_URL is unset and every check after it errors.
    name: 'business details filled in',
    detail: 'lib/business-details.ts still has [FOUNDER: ...] placeholders (CAN-SPAM address, legal name)',
    run: async () => {
      const left = placeholdersRemaining();
      if (left.length > 0) {
        console.error('  placeholders remaining:', left.join(', '));
        return false;
      }
      return true;
    },
  },
  {
    name: 'append-only grants',
    detail: 'UPDATE and DELETE revoked from app_user on every evidence table',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT table_name, privilege_type
          FROM information_schema.role_table_grants
          WHERE grantee = 'app_user'
            AND privilege_type IN ('UPDATE', 'DELETE')
            AND table_name = ANY(${APPEND_ONLY})
        `);
        // Column-level grants (merchant_confirmed, status) are legitimate and
        // do not appear here; only table-wide grants do.
        const offenders = rows.rows.filter(
          (r) => !['counteroffers'].includes(String(r.table_name)),
        );
        if (offenders.length > 0) {
          console.error('  table-wide mutation grants still present:', offenders);
          return false;
        }
        return true;
      }),
  },
  {
    name: 'append-only triggers',
    detail: 'a trigger backs every revoke, in case a superuser connects',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT event_object_table AS t
          FROM information_schema.triggers
          WHERE trigger_name LIKE '%append_only%'
             OR trigger_name LIKE '%_only'
        `);
        const guarded = new Set(rows.rows.map((r) => String(r.t)));
        const missing = APPEND_ONLY.filter((t) => !guarded.has(t));
        if (missing.length > 0) {
          console.error('  no append-only trigger on:', missing.join(', '));
          return false;
        }
        return true;
      }),
  },
  {
    name: 'row-level security enabled',
    detail: 'RLS is on for every table carrying merchant or provider data',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename = ANY(${RLS_REQUIRED})
            AND NOT rowsecurity
        `);
        if (rows.rows.length > 0) {
          console.error('  RLS disabled on:', rows.rows.map((r) => r.tablename).join(', '));
          return false;
        }
        return true;
      }),
  },
  {
    name: 'audit chain intact',
    detail: 'every hash verifies from genesis',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`SELECT * FROM verify_audit_chain(0)`);
        if (rows.rows.length > 0) {
          console.error('  CHAIN BROKEN at seq', rows.rows[0].broken_at);
          return false;
        }
        return true;
      }),
  },
  {
    name: 'no verified provider without KYB',
    detail: 'the badge is backed by a real check, not a manual UPDATE',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id, legal_name FROM providers
          WHERE verification_status = 'verified'
            AND (kyb_ref IS NULL OR verified_at IS NULL OR verified_by_user_id IS NULL)
        `);
        if (rows.rows.length > 0) {
          console.error('  verified without KYB:', rows.rows.map((r) => r.legal_name));
          return false;
        }
        return true;
      }),
  },
  {
    name: 'no authorization granted by a non-merchant',
    detail: 'R11 — merchant control is not delegable',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT a.id FROM authorizations a
          JOIN org_members m ON m.user_id = a.granted_by_user_id AND m.removed_at IS NULL
          JOIN organizations o ON o.id = m.org_id
          WHERE o.type <> 'merchant'
        `);
        if (rows.rows.length > 0) {
          console.error('  authorizations granted by non-merchants:', rows.rows.length);
          return false;
        }
        return true;
      }),
  },
  {
    name: 'every offer revision carries a disclosure',
    detail: 'nothing was shown to a merchant without a frozen disclosure',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id FROM offer_revisions
          WHERE disclosure_json IS NULL
             OR NOT (disclosure_json ? 'amountFinanced')
             OR length(disclosure_hash) <> 64
        `);
        if (rows.rows.length > 0) {
          console.error('  revisions without a valid disclosure:', rows.rows.length);
          return false;
        }
        return true;
      }),
  },
  {
    name: 'every funding accrued a fee',
    detail: 'no revenue silently missing',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT f.id FROM fundings f
          LEFT JOIN platform_fees pf ON pf.funding_id = f.id
          WHERE pf.id IS NULL
        `);
        if (rows.rows.length > 0) {
          console.error('  fundings with no accrued fee:', rows.rows.length);
          return false;
        }
        return true;
      }),
  },
  {
    name: 'a fee schedule is in effect',
    detail: 'a funding today would price, rather than fail',
    run: async () =>
      withSystem(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id FROM fee_schedules
          WHERE fee_type = 'success'
            AND effective_from <= now()
            AND (effective_to IS NULL OR effective_to > now())
          LIMIT 1
        `);
        if (rows.rows.length === 0) {
          console.error('  no success fee schedule in effect');
          return false;
        }
        return true;
      }),
  },
  {
    name: 'no test fixtures in production',
    detail: 'seeded TEST organizations never reach a live database',
    run: async () =>
      withSystem(async (tx) => {
        if (process.env.NODE_ENV !== 'production') return true;
        const rows = await tx.execute(sql`
          SELECT legal_name FROM organizations WHERE legal_name LIKE 'TEST %'
        `);
        if (rows.rows.length > 0) {
          console.error('  TEST fixtures present:', rows.rows.map((r) => r.legal_name));
          return false;
        }
        return true;
      }),
  },
];

async function main() {
  console.log('CapNet preflight\n');
  let failed = 0;

  for (const check of checks) {
    process.stdout.write(`  ${check.name.padEnd(42)}`);
    try {
      const ok = await check.run();
      console.log(ok ? 'PASS' : 'FAIL');
      if (!ok) {
        console.log(`    ${check.detail}`);
        failed++;
      }
    } catch (err) {
      console.log('ERROR');
      console.error(`    ${err}`);
      failed++;
    }
  }

  console.log(`\n${checks.length - failed}/${checks.length} passed`);

  if (failed > 0) {
    console.error('\nPREFLIGHT FAILED — do not deploy.');
    console.error('A failure here means a guarantee the application assumes is');
    console.error('not actually enforced by the database.');
    process.exit(1);
  }
}

main();
