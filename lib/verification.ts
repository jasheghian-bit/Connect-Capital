/**
 * CapNet — Provider verification
 *
 * The verified badge is the product. A merchant authorizes a funder partly
 * because CapNet vouched for them, which means the badge carries the
 * platform's liability and its brand.
 *
 * Two rules make it real rather than decorative:
 *
 *   1. 'verified' is unreachable without a KYB vendor reference. Enforced by
 *      CHECK constraint in 0003, not by discipline here.
 *   2. Every decision carries a written reason and is appended to an
 *      immutable log. There is no silent approval and no silent offboarding.
 *
 * Verification is an operating expense with headcount attached, not a column.
 * This module is the workflow around the humans doing that work.
 */

import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import {
  providers,
  providerRegistrations,
  providerAppetite,
  verificationEvents,
} from '../db/provider';
import { organizations } from '../db/kernel';
import { mutate } from './audit';
import { withActor } from './db';
import { authorize, type Actor } from './policy';

export interface KybResult {
  vendorRef: string;
  entityFound: boolean;
  entityActive: boolean;
  nameMatches: boolean;
  officers: string[];
  watchlistHits: string[];
  raw: Record<string, unknown>;
}

export interface KybProvider {
  check(legalName: string, jurisdiction: string): Promise<KybResult>;
}

/**
 * Runs the KYB check and files the result. Deliberately does NOT decide.
 *
 * An automatic approve-on-clean would be faster and wrong: a clean KYB means
 * the entity exists and is in good standing, which is the floor, not the bar.
 * The bar includes a signed participation agreement, a look at how they treat
 * merchants, and a judgment about whether CapNet wants its name next
 * to theirs. None of that is in a vendor response.
 */
export async function runKybCheck(
  actor: Actor,
  providerId: string,
  jurisdiction: string,
  kyb: KybProvider,
  ctx: { ip?: string; userAgent?: string },
): Promise<KybResult> {
  authorize(actor, 'administer', { kind: 'platform_governance' });

  const [provider] = await withActor(actor, (tx) =>
    tx.select().from(providers).where(eq(providers.id, providerId)).limit(1),
  );
  if (!provider) throw new Error('provider not found');

  const result = await kyb.check(provider.legalName, jurisdiction);

  await mutate(
    actor,
    'administer',
    { kind: 'platform_governance' },
    {
      action: 'provider.kyb_checked',
      objectType: 'provider',
      objectId: providerId,
      metadata: {
        vendorRef: result.vendorRef,
        entityFound: result.entityFound,
        watchlistHitCount: result.watchlistHits.length,
      },
    },
    ctx,
    async (tx) => {
      await tx
        .update(providers)
        .set({ kybRef: result.vendorRef, verificationStatus: 'pending' })
        .where(eq(providers.id, providerId));
    },
  );

  return result;
}

export type VerificationDecision = 'verified' | 'suspended' | 'offboarded' | 'unverified';

/**
 * `reason` is required by the signature, not by convention. Six months from
 * now, "why is this funder on our platform" needs an answer that isn't
 * someone's memory.
 */
