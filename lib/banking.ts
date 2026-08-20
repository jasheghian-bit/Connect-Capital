/**
 * Connect Capital — Banking service
 *
 * Connection lifecycle and the sync job that turns raw transactions into
 * everything downstream: underwriting metrics, position detection, stacking
 * signals, renewal timing, and re-eligibility.
 *
 * ── CONSENT IS LAYERED ─────────────────────────────────────────────────────
 *
 * The merchant consents to Connect Capital reading the account. That is a
 * different grant from any funder seeing what it produced, which is a
 * different grant again from raw transaction detail — which no funder ever
 * receives. A funder sees `financial_profiles`: normalized metrics, no
 * counterparties, no customer list, no vendor list.
 *
 * ── R12 ────────────────────────────────────────────────────────────────────
 *
 * No specialist or platform employee ever handles bank credentials. Linking is
 * initiated from the merchant's own session; this module only ever sees a
 * token the aggregator already issued.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bankConnections,
  bankAccounts,
  bankTransactions,
  detectedPositions,
  financingSignals,
} from '../db/banking';
import { consents } from '../db/kernel';
import { financialProfiles, applications, merchantBusinesses } from '../db/merchant';
import {
  computeMetrics,
  detectPositions,
  inferAdvance,
  isRevenueDeposit,
  type BankTransaction,
} from './bank-analysis';
import { mutate } from './audit';
import { withActor, withSystem, type Tx } from './db';
import { authorize, type Actor } from './policy';

export interface AggregatorAccount {
  aggregatorAccountId: string;
  mask: string | null;
  name: string | null;
  subtype: string | null;
  currentBalance: number | null;
}

export interface AggregatorTransaction {
  aggregatorTxId: string;
  accountId: string;
  postedDate: string;
  amount: number;
  description: string;
  balanceAfter: number | null;
  category: string | null;
}

export interface Aggregator {
  exchangePublicToken(publicToken: string): Promise<{ itemToken: string; institutionName: string }>;
  listAccounts(itemToken: string): Promise<AggregatorAccount[]>;
  listTransactions(itemToken: string, since: string): Promise<AggregatorTransaction[]>;
  revoke(itemToken: string): Promise<void>;
}

/**
 * Completes a link the merchant started in their own browser. The public token
 * is single-use and useless without the server secret, which is the reason the
 * exchange happens here rather than client-side.
 */
export async function connectBank(
  actor: Actor,
  input: {
    businessId: string;
    publicToken: string;
    consentTextVersion: string;
    consentTextHash: string;
  },
  aggregator: Aggregator,
  ctx: { ip?: string; userAgent?: string },
): Promise<string> {
  if (actor.orgType !== 'merchant') {
    throw new Error('only the merchant may connect their own bank');
  }

  const { itemToken, institutionName } = await aggregator.exchangePublicToken(
    input.publicToken,
  );
  const accounts = await aggregator.listAccounts(itemToken);

  return mutate(
    actor,
    'create',
    {
      kind: 'application',
      id: input.businessId,
      merchantOrgId: actor.orgId,
      status: 'draft',
    },
    {
      action: 'bank.connected',
      objectType: 'bank_connection',
      metadata: { institutionName, accountCount: accounts.length },
    },
    ctx,
    async (tx) => {
      const [consent] = await tx
        .insert(consents)
        .values({
          consentType: 'bank_connection',
          subjectType: 'business',
          subjectId: input.businessId,
          textVersion: input.consentTextVersion,
          textHash: input.consentTextHash,
          acceptedByUserId: actor.userId,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        })
        .returning({ id: consents.id });

      const [conn] = await tx
        .insert(bankConnections)
        .values({
          businessId: input.businessId,
          aggregator: 'plaid',
          itemToken,
          institutionName,
          status: 'active',
          consentId: consent.id,
          connectedByUserId: actor.userId,
        })
        .returning({ id: bankConnections.id });

      for (const a of accounts) {
        await tx.insert(bankAccounts).values({
          connectionId: conn.id,
          aggregatorAccountId: a.aggregatorAccountId,
          mask: a.mask,
          name: a.name,
          subtype: a.subtype,
          currentBalance: a.currentBalance === null ? null : String(a.currentBalance),
          // Depository accounts default in; savings and credit lines don't,
          // because a savings transfer read as revenue inflates the file.
          includedInAnalysis: a.subtype === 'checking' || a.subtype === null,
        });
      }

      return conn.id;
    },
  );
}

