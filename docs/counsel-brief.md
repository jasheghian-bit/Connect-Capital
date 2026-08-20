# Connect Capital — Counsel Brief

**Purpose:** to let counsel begin substantive work without first reconstructing
what the business is. Every question below is one the software is already built
to accommodate either way — we need the determination, not a redesign.

**Prepared:** August 2026
**Status:** platform built and tested; not launched; no live transactions

---

## 1. What the business does

A merchant applies once. The platform matches them to verified capital
providers, shows the merchant which providers fit and why, and the **merchant
chooses** which providers may access their financial information. Access is
scoped, revocable, and logged. The merchant and the funder's representative
communicate inside the platform. Funders make offers; the merchant compares,
negotiates, and accepts.

Initial product is merchant cash advance. The architecture is
financing-product agnostic.

**Compensation.** No fee to the merchant. The platform earns a success fee
(currently configured at 3%) from the capital provider on funded transactions
only. The rate is configurable per provider, per product, and per origination
channel, with effective dating.

**The platform does not touch funds.** The funder wires the merchant directly.
The platform records the funding and invoices its fee. This was a deliberate
decision to stay outside money transmitter licensing — please confirm it
achieves that.

**Merchant acquisition.** Primarily by agreement with participating funders,
who route merchants they decline (for fit reasons — wrong industry, wrong
state, amount outside their band) to the platform. The routing is by referral
link sent by the funder **to the merchant**; no merchant data transfers until
the merchant registers on the platform themselves.

**Related entity.** The founder separately owns a merchant cash advance broker
shop. It is a distinct business and does **not** route deals through the
platform. Please advise on whether and how this affiliation must be disclosed,
and whether it affects the classification question below.

---

## 2. The threshold question

**Is Connect Capital a broker, a provider, or a technology provider — and in
which states?**

Everything else follows from this. Our own reading, which we want tested:

- Several state frameworks define the regulated party by conduct — presenting a
  specific offer of commercial financing to a recipient — rather than by whether
  the party deploys capital.
- A transaction-contingent fee paid by the funder on a deal the platform
  sourced and presented is, in substance, brokerage compensation. Calling it a
  platform fee is a label.
- We have therefore **assumed we will be regulated as a broker** and built
  accordingly. We would rather be told we over-prepared.

**Specific questions**

1. In which states does our conduct trigger broker, provider, or lender
   registration or licensing?
2. Does the answer change if the fee is restructured — flat subscription,
   merchant-paid, per-application rather than per-funding?
3. Does the affiliated broker shop affect the analysis, and would a formal
   separation (ownership, branding, personnel) change it?
4. What is the registration timeline in each state, and which have deadlines we
   are already inside? We are specifically aware of a Texas registration
   requirement for providers and brokers of sales-based financing with a
   December 31, 2026 date, and want that confirmed and prioritized.

---

## 3. Disclosure obligations

**The question:** when a funder makes an offer to a merchant through the
platform, who owes the disclosure — the funder, the platform, or both? And does
the platform's act of *displaying* it create independent obligations?

This matters because our offer comparison screen shows terms from multiple
funders side by side. If any state treats that display as a regulated statement
of price, the screen itself is a regulated surface, not just the disclosure
document behind it.

**Specific questions**

1. Which states' commercial financing disclosure laws apply to us, in what
   role?
2. California: we understand APR must accompany any statement of a price, fee,
   or financing amount made after a specific offer. Does that reach our
   comparison screen, our notifications ("You have a new offer for $120,000"),
   and our marketing?
3. Is there a disclosure obligation attached to a *broker* separate from the
   provider's, and if so what must it contain?
4. Are there advertising or marketing restrictions we should design for now
   rather than retrofit?

### 3a. The APR method — please prioritize this

Sales-based financing has no stated term, so estimated APR depends on an
estimated term, and we understand the prescribed estimation method varies.

We have implemented **one explicit method**: term estimated either from the
fixed payment schedule or projected from a percentage holdback against
historical average revenue, then APR solved as the internal rate of return on
the resulting payment stream, annualized at 252 business days for daily
remittance.

Every computed disclosure is stamped with a method version and stores its
assumptions, so a change in prescribed method is a recalculation rather than a
rebuild.

**We need to know whether this method is acceptable in each disclosure state,
and where it is not, what is prescribed.** We will not show an offer to a
merchant in a disclosure state until this is answered.

---

## 4. Consumer reporting and credit

The platform collects a **self-reported credit band** for matching. It does
**not** pull credit. Each authorized funder pulls its own report under its own
permissible purpose, with the merchant's consent captured in the platform.