export async function decideVerification(
  actor: Actor,
  input: {
    providerId: string;
    decision: VerificationDecision;
    reason: string;
    kybSummary?: Record<string, unknown>;
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  authorize(actor, 'administer', { kind: 'platform_governance' });

  if (!input.reason || input.reason.trim().length < 10) {
    throw new Error('a substantive reason is required for every decision');
  }

  const [provider] = await withActor(actor, (tx) =>
    tx.select().from(providers).where(eq(providers.id, input.providerId)).limit(1),
  );
  if (!provider) throw new Error('provider not found');

  if (input.decision === 'verified' && !provider.kybRef) {
    throw new Error('cannot verify without a completed KYB check');
  }

  await mutate(
    actor,
    'administer',
    { kind: 'platform_governance' },
    {
      action: `provider.${input.decision}`,
      objectType: 'provider',
      objectId: input.providerId,
      metadata: { from: provider.verificationStatus, reason: input.reason },
    },
    ctx,
    async (tx) => {
      await tx.insert(verificationEvents).values({
        providerId: input.providerId,
        fromStatus: provider.verificationStatus,
        toStatus: input.decision,
        reason: input.reason,
        kybRef: provider.kybRef,
        kybSummaryJson: input.kybSummary ?? null,
        decidedByUserId: actor.userId,
      });

      await tx
        .update(providers)
        .set({
          verificationStatus: input.decision,
          verifiedAt: input.decision === 'verified' ? new Date() : null,
          verifiedByUserId: input.decision === 'verified' ? actor.userId : null,
          statusReason: input.decision === 'verified' ? null : input.reason,
        })
        .where(eq(providers.id, input.providerId));

      // Offboarding does not revoke live authorizations here. A merchant
      // mid-underwriting with this funder needs to be told and given the
      // choice, not silently cut off. That flow belongs to trust & safety,
      // and doing it automatically would be the platform making a decision
      // about the merchant's file on their behalf.
      if (input.decision === 'offboarded' || input.decision === 'suspended') {
        await tx
          .update(organizations)
          .set({ status: input.decision === 'offboarded' ? 'offboarded' : 'suspended' })
          .where(eq(organizations.id, provider.orgId));
      }
    },
  );
}

/**
 * Whether a provider may be shown to a merchant in a given state.
 *
 * Registration requirements for sales-based financing now vary by state and
 * come with staggered effective dates. Suppressing an unregistered provider is
 * a matching-engine input, not a compliance memo — so it lives in data the
 * engine reads on every run.
 */
export async function eligibleInJurisdiction(
  actor: Actor,
  providerId: string,
  jurisdiction: string,
  requiredTypes: string[],
): Promise<{ eligible: boolean; missing: string[] }> {
  if (requiredTypes.length === 0) return { eligible: true, missing: [] };

  const today = new Date().toISOString().slice(0, 10);

  const rows = await withActor(actor, (tx) =>
    tx
      .select({ registrationType: providerRegistrations.registrationType })
      .from(providerRegistrations)
      .where(
        and(
          eq(providerRegistrations.providerId, providerId),
          eq(providerRegistrations.jurisdiction, jurisdiction),
          eq(providerRegistrations.status, 'active'),
          lte(providerRegistrations.effectiveFrom, today),
          or(
            isNull(providerRegistrations.effectiveTo),
            gte(providerRegistrations.effectiveTo, today),
          ),
        ),
      ),
  );

  const held = new Set(rows.map((r) => r.registrationType));
  const missing = requiredTypes.filter((t) => !held.has(t));
  return { eligible: missing.length === 0, missing };
}

/** The five-second toggle. Providers set their own; no admin involved. */
export async function setAppetite(
  actor: Actor,
  input: {
    providerId: string;
    accepting: boolean;
    pausedIndustries?: string[];
    pausedStates?: string[];
    capacityNote?: string;
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  authorize(actor, 'administer', { kind: 'organization', id: actor.orgId });

  await mutate(
    actor,
    'administer',
    { kind: 'organization', id: actor.orgId },
    {
      action: 'provider.appetite_updated',
      objectType: 'provider',
      objectId: input.providerId,
      metadata: { accepting: input.accepting },
    },
    ctx,
    async (tx) => {
      await tx
        .insert(providerAppetite)
        .values({
          providerId: input.providerId,
          accepting: input.accepting,
          pausedIndustriesJson: input.pausedIndustries ?? [],
          pausedStatesJson: input.pausedStates ?? [],
          capacityNote: input.capacityNote ?? null,
          updatedByUserId: actor.userId,
        })
        .onConflictDoUpdate({
          target: providerAppetite.providerId,
          set: {
            accepting: input.accepting,
            pausedIndustriesJson: input.pausedIndustries ?? [],
            pausedStatesJson: input.pausedStates ?? [],
            capacityNote: input.capacityNote ?? null,
            updatedByUserId: actor.userId,
            updatedAt: new Date(),
          },
        });
    },
  );
}

/** Admin verification queue, oldest first — nobody waits indefinitely. */
export async function verificationQueue(actor: Actor) {
  authorize(actor, 'administer', { kind: 'platform_governance' });

  return withActor(actor, (tx) =>
    tx
      .select({
        id: providers.id,
        legalName: providers.legalName,
        status: providers.verificationStatus,
        kybRef: providers.kybRef,
        waitingSince: providers.createdAt,
      })
      .from(providers)
      .where(
        sql`${providers.verificationStatus} IN ('unverified', 'pending')`,
      )
      .orderBy(providers.createdAt),
  );
}
