/**
 * CapNet — Transaction timeline
 *
 * The merchant-facing rendering of the audit log, and the platform's closing
 * promise: what happened, in order, in plain language.
 *
 * ── ALLOWLIST, SAME AS THE BLINDED CARD ────────────────────────────────────
 *
 * An audit event that has no entry in RENDERERS below does not appear. It is
 * not rendered generically, not labelled "activity", not shown with its raw
 * action string.
 *
 * The audit log carries things a merchant must never see: refused access
 * attempts naming a provider that was probing them, admin elevation reasons
 * referencing a dispute, internal underwriting transitions. A denylist would
 * mean the next event type someone adds is merchant-visible by default, and
 * the failure would be silent and permanent — it would simply appear one day
 * in a screen a merchant reads.
 *
 * So: unknown event, no entry. Adding a merchant-visible event is a deliberate
 * act that requires opening this file.
 */

export type TimelineActor = 'you' | 'provider' | 'platform' | 'specialist';

export interface AuditEventInput {
  action: string;
  at: Date;
  actorOrgType: 'merchant' | 'provider' | 'specialist' | 'platform';
  /** Display name of the acting provider, when the event names one. */
  providerName?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineEntry {
  at: Date;
  actor: TimelineActor;
  /** One line, plain language, no jargon. */
  text: string;
  /** Grouping for the UI, not shown as a label. */
  kind: 'application' | 'access' | 'documents' | 'underwriting' | 'offers' | 'funding';
}

type Renderer = (e: AuditEventInput) => Omit<TimelineEntry, 'at' | 'actor'>;

const provider = (e: AuditEventInput) => e.providerName ?? 'A funder';

const money = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : 'an amount';
};

/**
 * Every merchant-visible event, and only those.
 *
 * Deliberately absent, among others: `access.denied` (naming a provider who
 * tried to reach a file they had no grant for would send the merchant to the
 * phone, which is the behaviour the platform exists to remove), every
 * `admin.*` action, and every internal underwriting note.
 */
const RENDERERS: Record<string, Renderer> = {
  'application.created': () => ({
    text: 'You started your funding request.',
    kind: 'application',
  }),
  'application.submitted': () => ({
    text: 'You submitted your request.',
    kind: 'application',
  }),
  'matching.run': (e) => ({
    text: `We found ${e.metadata?.matchCount ?? 'several'} funders that fit your business.`,
    kind: 'application',
  }),

  'authorization.granted': (e) => ({
    text: `You gave ${provider(e)} access to your file.`,
    kind: 'access',
  }),
  'authorization.revoked': (e) => ({
    text: `You ended ${provider(e)}'s access.`,
    kind: 'access',
  }),
  'provider.expressed_interest': (e) => ({
    text: `${provider(e)} asked to see your file.`,
    kind: 'access',
  }),

  'document.uploaded': (e) => ({
    text: `You uploaded ${docLabel(e.metadata?.docType)}.`,
    kind: 'documents',
  }),
  'document.requested': (e) => ({
    text: `${provider(e)} asked for ${docLabel(e.metadata?.docType)}.`,
    kind: 'documents',
  }),
  'document.viewed': (e) => ({
    text: `${provider(e)} opened ${docLabel(e.metadata?.docType)}.`,
    kind: 'documents',
  }),
  'document.downloaded': (e) => ({
    text: `${provider(e)} downloaded ${docLabel(e.metadata?.docType)}.`,
    kind: 'documents',
  }),
  'bank.connected': () => ({
    text: 'You connected your bank account.',
    kind: 'documents',
  }),
  'bank.disconnected': () => ({
    text: 'You disconnected your bank account.',
    kind: 'documents',
  }),

  'underwriting.reviewing': (e) => ({
    text: `${provider(e)} started reviewing your file.`,
    kind: 'underwriting',
  }),
  'underwriting.pending_docs': (e) => ({
    text: `${provider(e)} is waiting on a document.`,
    kind: 'underwriting',
  }),
  'underwriting.approved': (e) => ({
    text: `${provider(e)} approved your file.`,
    kind: 'underwriting',
  }),
  'underwriting.declined': (e) => ({
    text: `${provider(e)} passed on your file.`,
    kind: 'underwriting',
  }),
  'underwriting.withdrawn': (e) => ({
    text: `${provider(e)} is no longer reviewing.`,
    kind: 'underwriting',
  }),

  'offer.submitted': (e) => ({
    text: `${provider(e)} offered you ${money(e.metadata?.amountFinanced)}.`,
    kind: 'offers',
  }),
  'offer.revised': (e) => ({
    text: `${provider(e)} revised their offer.`,
    kind: 'offers',
  }),
  'offer.countered': () => ({
    text: 'You asked for better terms.',
    kind: 'offers',
  }),
  'offer.best_and_final_requested': (e) => ({
    text: `You asked all ${e.metadata?.providerCount ?? 'your'} funders for their best terms.`,
    kind: 'offers',
  }),
  'disclosure.viewed': () => ({
    text: 'You reviewed the full terms.',
    kind: 'offers',
  }),
  'offer.accepted': (e) => ({
    text: `You accepted ${provider(e)}'s offer.`,
    kind: 'offers',
  }),

  'funding.confirmed': (e) => ({
    text: `${provider(e)} funded ${money(e.metadata?.fundedAmount)}.`,
    kind: 'funding',
  }),
  'funding.merchant_confirmed': () => ({
    text: 'You confirmed the funds arrived.',
    kind: 'funding',
  }),
};

function docLabel(t: unknown): string {
  const labels: Record<string, string> = {
    bank_statement: 'a bank statement',
    government_id: 'your ID',
    voided_check: 'a voided check',
    tax_return: 'a tax return',
    financial_statement: 'a financial statement',
    business_license: 'your business license',
    lease_agreement: 'your lease',
  };
  return labels[String(t)] ?? 'a document';
}

function actorFor(orgType: AuditEventInput['actorOrgType']): TimelineActor {
  switch (orgType) {
    case 'merchant':
      return 'you';
    case 'provider':
      return 'provider';
    case 'specialist':
      return 'specialist';
    case 'platform':
      return 'platform';
  }
}

export function buildTimeline(events: AuditEventInput[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const e of events) {
    const render = RENDERERS[e.action];
    // Unknown event: nothing. Not a generic row, not a raw action string.
    if (!render) continue;

    const { text, kind } = render(e);
    entries.push({ at: e.at, actor: actorFor(e.actorOrgType), text, kind });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Exported so tests can assert the boundary directly. */
export function isMerchantVisible(action: string): boolean {
  return action in RENDERERS;
}

export const MERCHANT_VISIBLE_ACTIONS = Object.keys(RENDERERS);
