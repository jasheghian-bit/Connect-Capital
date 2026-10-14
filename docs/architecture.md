# CapNet — Founding Architecture & Strategy Response

**Prepared as: CTO / product architect response to the master founder brief**
**Date: August 18, 2026**
**Status: pre-implementation. No code written yet. Every legal item flagged for counsel.**

---

## A. What I understand CapNet to be

### A.1 The ecosystem, stated economically

An MCA is not a loan. It is the purchase of a defined amount of future receivables at a discount, repaid via daily or weekly ACH (fixed) or a percentage holdback of card volume. Price is expressed as a factor rate (roughly 1.15–1.49+), not an interest rate. There is no stated term — the term is an artifact of revenue. That structure is the entire reason MCA sits outside usury caps and traditional lending licenses, and it is also the reason the product is now under sustained regulatory pressure on the *disclosure* axis rather than the *rate* axis.

The distribution layer is where your thesis lives. In a typical MCA, the ISO/broker is compensated two ways, and the second one is the one that matters:

1. **Commission points** paid by the funder on the funded amount — commonly high single digits to mid-teens.
2. **Upsell of the sell rate.** The funder issues a buy rate (say 1.32). The broker markets 1.45. The delta is additional broker compensation, and it is *paid by the merchant* in the form of a larger payback obligation.

So the merchant's cost of capital contains a variable, invisible, negotiable component whose size is set by the party the merchant believes is representing them. That is not a transparency problem with a side of economics. It is an economics problem wearing a transparency costume.

**This gives your 3% its real meaning, and I don't think the brief states it forcefully enough.** CapNet's pitch to a funder is not "cleaner files." It is: *you are currently paying 8–15 points of the funded amount to acquire this deal; pay us 3.* On a $100K advance that is a $5,000–$12,000 swing in the funder's favor, per deal, before any argument about file quality. That number is the entire supply-side wedge. Everything else — verification, permissioning, audit — is what makes the number *safe* to accept. Lead with the arbitrage; sell the trust layer as the reason it isn't a race to the bottom.

### A.2 Why the broker exists — including the parts your brief underweights

Your Part V table maps broker *functions* to platform *features*, and the mapping is largely right for the functions listed. But the list is missing the function that actually pays the broker's rent:

**Brokers are demand generation, not deal packaging.**

A small business owner does not wake up wanting a 1.38 factor. Brokers manufacture that demand — UCC filing lists, aged data, live transfers, cold outbound, direct mail, renewal calls timed to the 50%-paid-down mark. Packaging, submission, doc chasing, and offer comparison are the *cost* of the broker's business. Origination is the *product*. Your platform replaces the cost side beautifully and does not touch the product side at all.

**Correction (founder challenge, Aug 18): this is true of the MCA channel specifically, not of SMB financing generally.** Lendio, Fundbox, OnDeck, Kabbage and others acquired small businesses directly, at scale, without a broker network. Direct acquisition is proven. What it is not is cheap — see *Competitive Landscape* at the end of this document. The claim that survives is narrower and still load-bearing: in MCA, brokers currently carry origination, and replacing them means paying for demand some other way.

Two more functions the brief doesn't capture:

- **Live appetite routing.** Good brokers know which funder is buying *this week* — who just raised syndication capital, who is off restaurants until Q4, whose underwriter is lenient on two negative days. That is dynamic, unpublished, relationship-carried knowledge. A static `provider_criteria` table will be stale within a month and will silently degrade match quality in a way that looks like a product failure.
- **Adverse-selection filtering.** Funders sometimes *prefer* a broker because the broker eats the junk. If CapNet passes everything through with perfect transparency, funders absorb screening cost they previously externalized.

I flag all three because your MVP plan (Part L: "do not overbuild merchant acquisition") treats the hardest problem as a later phase.

### A.3 Merchant pain, restated as what it costs them

Not "confusion" — money and optionality. Multiple broker submissions means the same file hits the same funder from three ISOs, which in most funder shops triggers a duplicate/conflict process that at best delays and at worst declines. Repeated document transmission means bank statements with full account and routing numbers sitting in an unbounded number of inboxes. Data proliferation means the merchant's phone rings for eighteen months. And pricing opacity means the merchant literally cannot know whether 1.45 was the funder's price or their advocate's markup.

### A.4 Funder pain, restated as what it costs them

Acquisition cost (points), duplicate-submission underwriting waste, doctored bank statements (a real and expensive fraud vector — the entire statement-verification industry exists because of it), channel dependence on ISOs they cannot control, and near-zero visibility into whether the merchant is simultaneously shopping five other funders.

### A.5 The concepts I take as load-bearing

- **Merchant-controlled authorization.** The platform surfaces matched providers; it never broadcasts. Authorization is a first-class, revocable, scoped, logged object — not a boolean on a join table. This is the single most defensible product idea in the brief.
- **Permissioned data, uploaded once.** One financial profile; authorized providers read from it. Document *access* is the audited event, not document *possession*.
- **Direct merchant ↔ verified representative communication**, scoped to an application, part of the transaction record.
- **Transparent competing offers with immutable revision history.** Never overwrite; every counter and revision is a new row.
- **3% configurable success fee from the provider on funded transactions.** Merchant pays nothing.
- **Optional Funding Specialist** — human expertise operating *visibly inside* the system, with attribution and comp transparency, rather than as a re-hidden broker.
- **Trust layer as evidence infrastructure, not as a promise of prevention.** You were right to write this carefully. Watermarks and logs make misuse *attributable and contractually actionable*; they do not make it impossible. Never let marketing drift off that line.
- **MCA as wedge, product-agnostic architecture.** The domain model must not encode "factor rate" as a primitive; it must encode `pricing_terms` with a product-typed shape.

### A.6 What the network effect actually is

Not "more users." The compounding asset is **outcome data**: for a given merchant profile, which provider actually issued, at what price, how fast, and did it fund. After a few thousand transactions that dataset makes your matching materially better than a broker's memory, and it is the thing no new entrant can copy. The verified-provider network is table stakes; the funded-outcome ledger is the moat.

---

## B. Requirements vs. hypotheses vs. legal vs. market

### B.1 Hard requirements (build these; they are not up for debate)

| # | Requirement |
|---|---|
| R1 | No provider sees any merchant data before an explicit, scoped, revocable merchant authorization |
| R2 | Every authorization decision is server-enforced; the frontend is never trusted |
| R3 | Every document access (view *and* download) is logged with actor, org, authorization, and timestamp |
| R4 | Offer revisions are append-only; history is never mutated |
| R5 | Audit log is append-only and tamper-evident |
| R6 | Fee rate is configurable per provider/product/effective-date; never a constant in code |
| R7 | Domain model is financing-product agnostic |
| R8 | Merchant experience is mobile-first |
| R9 | Nothing is faked. Mock/prototype/placeholder is labeled as such in the UI, not just in comments |
| R10 | CapNet does not touch merchant funds in the MVP |

R10 is my addition and I want to be explicit: **do not build money movement into the MVP.** The moment you disburse funds or collect repayment you are into money transmitter licensing in ~50 jurisdictions. The funder wires the merchant directly. CapNet records the funding event and invoices its fee. This is a one-line decision that removes an entire regulatory workstream.

### B.2 Founder hypotheses (build the instrumentation, hold the belief loosely)

| # | Hypothesis | The metric that settles it |
|---|---|---|
| H1 | Merchants prefer one controlled application to broker shotgunning | Application completion rate; repeat rate |
| H2 | Merchants value choosing who gets access | Mean providers authorized / providers offered; revocation rate |
| H3 | Merchants will speak directly to funder reps | Messages per application; % applications with ≥1 merchant-initiated message |
| H4 | Funders accept permissioned direct submissions | Authorized→reviewed rate; time-to-first-touch |
| H5 | Funders will pay 3% on funded deals | Signed agreements; fee collection rate; renegotiation attempts |
| H6 | **Removing broker spread lets funders sell at a lower factor at unchanged margin, producing more manageable merchant payments and lower default risk.** Price competition contributes but is not the mechanism. | **Payment-to-revenue ratio at origination** (day one); median factor by grade band vs. off-platform; early-default rate by payment-to-revenue band (6–18 mo). See *Cost Structure* section. |
| H7 | Better-fit files improve funder conversion | Authorized→offer rate, offer→funded rate vs. funder's ISO baseline |
| H8 | Centralized docs reduce underwriting friction | Doc requests per file; time from authorization to offer |
| H9 | Merchants will transact without a broker | % of funded deals with zero specialist involvement |
| H10 | Some merchants want paid human help | Specialist request rate; funded-rate delta with vs. without |

H6 is the one I would build the most careful measurement around, because it is the hypothesis the whole moral case rests on and it is the one I most doubt (see C.3).

### B.3 Requires counsel — and this is more urgent than the brief implies

I ran current research on this. The regulatory ground moved significantly in 2025–2026 and it lands directly on CapNet's design, not just its paperwork.

**B.3.1 — You should plan on being classified as a broker.**

Several states now define the regulated party in language that plausibly captures CapNet's core product. <cite index="12-1">Connecticut defines "provider" as a person who extends a specific offer of commercial financing to a recipient, and expressly includes a commercial financing broker</cite>. Your platform's central screen presents specific offers to a merchant. <cite index="13-1">Virginia, Connecticut, Missouri, and Texas have commercial-financing-specific registration requirements that expressly reach certain brokers; North Dakota uses a broader money-broker license; Vermont is expanding its framework to sales-based financing and factoring in 2027; and older loan-broker statutes in states including North Carolina, Nebraska, and Illinois can also apply</cite>. <cite index="14-1">New York requires brokers to be registered with NYDFS</cite>. <cite index="10-1">Texas HB 700 requires providers *and brokers* of sales-based financing to register with the OCCC by December 31, 2026, with annual renewal, and includes no de minimis exemption for low volume</cite>.

Compensation is the classic trigger. A transaction-contingent fee paid by the funder on a deal you sourced and presented is, in substance, brokerage compensation. Calling it a "platform success fee" is a label, not a structure.

**My recommendation: architect and operate as if you are a regulated broker, and treat any technology-provider exemption as upside.** Getting this backwards is a company-ending error, and the cost of being right early is a registration matrix and some disclosure plumbing.

*Product consequence:* the schema needs `provider_registrations` and `platform_registrations` keyed by state with effective dates, and the matching engine needs a jurisdictional gate that can suppress a provider — or suppress CapNet itself — in a state where the required registration is not live.