**Questions**

1. Does collecting and displaying a self-reported band to funders implicate
   FCRA?
2. Does capturing consent on behalf of funders create any obligation for us?
3. If we later wanted a single soft pull used for matching only, would that
   make us a consumer reporting agency or a reseller?
4. Personal guarantor information is collected. What are our obligations?

---

## 5. Bank data

Merchants may connect a business bank account through a licensed aggregator.
The platform never handles credentials. Derived metrics (revenue, balances,
negative days) are shared with authorized funders; **raw transaction data
never is**.

The platform also detects existing financing positions from the transaction
stream and surfaces them to the merchant for confirmation before any funder
sees them.

**Questions**

1. Does commercial bank data collection here implicate GLBA, state financial
   privacy laws, or state comprehensive privacy laws?
2. What must the consent language cover, and how granular must it be?
3. Are there restrictions on detecting and disclosing a merchant's other
   financing obligations to prospective funders?
4. Retention obligations and limits for this data.

---

## 6. Anti-circumvention and funder agreements

Two commercial risks the agreements need to address:

- **Provider circumvention.** A funder takes a platform-originated merchant
  off-platform and funds them directly, or funds their renewal directly, paying
  no fee.
- **Merchant circumvention.** A merchant uses a platform-originated funder
  relationship to transact outside the platform.

We have built the evidence infrastructure: identity, timestamps, authorization
scope, document access logs, message content flagging, and detection of new
advances appearing in a merchant's bank data.

**Questions**

1. What anti-circumvention and tail provisions are enforceable, and for how
   long?
2. **Renewals specifically.** Most MCA profit is in renewals. Can we contract
   for a fee on renewals of a platform-originated relationship, and on what
   basis?
3. Is conditioning marketplace access on a funder routing declined merchants to
   us defensible? Does it raise tying concerns at scale?
4. Can we contractually require that all communication with a
   platform-originated merchant occur inside the platform?

---

## 7. Documents needed

| Agreement | Covers |
|---|---|
| Capital provider participation | Use restrictions on merchant data, fee terms, anti-circumvention, decline routing, platform-exclusive communication, verification, offboarding |
| Merchant terms of service | Platform participation, authorization mechanics, what the platform does and does not do |
| Merchant privacy policy | Data collection, sharing on authorization, bank data, retention |
| Provider representative terms | Individual conduct, identity, confidentiality |
| Funding Specialist agreement | *Deferred — see §8* |
| Consent texts | Provider authorization, raw document access, bank connection, FCRA |

Every consent text is stored with a version identifier and a content hash, and
the platform records which version each merchant accepted and when. Counsel's
drafts drop in as versioned content.

---

## 8. Deferred but coming

We have designed an optional **Funding Specialist**: a human who assists a
merchant inside the platform, paid by Connect Capital, which is paid by the
funder. This is not in the initial launch, and we recognize it raises conflict
of interest and compensation disclosure questions — and likely settles the
broker classification question on its own.

**Not urgent. Flag anything that would change decisions we make now.**

One control is already built and enforced in both application code and the
database: **a Funding Specialist can prepare an authorization but can never
grant one.** The merchant confirms from their own authenticated session. We
believe this matters to the analysis.

---

## 9. What the software already accommodates

So counsel knows the answer changes configuration, not architecture:

| Determination | How the platform absorbs it |
|---|---|
| Registration required in state X | Provider and platform registrations are data, with effective dates. A provider unregistered in a merchant's state is suppressed from matching there automatically. |
| Disclosure fields required in state X | Per-jurisdiction rulesets. An offer missing a required field **cannot be submitted** — server-side refusal, not a warning. Unlisted states fall back to the strictest ruleset. |
| A different APR method | Version-stamped with stored assumptions. A recalculation. |
| Fee restructuring | Configurable by provider, product, channel, and effective date. Tiers, floors, caps supported. |
| Retention or legal hold | Legal hold table; deletion routines check it. |
| Consent language | Versioned and hashed; acceptance recorded per merchant. |

---

## 10. Please tell us what NOT to spend on yet

We would rather sequence this than do it all at once. Our view of the order:

1. Broker classification and the state registration matrix
2. The APR method for disclosure states
3. Capital provider participation agreement
4. Merchant terms and privacy policy
5. Everything else

If that order is wrong, we would like to hear it before we start.

---

*This brief was prepared by the founder with technical assistance. It states
what the platform does and what has been built. It contains no legal
conclusions and should not be read as any.*
