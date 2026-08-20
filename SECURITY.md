# Security

## Threat model

Ordered by how badly each would damage the company, not by likelihood.

### 1. Unauthorized provider reaches a merchant's file

**Why it is first.** It is the only promise a merchant cannot verify for
themselves. A leak surfaces as an unexpected phone call, months later,
unattributable.

**Controls**
- `lib/policy.ts` — one `can()` function, deny by default, exhaustively tested
- `lib/blinded.ts` — the pre-authorization card is built from an allowlist, so
  a newly added merchant field cannot leak by default
- `lib/provider-view.ts` — one resolver; identity requires a live grant
- Postgres RLS as a backstop under all three
- Deny suite: ~48 assertions that specific actors are refused

**Residual risk.** A provider who is legitimately authorized and then behaves
badly. Addressed by detection (`lib/anomaly.ts`) and contract, not prevention.

### 2. Circumvention

A funder takes a platform-originated merchant off-platform and funds them
directly, paying no fee — and the merchant loses the record they were promised.

**Controls**
- No contact information before authorization
- `lib/message-safety.ts` flags contact details in messages, including
  obfuscated forms
- `lib/bank-analysis.ts` detects new advances appearing on a merchant's account
- `lib/anomaly.ts` flags harvesting patterns across merchants
- Off-platform contact reports: the merchant is the sensor

**Residual risk.** A phone call leaves no trace anywhere. The controls create
evidence for a contractual remedy; they do not prevent the call.

### 3. Silent audit failure

The audit log is the evidentiary basis for everything. A log that can be edited
is not evidence.

**Controls**
- `REVOKE UPDATE, DELETE` on every evidence table
- A trigger behind every revoke, in case a superuser connects
- SHA-256 hash chain, verified nightly, head published externally
- `scripts/preflight.ts` verifies all of the above are actually applied

**Residual risk.** Someone with superuser access and intent could still drop a
trigger. The published chain head makes that detectable after the fact.

### 4. Insider access

Platform staff reading merchant financial data.

**Controls**
- Elevation required for merchant documents, with a stated reason and expiry
- Elevation is logged and visible to the merchant in their timeline
- MFA required for all platform accounts
- No platform clause in the `bank_transactions` RLS policy — admin access to a
  merchant's transaction stream must go through the application layer

### 5. Malicious upload

Merchants upload files; funders download them. That is a delivery path.

**Controls**
- Virus scan gate: no document is visible to a funder until it clears
- Failed scans quarantine rather than delete
- MIME allowlist and size cap
- Documents streamed through the app, never public URLs

### 6. Multi-tenant confusion

**Controls**
- The acting organization comes from the authenticated session only, never
  from a request parameter
- UUIDv7 identifiers — non-enumerable
- RLS keyed to transaction-local session context

---

## Non-negotiables

Changing any of these silently breaks a promise made to a merchant.

| Rule | Enforced by |
|---|---|
| Acting org from session, never from request | `lib/session.ts` |
| Documents served only through the logged proxy | `lib/documents.ts` |
| Every write inside `mutate()` with its audit row | `lib/audit.ts` |
| Blinded card built from an allowlist | `lib/blinded.ts` |
| Timeline rendered from an allowlist | `lib/timeline.ts` |
| Only a merchant grants authorization | `policy.ts` + trigger 0004 |
| Verified requires a real KYB reference | CHECK constraint 0003 |
| Fees priced at the funding date | `lib/fees.ts` |
| Raw bank transactions never reach a funder | RLS 0005 |
| Evidence tables are append-only | grants + triggers, all migrations |

---

## Before launch

- [ ] `npm run preflight` green against production
- [ ] External penetration test, IDOR focus on document endpoints
- [ ] Backup restore drill — a backup nobody has restored is a hypothesis
- [ ] Key rotation runbook
- [ ] Incident response runbook with a named owner
- [ ] Data retention and legal hold policy, per state recordkeeping rules
- [ ] Counsel sign-off on the disclosure method (`lib/disclosure.ts`)
- [ ] Counsel determination on broker classification and state registrations
- [ ] Audit chain head publishing to an external store, verified working

## Ongoing

- Nightly: `npm run audit:verify`, publish the chain head
- Weekly: trust and safety queue review
- Quarterly: access review, dependency audit, preflight against staging
