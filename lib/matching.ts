/**
 * Connect Capital — Matching engine
 *
 * Assembly, not new logic. Grading and criteria evaluation are pure, tested,
 * and live elsewhere; this decides the ORDER things are checked in and what
 * gets written down.
 *
 * ── GATE ORDER MATTERS ─────────────────────────────────────────────────────
 *
 * Suppression gates run BEFORE criteria evaluation:
 *
 *   1. verification   — an unverified funder is invisible, never shown with a
 *                       warning. A merchant should not be choosing between
 *                       vouched and un-vouched counterparties.
 *   2. registration   — jurisdiction gate. Several states now require
 *                       registration for sales-based financing on staggered
 *                       dates; showing an unregistered funder in a state that
 *                       requires one is a compliance problem, not a fit one.
 *   3. appetite       — paused this week, or paused for this industry.
 *   4. product        — do they even offer what was asked for.
 *   5. criteria       — only now, does this file fit their box.
 *
 * The order is not cosmetic. A suppressed provider and a criteria-failed
 * provider look identical to a merchant and mean completely different things
 * to the business: one is a data or compliance problem the platform owns, the
 * other is a genuine mismatch. Recording which is which is how you find out
 * that half your "no matches" outcomes were a lapsed registration.
 *
 * ── NARROW BEATS BROAD ─────────────────────────────────────────────────────
 *
 * A D-paper merchant shown twelve funders wastes eleven underwriters' time and
 * teaches all of them that Connect Capital sends junk. Match precision is a
 * funder-retention feature, so results are capped and ranked.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { matchRuns, matches } from '../db/matching';
import { applications, financialProfiles, existingObligations, merchantBusinesses } from '../db/merchant';
import { providers, providerCriteria, providerProducts, providerAppetite } from '../db/provider';
import { gradeFile, RUBRIC_VERSION, type GradingInput } from './grading';
import {
  scoreProvider,
  explainForMerchant,
  type Criterion,
  type ApplicantProfile,
  type CriterionKey,
  type Operator,
} from './criteria';
import { mutate } from './audit';
import { withActor, type Tx } from './db';
import type { Actor } from './policy';

export const RULESET_VERSION = 'mca-match-v1';

/** How many providers a merchant is shown. Deliberately not "all of them". */
const MAX_RESULTS = 8;

export interface MatchRunResult {
  matchRunId: string;
  grade: string;
  gradeScore: number;
  insufficientData: boolean;
  results: Array<{
    providerId: string;
    result: 'match' | 'possible' | 'no_match';
    score: number;
    reasons: string[];
    suppressedReason: string | null;
  }>;
}