**B.3.2 — Your offer comparison screen is a regulated disclosure surface.**

This is the finding with the largest architectural impact. <cite index="5-1">Under California SB 362, effective January 1, 2026, any time a provider states a price, fee, or financing amount after making a specific offer, it must simultaneously state the APR — which functions as a ban on standalone factor-rate marketing</cite>. <cite index="2-1">Providers can no longer use "interest" or "rate" in misleading contexts, and the statute treats obfuscation as a form of deception</cite>. <cite index="4-1">California and New York require an estimated APR in their commercial-financing disclosures; Utah, Virginia, Connecticut, Florida, Georgia, Kansas and Missouri require disclosures or registration</cite>. <cite index="8-1">The estimated-APR framing exists because MCA repayment timing depends on future sales, so an exact APR is unknowable in advance</cite>. Newer entrants continue to arrive: <cite index="1-1">Texas HB 700, effective September 2025, requires written disclosure of amount financed, finance charge, total repayment, all potential fees, and repayment terms</cite>, and <cite index="2-1">New York's FAIR Business Practices Act took effect February 17, 2026</cite>.

Design consequences, which I have built into the schema in section F:

- The `offer_revision` object carries a `disclosure` sub-object (amount financed, finance charge, total repayment, estimated APR, payment amount and frequency, estimated term, prepayment policy, itemized fees), populated at revision creation and frozen with the revision.
- The offer comparison UI renders disclosure fields **by jurisdiction rule**, driven by the merchant's state, from a `disclosure_rulesets` table — not by hardcoded conditionals.
- A provider cannot submit an offer to a merchant in a disclosure state without the required fields present. This is a server-side validation, not a nudge.
- Every disclosure rendered to a merchant is persisted with a hash and a timestamp, because "what did the merchant see, and when" will one day be a discovery request.

**B.3.3 — Other counsel items**

- **Funding Specialist structure.** A human who advises the merchant, is paid by CapNet, which is paid by the funder. That is a conflict of interest requiring disclosure at minimum, and in registration states it is squarely broker activity. Comp model, disclosure text, and any merchant-paid alternative need counsel *before* the first specialist touches a file.
- **FCRA.** Personal credit on a guarantor requires permissible purpose and consent. If CapNet pulls once and distributes to twelve funders, you are potentially a consumer reporting agency or a reseller. Safest MVP posture: CapNet collects a self-reported credit band for matching only, and each authorized funder pulls its own report under its own permissible purpose with merchant consent captured in the platform.
- **Bank credentials / data aggregation.** Use a licensed aggregator; never handle credentials directly; get an explicit merchant consent artifact for each connection and each downstream sharing scope.
- **Anti-circumvention and tail terms.** Enforceable only if drafted by counsel; the platform's job is evidence.
- **CFPB small-business data collection (1071).** Status has been in flux; verify current applicability to sales-based financing and whether any obligation attaches to an intermediary.
- **Recordkeeping and retention** schedules per state.
- **Merchant, provider, representative, and specialist agreements**, plus platform ToS/privacy.

### B.4 Requires market validation

Whether funders will accept 3% without demanding equity, exclusivity, volume commitments, or a lower rate. Whether merchants who reach a marketplace are the merchants funders want. Whether merchants will wait 24–48 hours for competition instead of taking the first yes. Whether your existing provider relationships convert to signed participation agreements or stay at "sounds interesting."

---

## C. Where I think this is weak

You asked for rigor over agreement. Here it is, ordered by how likely each is to kill the company.

### C.1 Merchant acquisition is the whole problem, and the plan defers it

Part L says don't overbuild merchant acquisition in the MVP; Part XLVIII says the first goal is transaction liquidity, not merchants. Those two statements are in tension, because transaction liquidity *is* merchants. You have supply relationships. You have no demonstrated demand engine. A marketplace with 25 hungry funders and 6 merchants is not a marketplace; it is a very well-architected empty room, and the funders will disengage within a quarter.

Brokers own MCA demand because they *buy and manufacture* it, at real cost. Nothing in the platform reduces that cost. The infrastructure is downstream of the problem.

**I need an answer to one question before I write a line of code: where do the first 100 merchants come from, by name and by channel?** "Existing relationships" and "referrals" are not channels. If the honest answer is "I don't know yet," that changes the build order — it means we build the specialist tooling early rather than late, because the specialist path is your demand path.

### C.2 The 3% is probably right for funders and structurally wrong for you

Run it forward. Average MCA around $50–100K. At $75K, 3% is $2,250 of revenue per funded deal. Now price your funnel: merchant acquisition in this vertical is expensive (live transfers, aged data, and paid search on MCA-adjacent terms are among the most contested in small business finance), and the funnel from lead → application → authorization → offer → funded is brutally lossy. If your fully loaded cost per *funded* merchant lands anywhere near $1,500–2,500 through paid channels, your contribution margin is zero or negative — before verification ops, trust & safety, compliance, or support.

Brokers charge 10–15 points *precisely because* they carry acquisition. You are proposing to charge 3 while carrying it too. That only works in one of three worlds:

1. Merchant acquisition is organic/partnership-driven and near-free (highest quality outcome, hardest to achieve, slowest);
2. Funders drive merchants to you (they won't, at first — see C.4);
3. You take a second revenue line — specialist fees, subscription/SaaS to funders, data products.

I would build the fee engine now to support all three: `fee_schedules` with `fee_type` (success | subscription | specialist | data), per-provider overrides, tiering by funded amount, floors and caps. Do not hardcode "3%" anywhere, including in the pitch deck's assumptions tab. My guess is the terminal model is a lower success fee on large deals with a floor on small ones, plus a per-seat funder subscription once you have data they can't get elsewhere.

### C.3 The pricing-competition hypothesis (H6) may not hold, for a specific reason

**Partially answered by the founder's H6 reframe (Aug 18) — see the *Cost Structure* section at the end.** The objection below still lands against a competition-driven mechanism. It lands much less against a cost-structure mechanism, which does not require the merchant to shop at all. What survives is the pass-through question in the second paragraph.

MCA merchants are usually not price shoppers. They are timing shoppers. They need money this week, they have often been declined by a bank, and their revealed preference across the entire history of this industry is *speed and approval over cost*. Price competition requires a buyer willing to wait and compare. Your product is built for that buyer. A meaningful share of the market isn't that buyer.

Second problem: even if the funder's acquisition cost drops 7–12 points, nothing forces that saving into the merchant's price. It can simply become funder margin. Competition only compresses price if funders can see they are competing and believe the merchant will walk. Which raises a design fork the brief doesn't resolve:

**Do funders see each other's offers?**

- **Blind** (funders see only that they are one of N authorized): protects funder margin, funders are far more willing to participate, price competition happens only through the merchant's willingness to counter.
- **Open** (funders see competing terms): maximizes price competition, and a meaningful number of funders will refuse to participate at all, because you have just built the thing their whole business model avoids.

**My recommendation: launch blind, with the merchant told exactly how many providers were authorized, and give the merchant a structured "request best and final" action that pings all authorized providers simultaneously.** That gets most of the competitive pressure without asking funders to bid in public on day one. Instrument it, and if H6 holds under blind conditions you have proof to negotiate open bidding later from strength.

### C.4 Channel conflict is the real reason funders will say no

The brief frames funder resistance as inertia. It isn't. Most MCA funders' entire origination is their ISO channel. Those ISOs are relationships, sometimes equity-adjacent, and they are loud. A funder who joins a platform whose explicit thesis is "make the broker optional" will hear from their top ten ISOs within a week. Several will quietly decline for exactly this reason and give you a different reason.

Mitigations to design for now:
- Let funders participate under a distinct entity/brand so the ISO channel doesn't immediately see it.
- Position CapNet volume as *incremental* — merchants their ISOs weren't reaching — and give them data that proves it (dedupe against their existing pipeline via a submitted-file hash check).
- Expect the first cohort to be funders who are *under*-served by ISOs: newer entrants, funders in a growth push, funders burned by broker fraud.

### C.5 Adverse selection

A transparent marketplace where merchants shop twelve funders attracts merchants who need to shop twelve funders. The A-paper merchant with a bank relationship isn't here. Meanwhile every marginal file gets maximum exposure. If your funded rate and default rate come in worse than the funders' ISO channel, the 3% argument dies no matter how elegant the software is.

Countermeasure, and it should be in the MVP: **grade honestly and route narrowly.** Don't show a D-paper merchant twelve providers. Show three who actually buy D paper. Match precision is a funder-retention feature, not a merchant-convenience feature.

### C.6 Renewal leakage is where your revenue goes to die

In MCA, the money is in renewals. Funders reliably re-advance at the 40–60% paid-down mark, and those deals cost them almost nothing to originate. You will facilitate the first transaction, take 3%, and then the funder — now holding the merchant's phone number, bank statements, and payment history — renews directly forever.

Contract tail periods help only if you can *detect* the renewal. Which is the strongest argument for the next point.

### C.7 The architecture is missing bank data connectivity, and it shouldn't be

The brief treats documents as the substrate. Documents are the *legacy* substrate. A read-only bank connection (Plaid/MX-class aggregator, optionally with a statement-analytics layer) solves six problems at once:

1. Kills the doc-chasing loop that is half your merchant value prop.
2. Defeats the doctored-statement fraud vector, which is a genuine funder cost and therefore a genuine funder pitch.
3. Produces normalized underwriting metrics (avg daily balance, negative days, NSFs, deposit count, true monthly revenue) instead of twelve funders each re-deriving them.
4. **Detects stacking** — existing MCA debits are visible in the transaction stream.
5. **Detects circumvention** — a new daily debit appearing after your platform went quiet is evidence of an off-platform funding.
6. **Times renewals** — you can see the paydown curve and re-engage the merchant before the funder does, which converts your worst leakage problem into your best repeat-revenue product.

I would put bank connection in the MVP as the *preferred* path with document upload as fallback. It costs you maybe two weeks and it is the difference between a workflow tool and an infrastructure company.

**ACCEPTED (Aug 18).** Bank connection is the preferred path; document upload is the fallback. Four consequences:

1. **M1 builds the flow around it; M5 implements it.** Merchant intake ships with the bank-connect step as the primary call to action — stubbed until M5 — with "upload statements instead" as a secondary, lower-prominence link. Retrofitting this into a finished onboarding flow means rebuilding onboarding.
2. **Preferred must not become coercive.** Merchants carrying existing positions are the most reluctant to link, because the link exposes their MCA debits — and they are exactly the merchants whose data matters most. The fallback stays one tap away and never reads as a downgrade. A merchant who abandons rather than uploads is lost entirely.
3. **This does not remove the need for statement parsing.** Both paths must produce the same normalized `financial_profiles` record, or matching operates on two classes of merchant. Ocrolus-class parsing stays a requirement; bank connection reduces its volume, not its necessity. `provider_criteria` gains `requires_verified` so a provider can demand bank-derived metrics above a threshold, and `financial_profiles.confidence` becomes a matching input.
4. **Ask at decline, not only at application.** The re-eligibility watcher in the remediation track only works for merchants who linked. The decline moment is the better ask — lower stakes, concrete benefit: *we will tell you when you qualify.* Merchants who upload PDFs at application should be re-offered the link there.

Justify the preference honestly: connecting produces more provider matches and fewer document requests, both of which are true because normalized metrics are better underwriting inputs than PDFs. Do not promise better *offers* — that is a claims-register item without a basis.

### C.8 Transparency can be a worse experience than opacity

"Provider C — Declined: negative balance days" shown to a merchant five times in one afternoon is a demoralizing product. Brokers protect merchants from the ugliness of the process. You are proposing to expose it. Some merchants will experience this as honesty; some will experience it as five rejections and leave.

Design response: decline reasons should be **structured, actionable, and aggregated** — not a raw feed. "Three providers cited negative balance days. Here is what would change that." Never a wall of red.

### C.9 "Verified" is an operating expense, not a database column

The moment you badge a provider as verified, you have implicitly vouched for them. If a verified provider backdoors a merchant, the merchant's complaint is about *you*. Verification therefore requires: real KYB, entity and registration checks, principal screening, a written participation agreement, ongoing monitoring, a complaint intake, and a documented offboarding process. That is a trust & safety function with headcount, and it should be budgeted from day one. Never render a verification badge that isn't backed by a real check — that would be exactly the fake functionality Part LXV prohibits.

### C.10 Watermarking will not do what it sounds like it does

Visible watermarks deter casual sharing and support attribution *if* a leaked artifact resurfaces. They do nothing against a screenshot or a retyped phone number, and leaks usually surface as "my client got a weird call" — which is unattributable. The honest control is **minimize what you hand over**: give funders a structured underwriting summary and verified metrics by default, and gate raw statement PDFs behind a separate, explicitly-consented, separately-logged access grant. Fewer raw artifacts in circulation is worth more than any watermark.

### C.11 What brokers will do

Register as "providers" to source deals from your merchant pool (police this — verify that a registrant actually deploys its own capital); pressure funders not to participate; undercut on speed; and out-hustle you on outbound, which they are extremely good at.

**The strategic inversion I'd put in front of you: recruit your best brokers as your first Funding Specialists.** They bring a merchant book and origination skill you cannot buy; you give them a better toolset, no doc-chasing, no submission spam, and a comp model they can show a client without embarrassment. It converts your biggest competitive threat into your distribution channel and directly solves C.1. The risk is recreating broker economics inside the platform — which is exactly why specialist compensation must be a first-class, merchant-visible, audited object rather than a side agreement.

### C.12 Technical risks

IDOR on documents is the canonical way platforms like this fail — one enumerable ID and you have leaked a merchant's bank statements to an unauthorized funder. Multi-tenant permission drift as features accrete. PII handling (SSNs on guarantors) argues for tokenization rather than encrypted-at-rest columns. And the transaction record is a *legal artifact* — immutability, retention, and legal hold need to be real database-level guarantees, not conventions.

---

## D. The MVP

### D.1 The one thing it must prove

> Can a real small business apply once, choose who sees its data, negotiate with verified funders inside the platform, and close a funded MCA — with a complete audit trail and a recorded fee?

Twenty of those, with real money, beats any amount of feature surface.

### D.2 Build

**The kernel (build first, everything else depends on it)**
- Orgs, users, org-scoped roles, MFA
- A single centralized authorization policy layer, server-side
- Append-only, hash-chained audit log
- Authorization object (scoped, revocable, expiring, logged)
- Configurable fee schedule engine

**The transaction**
- Merchant registration, business profile, MCA application
- Financial profile: bank connection preferred, document upload fallback
- Document vault with versioning, server-proxied access, per-access logging
- Rules-based matching with explicit, merchant-readable reasons and A–F grading
- Merchant authorization flow with an explicit, versioned consent artifact
- Provider workspace: queue, application detail, permissioned docs, doc requests
- Application-scoped messaging (merchant ↔ provider rep; merchant ↔ specialist)
- Structured underwriting states with coded decline reasons
- Offer creation with jurisdiction-driven disclosure fields; immutable revisions; counteroffers; "request best and final"
- Funding confirmation → fee accrual → fee statement
- Transaction timeline (the merchant-facing rendering of the audit log)
- Admin: verification queue, access/audit explorer, fundings and fees, user management, impersonation with consent + banner + logging
- Event-based analytics wired to every H1–H10 metric from day one

**Specialist**: full data model, assignment, attribution, comp visibility, and a minimal working UI. Not deferred — it is likely your demand channel.

### D.3 Do not build

| Not building | Why |
|---|---|
| Money movement | Money transmitter licensing. Funder wires direct; we record and invoice. |
| Automated credit decisioning | Not the product; adds ECOA/FCRA surface for zero MVP value |
| E-signature / contract execution | Funder's paper. Record the outcome; integrate later. |
| Native mobile apps | Responsive PWA is sufficient |
| Real-time chat infrastructure | Polling + notifications. Nobody is expecting Slack. |
| SMS notifications | In-app + transactional email. SMS is a phase-2 module. |
| Multi-product configuration UI | Schema is product-agnostic; UI ships MCA only |
| ML matching | Rules engine with versioned rulesets. Collect the outcome data that makes ML possible later. |
| Merchant acquisition tooling | Except: referral attribution and a specialist invite link. Those are cheap and you'll need them. |
| Public provider directory / SEO surface | Invites lead-gen dynamics you're trying to escape |
| Dispute resolution workflow | Admin notes + manual process until you have disputes |
| Syndication / participation tracking | Real, but not MVP |

### D.4 Sequencing decision

Build the **kernel** before the application form. Retrofitting server-enforced authorization and tamper-evident audit into a working CRUD app is the classic fintech disaster, and it is doubly dangerous in AI-assisted development where a generated route handler can quietly skip a check. Everything above the kernel is comparatively easy.

---

## E. Technical architecture

### E.1 Stack

| Layer | Recommendation | Why | Alternative considered |
|---|---|---|---|
| App | **Next.js (App Router) + TypeScript** | One repo, one deploy. Server Components mean data fetching is server-side *by default*, so the natural way to write a page is also the secure way. Best-in-class for AI-assisted development. | Remix (fine, smaller ecosystem); separate SPA + API (more surface, more auth bugs) |
| Database | **PostgreSQL** (Neon or Supabase) | Relational integrity is the product. Row-level constraints, partial unique indexes, and revocable table grants are how R1–R5 get enforced. JSONB where the schema must flex. | Nothing else is close for this |
| ORM | **Drizzle** | SQL-shaped, fully typed, migrations are readable SQL you can review. Prisma's abstraction hides exactly the queries you most need to audit. | Prisma |
| Auth | **Clerk** or **WorkOS** | Organizations, invitations, MFA, and SSO out of the box. Building multi-tenant auth yourself costs 3–4 weeks and is where startups get breached. | Auth.js (free, but you build orgs/MFA/session management yourself) |
| Authorization | **Custom policy module + Postgres RLS as defense-in-depth** | A single `can(actor, action, resource)` function that every route calls, plus RLS so a missed check fails closed at the database. Explicit and greppable — critical when generating code with AI. | RLS alone (policy logic scattered across migrations; hard to reason about) |
| File storage | **S3 or Cloudflare R2**, private buckets | — | — |
| File delivery | **Server-proxied streaming, never public signed URLs** | A signed URL is a bearer token you cannot revoke and cannot log on re-fetch. Proxying costs latency and buys you a logged, revocable, watermarkable access event. This is the trust layer. | Signed URLs (faster, unauditable — rejected) |
| Background jobs | **Inngest** | Durable, typed, retries, no queue infrastructure to run | Trigger.dev; pg-boss |
| Bank data | **Plaid** (Assets + Transactions), optionally a statement-analytics layer | See C.7 | Ocrolus/MX |
| KYB | **Middesk** | Makes "verified" a real check, not a badge | Manual (viable at 25 providers; automate at 100) |
| Email | **Resend** or **Postmark** | Transactional deliverability | — |
| Product analytics | **PostHog** | Funnels, session replay, feature flags | — |
| Business analytics | **Postgres event tables + Metabase** | Your H1–H10 metrics must come from the transaction database, not a click stream | — |
| Errors / APM | **Sentry** | — | — |
| Secrets | Platform env + **Doppler** or **Infisical** | — | — |
| Hosting | **Vercel + Neon/Supabase**, US region, DPA in place | — | Fly.io / AWS if data residency demands |

**Why this stack and not a "real" enterprise one:** you are one founder with AI assistance. Every piece of infrastructure you run yourself is a piece you maintain at 2am. This stack has roughly two things to operate (app, database) and buys the rest. When you're at 5,000 transactions a month you will have the revenue to reconsider; you will not have the revenue if you spend the next four months on Kubernetes.

### E.2 The authorization model, stated precisely

Every request resolves to `(actor_user, actor_org, actor_role, resource, action)` and passes through one function. The rules:

**Merchant org member**
- Full access to own business, applications, documents, offers, messages
- May grant, scope, and revoke authorizations
- May not see other merchants, provider internals (buy rates, notes), or another provider's offers' internal fields

**Provider representative**
- Sees a *blinded* match summary pre-authorization. **The card was originally specced too thin (founder challenge, Aug 18) — a funder cannot triage on industry, state, and bands alone.** Revised contents:

  | Included pre-authorization | Excluded until authorization |
  |---|---|
  | NAICS code and specific industry (not just category) | Legal name, DBA |
  | State, plus metro or county | Street address |
  | Exact time in business | Owner names |
  | Requested amount, product, preferred frequency | Owner SSN, DOB, personal identifiers |
  | Average monthly revenue, average daily balance | Phone, email, any contact route |
  | Negative days, NSF count, deposit count and frequency | Raw bank statement PDFs and all documents |
  | **Existing positions: count, approximate balances, payment burden** | Website / online presence |
  | Payment-to-revenue ratio if funded at requested amount | |
  | Self-reported credit band | |
  | Grade, match reasons, profile confidence (bank-verified vs. stated) | |
  | Platform history: prior applications, prior fundings, prior decline count | |

  That is enough to make a buy/no-buy decision on the large majority of MCA files. Everything in the right column arrives the moment the merchant authorizes — funders underwrite on the complete file, they simply do it after the merchant says yes rather than before.

  **Why the right column stays out.** None of it changes a triage decision. All of it enables circumvention. Contact information is the critical one: a funder holding the merchant's phone number pre-authorization can call directly, fund off-platform, and never pay a fee — and that is also precisely the solicitation flood the platform exists to eliminate. Raw statements additionally carry account and routing numbers, the business name and address, and the merchant's entire customer and vendor list.

  **The legitimate identity needs at triage are solved with hashing, not disclosure.** Funders have three real reasons to want a name early: is this merchant already in my pipeline from an ISO, are they on my do-not-fund list, and have they defaulted on me before. All three are answerable by exchanging salted hashes of business identifiers — the platform flags *"already in your pipeline"* or *"matches your exclusion list"* without either side revealing the merchant. Build this; it removes the strongest legitimate argument for pre-authorization disclosure.

  **Instrument the card's quality.** Post-authorization decline rate is the measure of whether the blinded card is rich enough. A funder that accepts blind, receives the file, and declines on facts that should have been on the card has wasted its own cycles and handed the merchant a bad experience. If that rate runs high, add fields — do not add identity.

  > **Superseded Sep 2026 (founder decision, binding):** there is no blinded card. A matched-but-unauthorized funder sees **nothing** — no industry, state, revenue, positions, amount, grade, or any other field, and is not told the file exists or that it was matched. Visibility begins only when the merchant grants access; revoked or expired access returns to nothing. There is no pre-authorization queue and no "express interest" action. An authorized funder is not told how many other funders hold the file. Grading (A–F) is internal only, used to pick the suggested set, and is never funder-facing. Post-funding blind *position* visibility on a later reapplication is unchanged. Implemented in `lib/provider-view.ts` (`no_access`), `lib/policy.ts`, and migration 0011. The table and reasoning above are kept as history.
- Post-authorization, sees exactly what the authorization scope grants — and nothing beyond it
- Sees only its own org's offers and its own conversations
- Access ends on revocation, expiry, or application close, with a configurable read-only grace window for records it acted on

**Funding Specialist**
- Sees only assigned applications, only after explicit merchant consent, scoped by assignment window
- Every action attributed to the specialist and visible to the merchant in the timeline

**Admin**
- Governance access by default (verification, users, fees, aggregate analytics)
- Reading merchant documents or message content requires elevated role + a stated reason + logged access + a merchant-visible entry. Admin access is logged the same as everyone else's.

**Defense in depth**
1. Policy function on every route
2. Postgres RLS keyed to a session-set actor context
3. All resource IDs are UUIDv7 (non-enumerable, still index-friendly)
4. Documents delivered only through an authorized proxy route
5. Integration test suite that asserts *denial* for every role × resource pair — this suite is the spec

### E.3 API structure

REST under `/api/v1`, resource-scoped, with server actions for internal mutations.

```
POST   /api/v1/applications
PATCH  /api/v1/applications/:id
POST   /api/v1/applications/:id/submit
GET    /api/v1/applications/:id/matches
POST   /api/v1/applications/:id/authorizations        { provider_id, scope }
DELETE /api/v1/authorizations/:id                      (revoke)
POST   /api/v1/applications/:id/documents
GET    /api/v1/documents/:id/versions/:v/content       (proxied, watermarked, logged)
POST   /api/v1/applications/:id/document-requests
POST   /api/v1/conversations/:id/messages
POST   /api/v1/applications/:id/underwriting-states
POST   /api/v1/applications/:id/offers
POST   /api/v1/offers/:id/revisions
POST   /api/v1/offers/:id/counteroffers
POST   /api/v1/offers/:id/accept
POST   /api/v1/applications/:id/best-and-final          (broadcast to authorized)
POST   /api/v1/applications/:id/fundings
GET    /api/v1/applications/:id/timeline
GET    /api/v1/admin/...
```

Every mutating endpoint: idempotency key, Zod-validated body, policy check as the first statement, audit write inside the same transaction as the domain write. That last point matters — **audit is written transactionally with the change, not fired afterward**, or your evidence has gaps exactly where it matters.

---

## F. Database design

Postgres. UUIDv7 primary keys. `timestamptz` everywhere. Append-only tables have `UPDATE`/`DELETE` revoked from the application role.

### F.1 Identity & organizations

```sql
users(id, email UNIQUE, phone, auth_provider_id, full_name,
      status, mfa_enabled, last_login_at, created_at)

organizations(id, type ENUM('merchant','provider','specialist','platform'),
      legal_name, dba, status, created_at)

org_members(id, org_id → organizations, user_id → users,
      role ENUM('owner','admin','rep','underwriter','specialist','viewer'),
      status, invited_by, joined_at, removed_at)
      UNIQUE (org_id, user_id) WHERE removed_at IS NULL
```

### F.2 Merchant side

```sql
merchant_businesses(id, org_id → organizations, legal_name, dba, entity_type,
      ein_token, naics_code, industry_label, state, address_json, website,
      inception_date, kyb_status, kyb_vendor_ref, kyb_checked_at, created_at)

merchant_owners(id, business_id → merchant_businesses, full_name,
      ownership_pct, ssn_token, dob_token, address_json,
      self_reported_credit_band, fcra_consent_id → consents)
      -- ssn/dob are vault tokens, never raw values

applications(id, business_id, product_type, requested_amount, use_of_funds,
      preferred_frequency, status ENUM('draft','submitted','matching',
        'authorizing','in_underwriting','offers_received','negotiating',
        'accepted','funded','withdrawn','expired','declined'),
      grade CHAR(1), ruleset_version, created_by, submitted_at, closed_at)
      INDEX (business_id, status), INDEX (status, submitted_at)

financial_profiles(id, application_id, source ENUM('bank_link','statement_parse','manual'),
      period_start, period_end, months_covered, avg_monthly_revenue,
      avg_daily_balance, negative_days, nsf_count, deposit_count,
      computed_at, confidence)
      -- normalized underwriting metrics, source-agnostic

bank_connections(id, business_id, aggregator, item_token, institution_name,
      accounts_json, status, consent_id → consents, connected_at, revoked_at)

existing_obligations(id, application_id, funder_name, obligation_type,
      original_amount, current_balance, payment_amount, frequency,
      position, source ENUM('merchant_stated','bank_detected','provider_reported'),
      confidence, detected_at)
```

### F.3 Provider side

```sql
providers(id, org_id, legal_name, verification_status
      ENUM('unverified','pending','verified','suspended','offboarded'),
      verified_at, verified_by, kyb_ref, website, participation_agreement_id)

provider_registrations(id, provider_id, jurisdiction, registration_type,
      registration_number, status, effective_from, effective_to)
      -- feeds the jurisdictional gate

provider_products(id, provider_id, product_type, min_amount, max_amount, active)

provider_criteria(id, provider_id, product_id, criterion_key, operator,
      value_json, is_hard BOOLEAN, weight, active,
      effective_from, effective_to)
      -- EAV so criteria change without migrations; versioned for match replay

provider_appetite(id, provider_id, week_of, accepting BOOLEAN,
      capacity_note, industries_paused_json, updated_by, updated_at)
      -- addresses the stale-criteria problem in A.2

provider_doc_requirements(id, provider_id, doc_type, required_at_stage)
```

### F.4 Matching

```sql
match_runs(id, application_id, ruleset_version, inputs_snapshot_json, created_at)

matches(id, match_run_id, application_id, provider_id,
      result ENUM('match','possible','no_match'), score,
      reasons_json,          -- [{criterion, merchant_value, provider_requirement, passed}]
      suppressed_reason,     -- e.g. 'jurisdiction_not_registered', 'appetite_paused'
      created_at)
      INDEX (application_id, result)
```

`inputs_snapshot_json` + `ruleset_version` means every historical match is replayable. When a funder asks "why didn't I see this deal," you can answer exactly.

### F.5 Authorization — the heart

```sql
authorizations(id, application_id, provider_id, granted_by_user_id,
      status ENUM('active','revoked','expired'),
      scope_json,            -- {profile:true, financial_summary:true,
                             --  documents:['bank_statement','id'], raw_statements:false}
      consent_id → consents,
      granted_at, expires_at, revoked_at, revoked_reason)
      UNIQUE (application_id, provider_id) WHERE status='active'

authorization_events(id, authorization_id, event, actor_user_id,
      metadata_json, at)     -- APPEND ONLY

consents(id, subject_type, subject_id, consent_type, text_version,
      text_hash, accepted_by_user_id, accepted_at, ip, user_agent)
      -- APPEND ONLY. Every authorization, FCRA pull, bank link,
      -- specialist assignment, and disclosure view produces one.
```

Note `raw_statements: false` in the default scope — that is C.10 made structural. Raw PDFs are a separate, second grant.

### F.6 Documents

```sql
documents(id, business_id, application_id NULL, doc_type,
      current_version_id, status, created_by, deleted_at)

document_versions(id, document_id, version_no, storage_key, sha256,
      byte_size, mime_type, period_start, period_end,
      uploaded_by, uploaded_at, parse_status)
      UNIQUE (document_id, version_no)   -- APPEND ONLY

document_access_events(id, document_version_id, actor_user_id, actor_org_id,
      authorization_id NULL, action ENUM('view','download','print'),
      watermark_token, ip, user_agent, at)   -- APPEND ONLY
      INDEX (document_version_id, at), INDEX (actor_org_id, at)

document_requests(id, application_id, provider_id, requested_by_user_id,
      doc_type, description, status, due_at,
      fulfilled_version_id, created_at, fulfilled_at)
```

### F.7 Communication

```sql
conversations(id, application_id,
      type ENUM('merchant_provider','merchant_specialist','specialist_provider'),
      provider_id NULL, specialist_user_id NULL, status)
      UNIQUE (application_id, type, provider_id)

conversation_participants(id, conversation_id, user_id, org_id, role,
      joined_at, removed_at)

messages(id, conversation_id, sender_user_id, body, created_at,
      redacted_at, redacted_by)      -- APPEND ONLY; redaction never deletes
      INDEX (conversation_id, created_at)

message_attachments(id, message_id, document_version_id)
```

### F.8 Underwriting

```sql
underwriting_states(id, application_id, provider_id,
      status ENUM('not_started','reviewing','pending_docs','pending_conditions',
        'approved','declined','withdrawn'),
      decline_reason_code, decline_reason_text, conditions_json,
      changed_by_user_id, changed_at, merchant_visible BOOLEAN)
      -- APPEND ONLY; current state = latest row
      INDEX (application_id, provider_id, changed_at DESC)

decline_reason_codes(code, label, merchant_facing_label, remediation_hint)
      -- structured, so C.8 aggregation is possible
```

### F.9 Offers, disclosure, negotiation

```sql
offers(id, application_id, provider_id, current_revision_id,
      status ENUM('draft','submitted','viewed','countered','revised',
        'accepted','declined','expired','withdrawn'),
      created_by_user_id, created_at)
      INDEX (application_id, provider_id)

offer_revisions(id, offer_id, revision_no, supersedes_revision_id,
      amount, pricing_json,        -- product-typed: MCA = {factor_rate, holdback_pct}
      total_payback, payment_amount, payment_frequency,
      estimated_term_days, fees_json, conditions_text,
      disclosure_json,             -- amount_financed, finance_charge,
                                   -- total_repayment, estimated_apr,
                                   -- prepayment_policy, itemized_fees
      disclosure_ruleset_version, disclosure_hash,
      expires_at, created_by_user_id, created_at)
      UNIQUE (offer_id, revision_no)   -- APPEND ONLY

disclosure_rulesets(id, jurisdiction, version, required_fields_json,
      effective_from, effective_to)
      -- drives server-side validation and UI rendering per B.3.2

disclosure_views(id, offer_revision_id, viewed_by_user_id,
      rendered_hash, at)   -- APPEND ONLY: what the merchant saw, when

counteroffers(id, offer_id, from_revision_id, merchant_user_id,
      requested_amount, requested_pricing_json, requested_frequency,
      requested_term_days, message, status, created_at)   -- APPEND ONLY

best_and_final_requests(id, application_id, requested_by_user_id,
      deadline_at, created_at)

offer_events(id, offer_id, revision_id, event, actor_user_id,
      metadata_json, at)   -- APPEND ONLY
```

`pricing_json` rather than a `factor_rate` column is what makes R7 (product agnosticism) real. An equipment lease or a term loan slots in without a migration.

### F.10 Funding, fees, specialists

```sql
fundings(id, application_id, offer_revision_id, provider_id,
      funded_amount, net_disbursed, funded_at,
      confirmation_source ENUM('provider_attested','merchant_confirmed','bank_verified'),
      confirmed_by_user_id, contract_ref, created_at)

fee_schedules(id, provider_id NULL, product_type NULL,
      fee_type ENUM('success','subscription','specialist','data'),
      rate_bps, min_fee, max_fee, tier_json,
      effective_from, effective_to, agreement_id)
      -- NULL provider_id = platform default. Never hardcode 3%.

platform_fees(id, funding_id, fee_schedule_id, basis_amount, rate_bps,
      fee_amount, status ENUM('accrued','invoiced','paid','waived','disputed'),
      invoice_ref, accrued_at, invoiced_at, paid_at)

specialist_assignments(id, application_id, specialist_user_id,
      consent_id → consents, compensation_model_ref,
      assigned_at, ended_at)

financing_signals(id, business_id, signal_type
      ENUM('active_application','recent_funding','detected_debit',
           'off_platform_funding_suspected'),
      provider_id NULL, source, confidence, detected_at, metadata_json)
      -- stacking (C) and circumvention (C.6) detection
```

### F.11 Audit & notifications

```sql
audit_events(id BIGSERIAL, actor_user_id, actor_org_id, impersonated_by_user_id,
      action, object_type, object_id, application_id,
      ip, user_agent, metadata_json, at,
      prev_hash, hash)     -- APPEND ONLY, hash-chained
      INDEX (application_id, at), INDEX (actor_org_id, at), INDEX (object_type, object_id)

notifications(id, user_id, type, payload_json, read_at, created_at)
```

`hash = sha256(prev_hash || canonical_json(row))`. Chain head published daily to an external store. That is cheap tamper-evidence, and it is the difference between "we have logs" and "we can demonstrate the logs weren't altered" — which is the actual requirement for Part XVIII.

### F.12 Enforcement, not convention

```sql
REVOKE UPDATE, DELETE ON
  audit_events, authorization_events, document_access_events,
  document_versions, offer_revisions, counteroffers, offer_events,
  underwriting_states, consents, disclosure_views
FROM app_user;
```

Append-only enforced by grants, not by developer discipline. This is one of the highest-leverage twenty minutes in the whole build.

---

## G. Screen structure

### G.1 Merchant (mobile-first)

```
Onboarding    Sign up → verify email/phone → business profile → owner(s)
Application   Amount & purpose → business details → financials
              (Connect bank [preferred] | Upload statements) → review → submit
Home          "Your $100,000 request" status card
              ⚠ Action Required (doc requests, offers expiring, counters awaiting reply)
              Provider strip: N authorized · N reviewing · N offers · N declined
              Latest offer summary · Unread messages · Recent timeline
Matches       Provider cards: verified badge, products, range,
              "Why this provider" (explicit reasons), grade fit
              → Authorize: consent sheet showing EXACTLY what is shared,
                with raw-statements as a separate toggle
Access        Who has access · what they viewed and when · Revoke
Documents     By type · versions · who viewed each · upload/replace
Offers        Compare (mobile: stacked cards; key metrics first:
              payment, total payback, term, estimated APR where required)
              → Detail with full disclosure block
              → Counter · Accept · Request best & final (all providers)
Messages      Thread per provider · document requests inline
Timeline      The transaction record, plain language
Help          Request a Funding Specialist (explains cost & role before consent)
```

The merchant home must answer, above the fold: *what's happening, what do I need to do, what are my offers.*

### G.2 Provider (desktop)

```
Queue          Tabs: New matches (blinded) · Authorized · In underwriting ·
               Offered · Won · Lost/Declined.  Filter by state, industry,
               amount, grade, revenue.
Blinded card   Industry · state · revenue band · TIB band · amount · grade ·
               match reasons.  Action: Express interest (notifies merchant)
Application    Business profile · financial summary (normalized metrics) ·
               obligations · ⚠ stacking signals · documents · timeline
Documents      Watermarked in-browser viewer · Request document
Underwriting   Set status · structured decline reason · conditions
Offers         Builder with live disclosure preview per merchant jurisdiction ·
               revision history · counters inbox
Funding        Confirm funded · amount · date · contract ref → fee statement
Company        Criteria editor (versioned) · appetite toggle ·
               representatives · registrations · agreements · fee schedule
```

> **Superseded Sep 2026:** the provider queue has no "New matches (blinded)" tab, no blinded card, no Express interest action, and no grade filter or column. The queue lists only files with a live authorization; with none, it is empty. See the Provider representative note above.

Note the **appetite toggle** — a one-click "we're paused on restaurants this week." Cheap to build, and it directly addresses the stale-criteria failure mode in A.2.

### G.3 Funding Specialist

```
My merchants   Assigned applications · stage · action needed
Application    Merchant's view + provider threads where authorized
Notes          Internal, but flagged as visible-on-request to the merchant
Comp           What this file pays and to whom — the same view the merchant sees
```

### G.4 Admin

```
Verification   Provider queue: KYB result, registrations, docs, principals
               → Approve/reject WITH REASON (logged, no silent approvals)
Users          Search · suspend · reactivate · role changes
Applications   Search · filter · detail · timeline
Trust & Safety Access log explorer · document activity · anomaly flags
               (bulk downloads, off-hours access, post-revocation attempts)
Transactions   Fundings · fee accrual · invoicing · disputes
Analytics      H1–H10 dashboards, funder scorecards, marketplace metrics
Config         Fee schedules · rulesets · disclosure rulesets · feature flags
Impersonation  Requires reason + merchant consent + banner + full logging
```

---

## H. Roadmap

Assumes founder + 1–2 engineers with heavy AI assistance. Weeks are estimates, not commitments.

| # | Milestone | Contents | ~Weeks |
|---|---|---|---|
| M0 | **Kernel** | Repo, CI, Postgres, Drizzle, auth + orgs + MFA, `can()` policy module, RLS, append-only grants, hash-chained audit, deny-test suite | 2–3 |
| M1 | **Merchant intake** | Registration, business profile, MCA application wizard, document vault w/ versioning, proxied+logged delivery | 2 |
| M2 | **Provider & verification** | Provider org, reps, criteria editor, appetite, registrations, admin verification queue | 2 |
| M3 | **Matching + authorization** | Rules engine, versioned rulesets, match reasons, grading, jurisdictional gate, authorization + consent flow, Access Center | 2 |
| M4 | **Provider workspace** | Blinded queue (superseded Sep 2026: authorized-only queue), authorized detail, watermarked doc viewer, document requests | 2 |
| M5 | **Messaging** | Scoped conversations, notifications, in-app + email | 1–2 |
| M6 | **Underwriting** | State machine, structured decline reasons, merchant-facing aggregation | 1 |
| M7 | **Offers & negotiation** | Offer builder, disclosure engine + rulesets, revisions, counters, best-and-final, comparison UI | 3 |
| M8 | **Funding & fees** | Funding confirmation, fee schedules, accrual, statements, merchant timeline | 1–2 |
| M9 | **Specialist** | Assignment, consent, scoped access, attribution, comp transparency | 1–2 |
| M10 | **Bank connectivity** | Aggregator integration, normalized financial profile, stacking + circumvention signals | 2 |
| M11 | **Admin & analytics** | Full console, H1–H10 dashboards, funder scorecards | 2 |
| M12 | **Security & launch** | Threat model, external pen test, IDOR sweep, key rotation, backups + restore drill, incident runbook, legal agreements wired in | 2–3 |
| M13 | **Pilot** | 10–25 verified funders, seeded merchants, 20 real transactions, weekly hypothesis review | ongoing |

**Sequencing note:** M10 (bank connectivity) is listed after M9 for dependency reasons but if C.1 (merchant acquisition) resolves in favor of a partnership channel that already has bank data, pull it forward to M2. And if the specialist channel is the demand answer, M9 moves to right after M4.

---

## I. First build: the vertical slice

Do not build M0–M13 in sequence to completion. Build a **single-file-deep path through the whole system** first, with one test merchant and two clearly-labeled test providers, then widen.

### I.1 The slice

```
1.  Merchant registers, creates business, submits an MCA application
2.  Merchant uploads 3 months of bank statements (mock parse; labeled as such)
3.  Rules engine returns matches with explicit reasons + a grade
4.  Merchant authorizes 2 of 5 matched providers; consent captured
5.  Providers 1 & 2 see the file; providers 3–5 see nothing (asserted by test)
6.  Provider 1 opens a statement → access event logged → merchant sees it
7.  Provider 1 requests MTD statement → merchant notified
8.  Merchant uploads MTD once → both authorized providers see it
9.  Provider 1 sets underwriting → approved; issues offer with disclosure block
10. Merchant views offer (disclosure view recorded), counters
11. Provider 1 revises (revision 2; revision 1 immutable and still visible)
12. Merchant accepts
13. Provider 1 marks funded → fee accrues at the configured rate
14. Merchant timeline renders every step from the audit log
15. Merchant revokes provider 2 → provider 2 loses access immediately (asserted)
```

### I.2 Definition of done

- Every step above passes an automated end-to-end test
- The **deny suite** passes: for each of ~40 role × resource pairs, unauthorized access returns 403 and is logged
- A direct GET on an unauthorized document URL fails, with the attempt logged
- The audit hash chain verifies from genesis
- The fee amount is derived from `fee_schedules`, with 3% present as *data*, not code
- Every mock (statement parsing, KYB, verification badge on test providers) is visibly labeled in the UI
- Both test providers are labeled `TEST PROVIDER` in every view

### I.3 What I need from you before I start

1. **Where do the first 100 merchants come from?** (C.1 — this changes the build order)
2. **Blind or open offer visibility?** My recommendation is blind + best-and-final. (C.3)
3. **Bank connectivity in or out of the MVP?** My recommendation is in, as the preferred path. (C.7)
4. **Are you willing to be regulated as a broker?** If yes, we build the registration matrix and jurisdictional gate in M2 rather than retrofitting. (B.3.1)
5. **Do brokers become your first Funding Specialists?** If yes, M9 moves way up. (C.11)
6. **Confirm: no money movement in the MVP.** (R10)

Answer 1–3 and I'll start on M0 immediately.

---

## Standing test for every decision from here

1. Does it increase merchant control?
2. Does it improve transparency?
3. Does it improve trust?
4. Does it improve transaction efficiency?
5. Does it improve funder ROI?
6. Does it strengthen the transaction record?
7. Does it serve the long-term infrastructure vision?
8. Does it belong in the MVP?

Mostly no → we don't build it.

---

*Legal and regulatory content in this document is research and issue-spotting, not legal advice. I am not a lawyer. Every item in B.3 needs to go to counsel before launch, and the state-by-state picture is moving fast enough that it should be re-verified at the time you act on it.*

---

# ADDENDUM — Decisions Log, August 18, 2026

## Founder answers to I.3

| # | Question | Answer |
|---|---|---|
| 1 | First 100 merchants | Existing broker shop (20+ brokers) becomes the Funding Specialist network. Brokers cold call / outsource as they do today. Social media + word of mouth. Heavy direct-to-merchant marketing only after traction. |
| 2 | Offer visibility | **Blind.** Funders do not see each other's terms. |
| 3 | Bank connectivity | **In the MVP.** |
| 4 | Broker classification | *Still open — see B.3.1. The captive broker shop makes the technology-provider argument materially weaker.* |
| 5 | Brokers as specialists | **Yes — this is the plan, not an option.** |
| 6 | No money movement | *Awaiting explicit confirmation.* |

## The captive-origination structure changes the model

CapNet and the broker shop share ownership. That resolves the cold-start problem completely and creates three new ones.

### 1. Phase 1 cannot test the economic thesis

| Hypothesis | Phase 1 (broker-sourced) | Phase 2 (direct/self-serve) |
|---|---|---|
| H1 merchants prefer one controlled application | Partial — merchant did not choose the platform | Yes |
| H2 merchants value controlling access | Yes | Yes |
| H3 merchants talk directly to funder reps | Yes | Yes |
| H4 funders accept permissioned direct submissions | Yes | Yes |
| H5 funders pay a success fee | **No** — funder is already paying broker points | Yes |
| H6 removing spread creates price competition | **No** — spread is still present | Yes |
| H7 better-fit files improve funder conversion | Yes | Yes |
| H8 centralized docs reduce friction | Yes | Yes |
| H9 merchants transact without a broker | **No** — a broker is in every deal | Yes |
| H10 merchants value optional human help | Partial — help is not optional in Phase 1 | Yes |

Phase 1 validates the **workflow**. Phase 2 validates the **economics**. Do not conflate them.

### 2. Funder compensation math must be dual-channel

A funder will not pay broker points *and* a 3% platform fee. Recommended structure:

- **Specialist-assisted deals (Phase 1):** broker compensation continues as today, itemized and disclosed to the merchant inside the platform. Platform success fee waived or nominal during pilot.
- **Self-serve deals (Phase 2):** funder pays the 3% success fee. No broker compensation. Merchant should see a lower sell rate.

Schema change: add `channel ENUM('self_serve','specialist_assisted')` to `fee_schedules` and to `applications`. Every funded deal carries its origination channel so the two economics are separable in analytics.

### 3. The broker shop is the control group

Same brokers, same lead sources, same funders, two paths. Instrument both:

| Metric | On-platform | Off-platform (broker shop as-is) |
|---|---|---|
| Time from application to first offer | | |
| Offers received per merchant | | |
| Funded rate | | |
| Median factor rate delivered to merchant | | |
| Document requests per file | | |
| Merchant repeat rate | | |

Off-platform figures can be reconciled manually each month. This is an unusually clean natural experiment and it is the strongest evidence you will ever have for a funder or an investor.

## New hard requirements

| # | Requirement | Rationale |
|---|---|---|
| **R11** | A Funding Specialist may **stage** a provider authorization but may never **grant** one. The merchant must confirm from their own authenticated session. Enforced in the policy layer. | Without this, the specialist becomes a broker with a database and merchant control is theater. This is the single control that keeps the company honest. |
| **R12** | No specialist or platform employee ever handles bank credentials. Bank linking is initiated from the merchant's own session/device via a sent link. | Credential handling is an unacceptable liability and a licensing problem. |
| **R13** | Specialist compensation on a funded deal is itemized and visible to the merchant **before acceptance**. | Recommended, not yet accepted by founder. Broker-compensation transparency is the direction several state disclosure regimes are moving; confirm specifics with counsel. |
| **R14** | Every application records `origination_channel` and, where applicable, `sourcing_specialist_id`, immutably at creation. | Required for the dual-channel economics and the control-group analysis. |

## Bank connectivity — accepted, with caveats

- **Link rates will disappoint.** MCA merchants are frequently reluctant to link accounts, particularly those carrying existing positions — which are exactly the merchants whose data you most want. Plan for a meaningful share never linking. Statement upload stays a first-class path, not a vestigial fallback.
- **Coverage is patchier for small business accounts** at regional banks and credit unions than for consumer accounts. Test coverage against a real sample of the broker shop's recent merchants before committing to it as the primary path.
- **Consent is layered.** Merchant consents to CapNet reading the account. Each provider's access to *derived metrics* is a separate scope from access to *raw transaction detail*. Default the raw scope off.
- **Positioning matters.** Frame linking as "increases your match quality and reduces document requests," never as verification or surveillance.

## Revised roadmap

Specialist tooling moves from M9 to M5 because 20 brokers are day-one users, and bank connectivity ships alongside it since merchants will link during specialist-assisted calls.

| # | Milestone | ~Weeks |
|---|---|---|
| M0 | Kernel — auth, orgs, roles, policy layer, RLS, append-only grants, hash-chained audit, deny-test suite | 2–3 |
| M1 | Merchant intake + document vault | 2 |
| M2 | Provider org, criteria, appetite, registrations, admin verification | 2 |
| M3 | Matching + authorization + consent (**R11 enforced here**) | 2 |
| M4 | Provider workspace + permissioned docs + document requests | 2 |
| M5 | Specialist workspace + bank connectivity | 2–3 |
| M6 | Messaging | 1–2 |
| M7 | Underwriting states + structured decline reasons | 1 |
| M8 | Offers + disclosure engine + blind negotiation + best-and-final | 3 |
| M9 | Funding + dual-channel fee engine | 2 |
| M10 | Admin console + analytics incl. on/off-platform comparison | 2 |
| M11 | Security hardening + external pen test + legal agreements wired in | 2–3 |
| M12 | Pilot — 10–25 funders, first 20 real transactions | ongoing |

Roughly 23–27 weeks to pilot. A thinner first release (deferring bank connectivity, admin console, and specialist polish) could put the vertical slice in front of real brokers in 10–12 weeks.

## Regulatory note, updated

Owning the origination channel makes the technology-provider classification substantially harder to sustain. The broker shop's existing registration posture — whatever it is today — becomes the posture CapNet inherits in the eyes of a regulator. Texas registration for providers and brokers of sales-based financing opens toward a December 31, 2026 deadline. This should go to counsel now rather than at launch.

## M0 scope, ready to build

1. Next.js + TypeScript + Drizzle + Postgres, CI, environments
2. Auth with organizations and MFA; `users`, `organizations`, `org_members`
3. `can(actor, action, resource)` policy module — single entry point, exhaustively tested
4. Postgres RLS keyed to session actor context (defense in depth)
5. `REVOKE UPDATE, DELETE` on all append-only tables
6. `audit_events` with hash chaining + transactional write helper
7. `consents` table + consent capture primitive
8. UUIDv7 everywhere
9. Deny-test suite: every role × resource pair asserts 403 + logged attempt
10. Seed: one test merchant, two `TEST PROVIDER`-labeled providers, one specialist, one admin


---

# DECISION — Direct-only launch (supersedes the Aug 18 addendum)

**The broker-sourced Phase 1 is cancelled.** CapNet launches direct-to-merchant. The founder's broker shop remains a separate business and does not route deals through the platform.

Rationale: broker-in-the-loop contaminates the proof (H5, H6, H9 stay untestable), signals arbitrage to funders, marks down in diligence, and — the founder's own reason — defeats the purpose of the platform.

## What this supersedes in the addendum

| Addendum item | Status |
|---|---|
| Phase 1 / Phase 2 hypothesis split | **Void.** All ten hypotheses are testable in the MVP. |
| Dual-channel fee economics | **Deferred.** Keep `channel` on `fee_schedules` and `applications`; only `self_serve` is used at launch. |
| Broker shop as control group | **Void as a designed experiment.** Informal comparison only. |
| M5 = Specialist workspace + bank connectivity | **Split.** Specialist tooling moves post-MVP. Bank connectivity stays, becomes M5. |
| R13 (specialist comp visible to merchant) | **Deferred** with the specialist role. Reinstate before any specialist ships. |

R11, R12, and R14 stand.

## Revised roadmap

| # | Milestone | ~Weeks |
|---|---|---|
| M0 | Kernel — auth, orgs, roles, policy layer, RLS, append-only grants, hash-chained audit, deny-test suite | 2–3 |
| M1 | Merchant intake: **pre-qualification → match preview → full application** → document vault | 2–3 |
| M2 | Provider org, criteria, appetite, registrations, admin verification | 2 |
| M3 | Matching + authorization + consent | 2 |
| M4 | Provider workspace + permissioned docs + document requests | 2 |
| M5 | Bank connectivity + normalized financial profile | 2 |
| M6 | Messaging | 1–2 |
| M7 | Underwriting states + structured decline reasons (**decline-reason codes are also a demand channel — see below**) | 1 |
| M8 | Offers + disclosure engine + blind negotiation + best-and-final | 3 |
| M9 | Funding + fee engine | 1–2 |
| M10 | Admin console + analytics + **acquisition-source attribution** | 2 |
| M11 | Security hardening + external pen test + legal agreements | 2–3 |
| M12 | Pilot | ongoing |

~20–25 weeks to pilot. Merchant onboarding (M1) is now the highest-leverage surface in the product: cold merchants drop off at every friction point a broker used to absorb.

## Investor profile — resolved concerns

Retired funder/broker taking **equity**, not deploying deal capital. This resolves both flags raised earlier: no competing active book, and alignment with platform outcomes rather than deal flow.

Open items: length of retirement (network decay), residual positions or syndication interests, role definition (passive investor vs. chairman vs. BD partner), and check size / instrument / valuation / control terms. Counsel required on the last set.

**The question that matters most:** his network is the asset, and his network is also the constituency the platform's anti-circumvention and disclosure controls constrain. Establish before closing whether he will support enforcement against funders who are personal friends.

## Demand is now the sole open risk

With brokers out, merchant acquisition has no proven channel. Ranked:

| Rank | Channel | Quality | CAC | Lead time | Notes |
|---|---|---|---|---|---|
| 1 | **Funder decline flow** | Mixed — see below | Near zero | Short, relationship-gated | Only openable by someone with the investor's network |
| 2 | **Partnerships** (POS/processors, bookkeepers, franchise networks, equipment dealers, insurance brokers) | High | Low | 3–9 months | Start now; longest lead time |
| 3 | Content / SEO | Medium | Low | 6–12 months | Supporting channel, not primary |
| 4 | Paid search | Medium | Very high | Short | Constrained by state disclosure rules on financing marketing |
| 5 | Direct outbound / UCC data | Low | Medium | Short | Rebuilds the broker function in-house; contradicts the thesis |
| 6 | Aged / declined lead purchase | Very low | Low | Short | Inherits the spam problem the platform exists to solve |

### Fit declines vs. credit declines

Funders decline for **fit** as often as for **credit**. Wrong industry, wrong state, amount above or below their band, position count — those merchants are perfectly fundable by someone else. Credit declines mostly are not.

So the decline-flow ask is not "send us your declines." It is **"route declines by reason code."** Fit declines are high-intent, recently underwritten, near-zero-CAC demand. Credit declines are noise.

The `decline_reason_codes` table already in the schema is therefore not only a merchant-transparency feature — it is the routing key for the primary acquisition channel. Design the code taxonomy with both uses in mind.

### One meeting, both sides

Funder recruitment and decline-flow acquisition are the same conversation:

> Join as a verified provider. Also route your fit-declines to us — files you already said no to, so you lose nothing. When we fund one elsewhere you keep goodwill with the merchant and visibility on the renewal.

That single meeting seeds supply and demand simultaneously, and it is precisely the meeting the investor's network can open. It should begin in parallel with M0, not after the platform ships.


---

# GTM MECHANISM — Decline routing as the participation term

**Decision:** verified providers do not pay a subscription. The condition of participation is that they route declined merchants to CapNet.

This converts customer acquisition cost into a supply-side contract term, paid in access rather than cash. It is only demandable by someone with the network to demand it, which makes it a real "why us." It should be the centerpiece of the funder agreement.

Five things have to be right for it to work.

## 1. Funders cannot route ISO-sourced declines

The routable universe is the funder's **direct-sourced** declines only. Broker-sourced merchants belong to the ISO relationship: the funder frequently lacks direct contact rights, is contractually barred from soliciting around the broker, or would detonate its own channel by routing that merchant anywhere.

For an established MCA funder, direct origination is typically a minority of total volume. The channel is still large — a handful of funders' direct declines is thousands of merchants a month — but model it off direct volume, not total decline volume. **Ask every prospective funder for their direct-sourced share before signing.**

## 2. Referral, not data transfer

CapNet must not receive a declined merchant's file without the merchant's own action.

- **Preferred: tracked referral.** The funder sends the *merchant* a message on decline with a per-funder tracked link. No merchant data crosses until the merchant registers on the platform themselves.
- **Alternative: consent-at-intake.** The funder's own application carries an authorization to refer to CapNet on decline. Higher conversion, requires the funder to change intake, requires counsel.

This is not only a privacy and consent question. Ingesting merchant files that the merchant never sent is precisely the unsolicited data proliferation the platform exists to eliminate. Doing it at the front door would make the core promise false on day one.

## 3. Triage on ingest — fit vs. credit

Funders decline for **fit** (industry, state, amount band, position count) as often as for **credit**. Fit declines are fundable by someone else; credit declines mostly are not.

| Decline category | Destination |
|---|---|
| Fit | Straight into matching. High-intent, recently underwritten, near-zero CAC. |
| Credit | **Remediation track** — not "declined," but "not fundable yet," with specific guidance on what would change it and a re-engagement trigger. |
| Fraud / compliance | Blocked. Never enters matching. Flagged to trust & safety. |

The remediation track is an asset, not waste. Nothing in this industry does anything with a declined merchant except sell their data. And it composes with a decision already made: **if the merchant links their bank at decline time, re-eligibility is detected automatically** — when revenue recovers or negative days clear, the platform re-engages. That merchant is then yours, acquired at zero cost, at the exact moment they are fundable.

## 4. What the funder gets in return

A declined merchant is a re-marketing asset funders already work. Asking for it needs consideration:

- **Decline analytics.** "Of the 200 you routed, 34 funded elsewhere — here is the profile of what you are leaving on the table." Genuinely valuable underwriting intelligence that nobody provides today, and cheap for the platform to produce. This is the strongest of the three.
- **Right of first look on return.** If a merchant they declined comes back through the platform and now qualifies, that funder sees it first. Costs the platform nothing.
- **Renewal visibility.** Notification when a merchant they routed reaches paydown eligibility elsewhere.

## 5. Write it as permanent and observable

- **Permanent.** If funders read decline routing as a launch-phase condition, they will wait it out. Contract it as a standing obligation and let it become vestigial naturally as direct demand grows.
- **Observable.** "Route all declines" is unauditable — the platform cannot see a funder's decline volume. Write it as a good-faith obligation measured by what *is* observable: referral link activity, monthly self-reported direct-decline counts, and a participation scorecard reviewed quarterly.
- **Counsel item.** Conditioning marketplace access on routing referrals has a tying flavor. Low risk at pilot scale; revisit if the platform becomes dominant.

## Build consequences

| Change | Milestone |
|---|---|
| `decline_reason_codes` gains `category ENUM('fit','credit','fraud','compliance')` and `routable BOOLEAN` | M7 → move key parts to M2 |
| `referral_sources` + `acquisition_attributions` — which funder referred which merchant, permanently, for reciprocity and right-of-first-look | M1 |
| Per-funder tracked referral link generation | M2 |
| Merchant registration flow accepts a referral token and attributes it immutably | M1 |
| `applications.status` gains `not_fundable_yet` + remediation guidance + re-engagement trigger | M3 |
| Bank-data re-eligibility watcher | M5 |
| Funder-facing decline analytics dashboard — now part of the value proposition, not post-MVP | M10 → M4 (minimal version) |
| Right-of-first-look surfacing in matching | M3 |

## One caution on the long-term claim

Decline routing becoming unnecessary because "every merchant will know the platform" is the right ambition, but brand awareness at that scale is the product of years and substantial marketing capital, not of infrastructure quality alone. Infrastructure quality is what **retains** merchants and funders once acquired; it does not acquire them. Plan for decline routing and partnerships to carry acquisition for at least the first several years, and treat organic demand as upside rather than as the plan.


---

# COMPETITIVE LANDSCAPE

Added in response to the founder challenge: *"then what about Lendio or Fundbox?"* This is a gap the original document should have covered.

## The correction

Direct SMB acquisition without brokers is proven. Both companies did it, and neither used an ISO network. My earlier framing overstated the case.

What survives is the cost argument, and it is stronger evidence for the decline-routing strategy than against it.

| | Lendio | Fundbox |
|---|---|---|
| Founded | 2011 | 2013 |
| Model | Marketplace — not a lender | Balance-sheet lender |
| Network | 75+ lenders, 11 product types | Own capital + warehouse facilities |
| Scale | ~$15B facilitated, 300k+ loans | 500k+ businesses, $3B+ deployed |
| Capital raised | Multiple rounds over 14 years | ~$734M across 10 rounds |
| Monetization | Commission from lenders on funded deals; free to borrower | Interest / fees on own paper |
| Acquisition | Paid, SEO, partnerships, PPP surge | Embedded / platform partnerships, direct |

Fundbox raised roughly three quarters of a billion dollars. Lendio has been building since 2011 to reach $15B facilitated. **Neither acquired small businesses cheaply or quickly.** That is the point: acquisition in this category is a capital problem, which is exactly why a near-zero-CAC channel obtained through a contract term is worth more than it looks.

## Only one of them is a competitor

**Fundbox is not a competitor — it is a candidate provider.** It is a direct lender with embedded distribution, not a marketplace. It underwrites off bank data with near-total automation and same-day decisions. Two implications:

- Its underwriting model validates the bank-connectivity decision (M5).
- It sets the merchant expectation bar. Merchants who have used a product like this expect a decision in minutes. CapNet's funders underwrite manually, so the *platform* has to absorb that expectation gap — pre-qualification match preview, status visibility, and honest time-to-offer estimates. This is a UX requirement, not a nicety.

**Lendio is the direct competitor and the document should have said so.** Same shape as CapNet: one application, many lenders, free to the merchant, lender pays a commission when a deal funds. Fourteen years of head start, 75+ lenders, established brand and SEO. It is described in the market as operating as a broker earning commission from its lending partners — which independently reinforces the recommendation in B.3.1 to plan for broker classification.

## Where Lendio is weak, and why it matters

The reported weaknesses map almost exactly onto CapNet's stated differentiators:

| Reported Lendio weakness | CapNet's answer |
|---|---|
| Merchants report heavy marketing contact after applying | Merchant-controlled authorization: nobody gets the file without an explicit, scoped, revocable grant |
| Rates and terms are not knowable until you formally apply | Pre-qualification match preview with match rationale, before documents |
| Communication and responsiveness complaints | In-platform, application-scoped, verified, auditable messaging |
| No visibility into who has the file or what happened | Access Center, document access log, transaction timeline |
| Whether the merchant could get a better price going direct is an open question | Blind competing offers, best-and-final, immutable revision history |

## The positioning consequence

**Stop pitching novelty.** The pitch cannot be "nobody has built a marketplace for small business financing." Someone has, at scale, for fourteen years.

The accurate and stronger pitch is:

> Marketplaces for small-business capital already exist and already work at scale. Merchants distrust them for specific, documented reasons: they lose control of their information the moment they apply, they cannot see who has it, and they cannot see what the platform is earning. CapNet is the same marketplace motion rebuilt on merchant-controlled permissions and an auditable transaction record.

This is better ground than novelty. It means the market is validated — the question is execution on trust architecture, not whether demand exists.

It also sets the honest bar for diligence. Any investor who knows this space will ask about Lendio in the first meeting. Have the answer above ready, and have the merchant-control demo ready to show, because the argument is only credible as a working product.


---

# COST STRUCTURE — the sharpened H6

Founder reframe, August 18. This supersedes the price-competition framing of H6 and is a materially stronger hypothesis.

## The claim

Removing the broker spread lowers the funder's cost of acquiring the deal. That lets the funder sell at a lower factor **at unchanged margin**. A lower factor means a smaller daily or weekly payment. A smaller payment against the same revenue means less cash-flow strain, which means lower probability of default.

Price competition still contributes, but it is no longer the mechanism. That is the improvement: the old framing needed merchants to shop, wait, and be willing to walk — behavior C.3 argues many MCA merchants do not exhibit. The new framing needs only arithmetic on the funder's side.

## The arithmetic — take this into funder meetings

On a $100,000 advance:

| | Today (ISO channel) | On CapNet |
|---|---|---|
| Advance | $100,000 | $100,000 |
| Acquisition cost | ~12 points = $12,000 | 3% = $3,000 |
| Factor sold to merchant | 1.45 | **1.36** |
| Merchant payback | $145,000 | **$136,000** |
| Funder gross | $33,000 | **$33,000** |

**Identical funder economics. The merchant pays $9,000 less.** No competition required.

Then the second-order effect: at 1.36 over the same term the payment is roughly 6% smaller. Holding credit quality constant, a lower payment-to-revenue ratio reduces default probability — so the funder's *net* yield improves at the same gross. The funder is strictly better off, and it is a self-interested argument rather than an appeal to fairness.

This also explains the stacking death spiral in cost terms: a merchant whose first-position payment is oversized relative to revenue stacks to cover it, then defaults on both. Lower initial payment burden attacks the root cause.

## The weakness that remains

The funder *can* price lower. Nothing forces them to. They may pocket all nine points and keep selling at 1.45 — and commission savings are felt immediately while default improvements arrive over months, which is exactly the asymmetry that favors pocketing.

So the pass-through still needs a mechanism. Ranked:

1. **Publish relative pricing.** Show each funder where their pricing sits against the platform median for the same grade band. No open bidding, no funder sees another's terms, but nobody wants to be the most expensive provider on a marketplace that measures it. Cheapest and most likely to work.
2. **Blind competition + best-and-final** (already the design). Real but modest pressure.
3. **Contractual pricing commitment** — participation conditioned on pricing at or below the funder's ISO-channel equivalent. Hard to police; counsel item.

## Measurement — what changes

The old metric was the spread between first and best offer. The new instrumentation:

| Metric | Available | Notes |
|---|---|---|
| **Payment-to-revenue ratio at origination** | Day one | Computable from bank data. Validated leading indicator of distress. Provable inside the pilot rather than in three years. |
| Median factor by grade band, on- vs. off-platform | Requires funder cooperation | Trade for it using the decline analytics from the GTM section |
| Early-default rate by payment-to-revenue band | 6–18 months | The outcome metric. Long lag; start collecting immediately. |

## Product consequence

If the thesis is about payment burden, the merchant-facing offer comparison should **lead with payment-to-revenue, not factor rate.**

"This payment is 11% of your monthly revenue" tells a small business owner whether they will survive the deal. "1.36 factor" does not. It is the single most useful number available in an offer comparison, it is computable the moment the merchant links their bank, and no competitor surfaces it.

Add `payment_to_revenue_ratio` as a derived field on `offer_revisions`, computed against the current `financial_profiles` record and frozen with the revision.

## Framing discipline

Same fact, two audiences — do not cross them:

- **To merchants:** more manageable payments.
- **To funders:** better net yield through lower default.

Never market default reduction to merchants. And scope the claim honestly: *holding credit quality constant*, lower payment burden reduces default probability. A platform that expands volume into marginal files can see defaults rise even with better pricing. The claim is about payment structure, not about underwriting.

### This is a compliance boundary, not only a positioning one

A merchant-facing statement that the platform lowers their risk of default is an unsubstantiated performance claim about a financial product. That is FTC and state UDAP territory, and it sits squarely in what the newer commercial-financing disclosure regimes are built to police. "More manageable payments," tied to a disclosed payment-to-revenue figure the merchant can verify, is a factual statement. "Lowers your chance of default" is a promise about an outcome nobody controls.

### Make it structural, not a note in a document

Notes get ignored. Three cheap controls:

1. **Separate content namespaces.** Merchant-facing and funder-facing copy live in separate, role-gated bundles — never a shared string file. If they share a bundle, someone will reuse a string.
2. **Segmented analytics by default.** Every comparison of default rate against payment burden is segmented by grade band. Build it so the unsegmented version is not easily producible, because whoever produces it will eventually say it out loud in a funder meeting.
3. **A claims register.** One table, maintained from now: every external claim, its audience, its evidence, and its status — proven / hypothesis / aspirational. Nothing goes into a deck, a website, or a funder agreement unless it is in the register with a basis. This costs almost nothing and it is what stands between the company and both a bad diligence meeting and an enforcement letter.


---

# THE COLD-CALL PROBLEM — reframed

Founder insight, August 18. This is the correct framing and it should replace the vaguer language about "reducing unwanted solicitation" everywhere it appears.

## The reframe

CapNet cannot stop cold calls. It does not need to. **It destroys their expected value.**

Today a merchant takes every unsolicited funding call because any one of them might be the capital they need. The call is a lottery ticket they feel obliged to scratch. Once a merchant has authorized funders actively working their file inside the platform, and knows those funders will reach them there, the ticket is worth nothing. They can hang up without wondering what they missed.

This is a demand-side solution to a supply-side problem, and it is the only one available. Cold calls are structurally guaranteed: **funding creates a UCC filing, the filing is public, and UCC lists are the primary source of MCA calling lists.** Every merchant the platform funds joins those lists regardless of anything CapNet does. Which is precisely why "safe to ignore" is the achievable goal and "make them stop" is not.

## Four things this requires

**1. Platform-exclusive communication, contractually and enforceably.** The property collapses if even one authorized funder calls the merchant's cell. Funder agreements must commit to in-platform communication only, for platform-originated merchants. And enforcement gets a mechanism the merchant operates:

```sql
off_platform_contact_reports(id, merchant_user_id, application_id,
      alleged_provider_id NULL, channel, occurred_at, notes,
      status, reviewed_by, reviewed_at, created_at)
```

A one-tap **"an authorized funder contacted me outside the platform"** control on the merchant dashboard. Repeated reports against one provider trigger review and, eventually, offboarding. This turns every merchant into a sensor and is far more effective than trying to infer leakage from access logs.

**2. Notification reliability becomes safety-critical.** The original spec treated email and SMS as a modular phase-two concern. That is now wrong. If a merchant ignores their phone and then misses an offer expiry because a notification failed, the entire promise breaks in the worst possible way. Requirements: in-app plus push plus email, SMS for time-critical events only, delivery confirmation logged, and escalation when a critical notification goes unread. Platform SMS must come from one consistent recognizable sender so it is never confused with the calls the merchant is now ignoring.

**3. Time-to-first-offer becomes a protected metric, not a funnel statistic.** "Safe to ignore" only holds while the platform is actually delivering. A merchant sitting at zero offers after 48 hours starts answering cold calls again, and the trust proposition is spent. Set an internal service target and alert on breach.

**4. Make the property persistent, not episodic.** Between applications, cold calls regain their option value. The re-eligibility watcher already built for the decline-remediation track solves this: a standing "notify me when I qualify" state means the merchant is never in a window where an unsolicited call is worth taking.

## Claims discipline

Per the claims register: **do not say the platform stops unwanted calls.** It does not, and the UCC mechanism guarantees it never will.

Say what is true and verifiable: *your authorized funders will always reach you here, so you never have to take a call to get funding.*

## A note on the relationship-only funder strategy

Working only with capital providers the founder knows personally is the right posture for the pilot and the fastest route to trustworthy supply. It also has a ceiling. Growth eventually requires funders nobody at the company knows, and at that point verification, contractual terms, access logging, and the off-platform contact reports have to carry the weight that personal relationships carry today.

Build all of it now, while it feels redundant. Those controls are precisely what lets the company eventually stop needing friends.

