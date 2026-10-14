/**
 * CapNet — Messaging
 *
 * Conversations are scoped to an application and a counterparty. There is no
 * general inbox and no way to start a thread with someone you have no live
 * relationship with — a funder who lost authorization loses the thread too.
 *
 * Every message is scanned before it is stored. Flagged messages are still
 * delivered (see lib/message-safety.ts for why), but the finding is recorded
 * against the sending organization, which is how a pattern becomes visible.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  conversations,
  conversationParticipants,
  messages,
  notifications,
} from '../db/messaging';
import { authorizations } from '../db/matching';
import { mutate } from './audit';
import { withActor, withSystem, type Tx } from './db';
import { authorize, type Actor } from './policy';
import { scanMessage, senderNotice } from './message-safety';

export interface SendResult {
  messageId: string;
  /** Shown to the sender when their own message tripped a high flag. */
  notice: string | null;
}

/**
 * Opens the thread for an authorized funder, or returns the existing one.
 *
 * Requires a live authorization. Without it there is no thread to open —
 * pre-authorization contact is exactly what the blinded card exists to
 * prevent, and a message channel would route straight around it.
 */
export async function ensureConversation(
  actor: Actor,
  applicationId: string,
  providerOrgId: string,
): Promise<string> {
  return withActor(actor, async (tx) => {
    const [live] = await tx
      .select({ id: authorizations.id })
      .from(authorizations)
      .where(
        and(
          eq(authorizations.applicationId, applicationId),
          eq(authorizations.providerOrgId, providerOrgId),
          eq(authorizations.status, 'active'),
        ),
      )
      .limit(1);

    if (!live) throw new Error('no active authorization for this conversation');

    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.applicationId, applicationId),
          eq(conversations.type, 'merchant_provider'),
          eq(conversations.providerOrgId, providerOrgId),
        ),
      )
      .limit(1);

    if (existing) return existing.id;

    const [created] = await tx
      .insert(conversations)
      .values({
        applicationId,
        type: 'merchant_provider',
        providerOrgId,
        status: 'open',
      })
      .returning({ id: conversations.id });

    return created.id;
  });
}

export async function sendMessage(
  actor: Actor,
  input: { conversationId: string; body: string },
  ctx: { ip?: string; userAgent?: string },
): Promise<SendResult> {
  const participants = await loadParticipantOrgs(actor, input.conversationId);

  const [conv] = await withActor(actor, (tx) =>
    tx.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1),
  );
  if (!conv) throw new Error('conversation not found');

  authorize(actor, 'message', {
    kind: 'conversation',
    id: input.conversationId,
    applicationId: conv.applicationId,
    merchantOrgId: '',
    participantOrgIds: participants,
  });

  const scan = scanMessage(input.body);

  const messageId = await mutate(
    actor,
    'message',
    {
      kind: 'conversation',
      id: input.conversationId,
      applicationId: conv.applicationId,
      merchantOrgId: '',
      participantOrgIds: participants,
    },
    {
      action: 'message.sent',
      objectType: 'message',
      applicationId: conv.applicationId,
      // The body is never copied into the audit log. The audit trail records
      // that a message happened and whether it was flagged; the content lives
      // in one place with one set of access rules.
      metadata: {
        conversationId: input.conversationId,
        safetySeverity: scan.severity,
        findingKinds: scan.findings.map((f) => f.kind),
      },
    },
    ctx,
    async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          senderUserId: actor.userId,
          senderOrgId: actor.orgId,
          body: input.body,
          safetySeverity: scan.severity === 'none' ? null : scan.severity,
          safetyFindingsJson: scan.findings.length ? scan.findings : null,
        })
        .returning({ id: messages.id });

      await notifyOtherParticipants(tx, input.conversationId, actor.userId, conv.applicationId);

      return row.id;
    },
  );

  return { messageId, notice: senderNotice(scan) };
}

async function loadParticipantOrgs(actor: Actor, conversationId: string): Promise<string[]> {
  const rows = await withActor(actor, (tx) =>
    tx
      .select({ orgId: conversationParticipants.orgId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          isNull(conversationParticipants.removedAt),
        ),
      ),
  );
  return rows.map((r) => r.orgId);
}

async function notifyOtherParticipants(
  tx: Tx,
  conversationId: string,
  senderUserId: string,
  applicationId: string,
): Promise<void> {
  const others = await tx
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        isNull(conversationParticipants.removedAt),
        sql`${conversationParticipants.userId} <> ${senderUserId}`,
      ),
    );

  for (const o of others) {
    await tx.insert(notifications).values({
      userId: o.userId,
      applicationId,
      type: 'message.received',
      title: 'New message',
      // Not critical. A message can wait; an expiring offer cannot, and
      // marking everything critical trains people to ignore the escalation.
      critical: false,
    });
  }
}

export async function threadFor(actor: Actor, conversationId: string) {
  const participants = await loadParticipantOrgs(actor, conversationId);

  const [conv] = await withActor(actor, (tx) =>
    tx.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1),
  );
  if (!conv) throw new Error('conversation not found');

  authorize(actor, 'view', {
    kind: 'conversation',
    id: conversationId,
    applicationId: conv.applicationId,
    merchantOrgId: '',
    participantOrgIds: participants,
  });

  return withActor(actor, (tx) =>
    tx
      .select({
        id: messages.id,
        senderOrgId: messages.senderOrgId,
        body: messages.body,
        redactedAt: messages.redactedAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt),
  );
}

/**
 * Trust & safety queue. A single flagged message is noise; the same
 * organization flagged across many merchants is the pattern that supports an
 * off-platform contact claim.
 */
export async function flaggedMessageQueue(actor: Actor) {
  authorize(actor, 'administer', { kind: 'platform_governance' });

  return withActor(actor, (tx) =>
    tx
      .select({
        id: messages.id,
        senderOrgId: messages.senderOrgId,
        severity: messages.safetySeverity,
        findings: messages.safetyFindingsJson,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(sql`${messages.safetySeverity} IS NOT NULL`, isNull(messages.reviewedAt)))
      .orderBy(desc(messages.createdAt)),
  );
}

/**
 * Escalation sweep. Critical notifications unread past their window get a
 * second channel. This job is the reason a merchant can safely ignore their
 * phone — without it, "your funders will reach you here" is a promise with no
 * mechanism behind it.
 */
export async function escalateUnreadCritical(olderThanMinutes = 60): Promise<number> {
  return withSystem(async (tx) => {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60000);

    const due = await tx
      .select({ id: notifications.id, userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.critical, true),
          isNull(notifications.readAt),
          isNull(notifications.escalatedAt),
          sql`${notifications.createdAt} < ${cutoff}`,
        ),
      );

    for (const n of due) {
      await tx
        .update(notifications)
        .set({ escalatedAt: new Date() })
        .where(eq(notifications.id, n.id));
    }

    return due.length;
  });
}