export async function runMatching(
  actor: Actor,
  applicationId: string,
  requiredRegistrationTypes: Record<string, string[]>,
  ctx: { ip?: string; userAgent?: string },
): Promise<MatchRunResult> {
  return mutate(
    actor,
    'update',
    {
      kind: 'application',
      id: applicationId,
      merchantOrgId: actor.orgId,
      status: 'matching',
    },
    {
      action: 'matching.run',
      objectType: 'application',
      objectId: applicationId,
      applicationId,
    },
    ctx,
    async (tx) => {
      const context = await loadApplicantContext(tx, applicationId);
      const grade = gradeFile(context.grading);

      const [run] = await tx
        .insert(matchRuns)
        .values({
          applicationId,
          rulesetVersion: RULESET_VERSION,
          rubricVersion: RUBRIC_VERSION,
          grade: grade.grade,
          gradeScore: grade.score,
          inputsSnapshotJson: context.profile as Record<string, unknown>,
          gradeFactorsJson: grade.factors,
          providersEvaluated: 0,
        })
        .returning({ id: matchRuns.id });

      const candidates = await loadCandidateProviders(tx);
      const evaluated: MatchRunResult['results'] = [];

      for (const provider of candidates) {
        const suppressed = suppressionReason(
          provider,
          context.state,
          context.naics,
          context.requestedAmount,
          context.productType,
          requiredRegistrationTypes[context.state] ?? [],
        );

        if (suppressed) {
          evaluated.push({
            providerId: provider.id,
            result: 'no_match',
            score: 0,
            reasons: [],
            suppressedReason: suppressed,
          });
          continue;
        }

        const outcome = scoreProvider(provider.criteria, context.profile);
        evaluated.push({
          providerId: provider.id,
          result: outcome.result,
          score: outcome.score,
          reasons: outcome.results.map(explainForMerchant),
          suppressedReason: null,
        });
      }

      // Every evaluation is persisted, including the misses. The misses are
      // where you learn that a whole state is dark because one registration
      // lapsed, and they are invisible if only the hits are stored.
      if (evaluated.length > 0) {
        await tx.insert(matches).values(
          evaluated.map((e) => ({
            matchRunId: run.id,
            applicationId,
            providerId: e.providerId,
            result: e.result,
            score: e.score,
            reasonsJson: e.reasons,
            suppressedReason: e.suppressedReason,
          })),
        );
      }

      await tx
        .update(matchRuns)
        .set({ providersEvaluated: evaluated.length })
        .where(eq(matchRuns.id, run.id));

      await tx
        .update(applications)
        .set({
          status: 'authorizing',
          grade: grade.grade,
          rulesetVersion: RULESET_VERSION,
        })
        .where(eq(applications.id, applicationId));

      const shown = evaluated
        .filter((e) => e.result !== 'no_match')
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);

      return {
        matchRunId: run.id,
        grade: grade.grade,
        gradeScore: grade.score,
        insufficientData: grade.insufficientData,
        results: shown,
      };
    },
  );
}

function suppressionReason(
  provider: CandidateProvider,
  state: string,
  naics: string | null,
  amount: number,
  productType: string,
  requiredRegistrations: string[],
): string | null {
  if (provider.verificationStatus !== 'verified') return 'provider_not_verified';

  const missing = requiredRegistrations.filter(
    (t) => !provider.registrations.some((r) => r.jurisdiction === state && r.type === t),
  );
  if (missing.length > 0) return `registration_missing:${state}:${missing.join(',')}`;

  if (!provider.accepting) return 'appetite_paused';
  if (naics && provider.pausedIndustries.includes(naics)) return 'industry_paused';
  if (provider.pausedStates.includes(state)) return 'state_paused';

  const product = provider.products.find((p) => p.productType === productType && p.active);
  if (!product) return 'product_not_offered';
  if (amount < product.minAmount || amount > product.maxAmount) {
    return 'amount_outside_product_range';
  }

  return null;
}

interface CandidateProvider {
  id: string;
  verificationStatus: string;
  accepting: boolean;
  pausedIndustries: string[];
  pausedStates: string[];
  products: Array<{ productType: string; minAmount: number; maxAmount: number; active: boolean }>;
  registrations: Array<{ jurisdiction: string; type: string }>;
  criteria: Criterion[];
}

async function loadCandidateProviders(tx: Tx): Promise<CandidateProvider[]> {
  const rows = await tx
    .select({
      id: providers.id,
      verificationStatus: providers.verificationStatus,
      accepting: providerAppetite.accepting,
      pausedIndustries: providerAppetite.pausedIndustriesJson,
      pausedStates: providerAppetite.pausedStatesJson,
    })
    .from(providers)
    .leftJoin(providerAppetite, eq(providerAppetite.providerId, providers.id));

  const out: CandidateProvider[] = [];

  for (const r of rows) {
    const products = await tx
      .select()
      .from(providerProducts)
      .where(eq(providerProducts.providerId, r.id));

    const criteriaRows = await tx
      .select()
      .from(providerCriteria)
      .where(
        and(
          eq(providerCriteria.providerId, r.id),
          eq(providerCriteria.active, true),
          isNull(providerCriteria.effectiveTo),
        ),
      );

    out.push({
      id: r.id,
      verificationStatus: r.verificationStatus,
      // A provider who has never set appetite is assumed open. Requiring an
      // explicit opt-in would silently blank a new funder's queue on day one.
      accepting: r.accepting ?? true,
      pausedIndustries: r.pausedIndustries ?? [],
      pausedStates: r.pausedStates ?? [],
      products: products.map((p) => ({
        productType: p.productType,
        minAmount: Number(p.minAmount),
        maxAmount: Number(p.maxAmount),
        active: p.active,
      })),
      registrations: [],
      criteria: criteriaRows.map((c) => ({
        key: c.criterionKey as CriterionKey,
        operator: c.operator as Operator,
        value: c.valueJson as number | string | Array<number | string>,
        isHard: c.isHard,
        weight: c.weight,
        requiresVerified: c.requiresVerified,
      })),
    });
  }

  return out;
}