/**
 * Immediate and total. Revocation at the aggregator is attempted first — if it
 * fails, the local record is still marked revoked, because a merchant who
 * clicked disconnect should not depend on a third party's uptime for that to
 * be true.
 */
export async function disconnectBank(
  actor: Actor,
  connectionId: string,
  aggregator: Aggregator,
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  const [conn] = await withActor(actor, (tx) =>
    tx.select().from(bankConnections).where(eq(bankConnections.id, connectionId)).limit(1),
  );
  if (!conn) throw new Error('connection not found');

  try {
    await aggregator.revoke(conn.itemToken);
  } catch (err) {
    console.error('[banking] aggregator revoke failed, revoking locally', err);
  }

  await mutate(
    actor,
    'revoke',
    {
      kind: 'application',
      id: conn.businessId,
      merchantOrgId: actor.orgId,
      status: 'draft',
    },
    {
      action: 'bank.disconnected',
      objectType: 'bank_connection',
      objectId: connectionId,
    },
    ctx,
    async (tx) => {
      await tx
        .update(bankConnections)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(eq(bankConnections.id, connectionId));
    },
  );
}

export interface SyncResult {
  transactionsAdded: number;
  metricsComputed: boolean;
  positionsDetected: number;
  signalsEmitted: string[];
}

/**
 * Background job. Runs as system because there is no actor — the merchant
 * connected once and this fires on a schedule for months afterwards, which is
 * precisely what makes renewal timing and circumvention detection possible.
 */
export async function syncConnection(
  connectionId: string,
  aggregator: Aggregator,
  since?: string,
): Promise<SyncResult> {
  return withSystem(async (tx) => {
    const [conn] = await tx
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, connectionId))
      .limit(1);

    if (!conn || conn.status !== 'active') {
      return { transactionsAdded: 0, metricsComputed: false, positionsDetected: 0, signalsEmitted: [] };
    }

    const accounts = await tx
      .select()
      .from(bankAccounts)
      .where(
        and(eq(bankAccounts.connectionId, connectionId), eq(bankAccounts.includedInAnalysis, true)),
      );

    const byAggregatorId = new Map(accounts.map((a) => [a.aggregatorAccountId, a.id]));
    const lookback =
      since ?? new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);

    let added = 0;
    try {
      const incoming = await aggregator.listTransactions(conn.itemToken, lookback);

      for (const t of incoming) {
        const accountId = byAggregatorId.get(t.accountId);
        if (!accountId) continue;

        const result = await tx
          .insert(bankTransactions)
          .values({
            accountId,
            aggregatorTxId: t.aggregatorTxId,
            postedDate: t.postedDate,
            amount: String(t.amount),
            description: t.description,
            balanceAfter: t.balanceAfter === null ? null : String(t.balanceAfter),
            category: t.category,
            isRevenueDeposit: isRevenueDeposit({
              id: t.aggregatorTxId,
              postedDate: t.postedDate,
              amount: t.amount,
              description: t.description,
              balanceAfter: t.balanceAfter,
            }),
          })
          .onConflictDoNothing()
          .returning({ id: bankTransactions.id });

        added += result.length;
      }
    } catch (err) {
      await tx
        .update(bankConnections)
        .set({ status: 'reauth_required', lastError: String(err) })
        .where(eq(bankConnections.id, connectionId));
      return { transactionsAdded: 0, metricsComputed: false, positionsDetected: 0, signalsEmitted: [] };
    }

    const txs = await loadTransactions(tx, accounts.map((a) => a.id));
    const metrics = computeMetrics(txs);
    const positions = detectPositions(txs);
    const signals: string[] = [];

    if (metrics) {
      const [openApp] = await tx
        .select({ id: applications.id })
        .from(applications)
        .innerJoin(merchantBusinesses, eq(merchantBusinesses.id, applications.businessId))
        .where(
          and(
            eq(merchantBusinesses.id, conn.businessId),
            sql`${applications.status} NOT IN ('funded','withdrawn','expired','declined')`,
          ),
        )
        .orderBy(desc(applications.createdAt))
        .limit(1);

      if (openApp) {
        await tx.insert(financialProfiles).values({
          applicationId: openApp.id,
          source: 'bank_link',
          periodStart: metrics.periodStart,
          periodEnd: metrics.periodEnd,
          monthsCovered: Math.round(metrics.monthsCovered),
          avgMonthlyRevenue: String(metrics.avgMonthlyRevenue),
          avgDailyBalance:
            metrics.avgDailyBalance === null ? null : String(metrics.avgDailyBalance),
          negativeDays: metrics.negativeDays,
          nsfCount: metrics.nsfCount,
          depositCount: metrics.depositCount,
          confidence: 'verified',
        });
      }
    }

    for (const p of positions) {
      const advance = inferAdvance(p, txs);

      await tx.insert(detectedPositions).values({
        businessId: conn.businessId,
        counterparty: p.counterparty,
        paymentAmount: String(p.paymentAmount),
        frequency: p.frequency,
        occurrences: p.occurrences,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        totalPaid: String(p.totalPaid),
        confidence: String(p.confidence),
        inferredAdvanceAmount:
          advance.advanceAmount === null ? null : String(advance.advanceAmount),
        inferredAdvanceDate: advance.advanceDate,
        impliedFactor: advance.impliedFactor === null ? null : String(advance.impliedFactor),
        paydownProgress:
          advance.paydownProgress === null ? null : String(advance.paydownProgress),
      });

      if (advance.renewalEligible) {
        await emitSignal(tx, conn.businessId, 'renewal_eligible', p.confidence, {
          counterparty: p.counterparty,
          paydownProgress: advance.paydownProgress,
        });
        signals.push('renewal_eligible');
      }

      // A new advance the platform did not originate. Not proof of
      // circumvention — the merchant is free to borrow anywhere — but it is
      // the evidence that makes an anti-circumvention clause enforceable,
      // and it is invisible without a bank connection.
      const startedRecently =
        Date.now() - new Date(p.firstSeen).getTime() < 45 * 86400000;

      if (startedRecently && advance.advanceAmount) {
        await emitSignal(
          tx,
          conn.businessId,
          'off_platform_funding_suspected',
          p.confidence,
          {
            counterparty: p.counterparty,
            advanceAmount: advance.advanceAmount,
            advanceDate: advance.advanceDate,
          },
        );
        signals.push('off_platform_funding_suspected');
      }
    }

    if (positions.length > 1) {
      await emitSignal(tx, conn.businessId, 'detected_position', positions[0].confidence, {
        positionCount: positions.length,
        totalMonthlyBurden: positions.reduce(
          (s, p) => s + p.paymentAmount * (p.frequency === 'daily' ? 21.7 : 4.33),
          0,
        ),
      });
      signals.push('detected_position');
    }

    await tx
      .update(bankConnections)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(bankConnections.id, connectionId));

    return {
      transactionsAdded: added,
      metricsComputed: metrics !== null,
      positionsDetected: positions.length,
      signalsEmitted: signals,
    };
  });
}