interface ApplicantContext {
  profile: ApplicantProfile;
  grading: GradingInput;
  state: string;
  naics: string | null;
  requestedAmount: number;
  productType: string;
}

async function loadApplicantContext(
  tx: Tx,
  applicationId: string,
): Promise<ApplicantContext> {
  const [app] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  if (!app) throw new Error('application not found');

  const [business] = await tx
    .select()
    .from(merchantBusinesses)
    .where(eq(merchantBusinesses.id, app.businessId))
    .limit(1);

  const [fin] = await tx
    .select()
    .from(financialProfiles)
    .where(eq(financialProfiles.applicationId, applicationId))
    .orderBy(sql`${financialProfiles.computedAt} DESC`)
    .limit(1);

  const positions = await tx
    .select()
    .from(existingObligations)
    .where(eq(existingObligations.applicationId, applicationId));

  const confidence = (fin?.confidence ?? 'stated') as 'verified' | 'parsed' | 'stated';
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const tib = business?.inceptionDate
    ? Math.floor(
        (Date.now() - new Date(business.inceptionDate).getTime()) /
          (1000 * 60 * 60 * 24 * 30.44),
      )
    : null;

  const profile: ApplicantProfile = {
    amount: { value: Number(app.requestedAmount), confidence: 'stated' },
    monthly_revenue: { value: num(fin?.avgMonthlyRevenue), confidence },
    avg_daily_balance: { value: num(fin?.avgDailyBalance), confidence },
    negative_days: { value: fin?.negativeDays ?? null, confidence },
    nsf_count: { value: fin?.nsfCount ?? null, confidence },
    months_covered: { value: fin?.monthsCovered ?? null, confidence },
    time_in_business_months: { value: tib, confidence: 'stated' },
    position_count: { value: positions.length, confidence },
    state: { value: business?.state ?? null, confidence: 'stated' },
    naics: { value: business?.naicsCode ?? null, confidence: 'stated' },
  };

  return {
    profile,
    grading: {
      avgMonthlyRevenue: num(fin?.avgMonthlyRevenue),
      avgDailyBalance: num(fin?.avgDailyBalance),
      timeInBusinessMonths: tib,
      negativeDays: fin?.negativeDays ?? null,
      nsfCount: fin?.nsfCount ?? null,
      depositCount: fin?.depositCount ?? null,
      monthsCovered: fin?.monthsCovered ?? null,
      positionCount: positions.length,
      confidence,
    },
    state: business?.state ?? '',
    naics: business?.naicsCode ?? null,
    requestedAmount: Number(app.requestedAmount),
    productType: app.productType,
  };
}

/** The merchant's match preview. Only what they're actually shown. */
export async function matchesForMerchant(actor: Actor, applicationId: string) {
  return withActor(actor, (tx) =>
    tx
      .select({
        providerId: matches.providerId,
        result: matches.result,
        score: matches.score,
        reasons: matches.reasonsJson,
      })
      .from(matches)
      .where(
        and(
          eq(matches.applicationId, applicationId),
          sql`${matches.suppressedReason} IS NULL`,
          sql`${matches.result} <> 'no_match'`,
        ),
      )
      .orderBy(sql`${matches.score} DESC`)
      .limit(MAX_RESULTS),
  );
}