async function emitSignal(
  tx: Tx,
  businessId: string,
  signalType: 'renewal_eligible' | 'off_platform_funding_suspected' | 'detected_position' | 're_eligible',
  confidence: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const existing = await tx
    .select({ id: financingSignals.id })
    .from(financingSignals)
    .where(
      and(
        eq(financingSignals.businessId, businessId),
        eq(financingSignals.signalType, signalType),
        isNull(financingSignals.resolvedAt),
      ),
    )
    .limit(1);

  // Signals are conditions, not events. Re-raising an open signal every night
  // would bury trust & safety in duplicates of the same finding.
  if (existing.length > 0) return;

  await tx.insert(financingSignals).values({
    businessId,
    signalType,
    source: 'bank_analysis',
    confidence: String(confidence),
    metadataJson: metadata,
  });
}

async function loadTransactions(tx: Tx, accountIds: string[]): Promise<BankTransaction[]> {
  if (accountIds.length === 0) return [];

  const rows = await tx
    .select()
    .from(bankTransactions)
    .where(inArray(bankTransactions.accountId, accountIds))
    .orderBy(bankTransactions.postedDate);

  return rows.map((r) => ({
    id: r.id,
    postedDate: r.postedDate,
    amount: Number(r.amount),
    description: r.description,
    balanceAfter: r.balanceAfter === null ? null : Number(r.balanceAfter),
    category: r.category ?? undefined,
  }));
}

/**
 * Detections shown to the merchant for confirmation before they reach a
 * funder. A false positive here tells a funder the merchant is stacked when
 * they are not, which costs that merchant an approval — so the merchant gets
 * the last word.
 */
export async function unconfirmedPositions(actor: Actor, businessId: string) {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  return withActor(actor, (tx) =>
    tx
      .select()
      .from(detectedPositions)
      .where(
        and(
          eq(detectedPositions.businessId, businessId),
          isNull(detectedPositions.merchantConfirmed),
        ),
      )
      .orderBy(desc(detectedPositions.confidence)),
  );
}
