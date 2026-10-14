**DRAFT — NOT LEGAL ADVICE. Must be reviewed and approved by counsel before publication.**

**Last updated: [FOUNDER: date]**

# CapNet Privacy Policy

## 1. Who we are

CapNet ("CapNet," "we," "us") is operated by [FOUNDER: legal entity name], a [FOUNDER: state of formation] entity, at [FOUNDER: mailing address]. CapNet is the trusted network of capital providers: an online marketplace where a business applies once for commercial financing (initially merchant cash advances) and chooses which verified capital providers ("funders") may review its file and make offers.

CapNet is not a lender and does not hold or move funds. Funders make their own decisions and pay merchants directly.

This policy explains what information we collect, how we use it, who can see it, and the choices you have.

## 2. Who this policy covers

CapNet is a business-to-business service for US businesses and their owners who are at least 18 years old. It covers merchants (businesses applying for financing and their owners), funder users, and visitors to our website.

## 3. Information we collect

**From merchants (required to apply):**
- Owner information: full name, date of birth, Social Security number, and ownership percentage.
- Business information: legal business name, federal tax ID (EIN), business start date, merchant ID, and the number of outstanding advances.
- Financial documents: the last 4 months of business bank statements plus month-to-date activity, and a voided check.

**Optional bank connection.** Instead of uploading statements, you may connect your business bank account through a third-party bank-data aggregator ([FOUNDER: Plaid — planned, not yet live]). We never see or store your bank login credentials; the aggregator gives us a token. From the connection we derive normalized financial metrics (for example, deposits, balances and detected existing advances).

**Communications.** Messages between merchants and funders are sent through CapNet and are recorded.

**Activity and access records.** We log who viewed, downloaded or printed each document, when, and from what IP address and device, and we record authorizations, consents, offers, disclosures and funding events.

**Account and technical data.** Email, phone, login and authentication data (handled by our authentication provider), cookies and similar technologies (see our Cookie Policy), and device, browser and log information.

**From funders.** Business and contact details, verification information, lending criteria, offers, decline reasons, and funding confirmations. [FOUNDER: KYB provider Middesk — planned.]

## 4. Sources

We collect information directly from you; from your bank via an aggregator if you choose to connect; from funders (offers, decisions, funding confirmations); from service providers that verify businesses; and automatically when you use the site. A funder may send you a referral link to CapNet, but no merchant data is transferred to us by that funder — your data reaches us only when you register yourself.

## 5. How we use information

- To verify eligibility (including age, calculated from date of birth) and identity.
- To build your financial profile and match you with funders whose criteria fit.
- To show you which funders match and why, and to deliver your file only to funders you authorize.
- To display offers and required disclosures side by side.
- To operate messaging, notifications and the document access log.
- To record funding and invoice funders for the platform fee.
- To detect fraud, misuse, data harvesting and security incidents.
- To comply with law, respond to legal process, and enforce our Terms.
- To improve the service, using analytics only where you have consented.

We do not make credit or funding decisions. Funders do.

## 6. Who sees your information

**Funders see nothing about you until you authorize them.** Before authorization, funders can see nothing that identifies you. You choose which matched funders get access and what scope: profile, financial summary, and specific documents. Funders receive normalized financial metrics, not raw transaction detail.

**Raw bank statement PDFs** are shared with a funder only if you separately opt in, because they contain account numbers and customer and vendor information.

**You can revoke** an authorization at any time going forward. Revocation stops further access through CapNet; it cannot recall information a funder already viewed or downloaded. [COUNSEL: confirm funder data-use and retention obligations after revocation.]

**Funded positions are visible later.** After you are funded, the existence and amount of that funded position (without the funder's name) is visible to other funders who review your later applications on CapNet.

**CapNet staff** access merchant data only when needed. Administrative access to a merchant file requires a stated reason, a second person's approval, and expires within four hours, and it is recorded.

**Service providers (sub-processors)** that process data for us:

| Provider | Purpose | Status |
|---|---|---|
| Clerk | Authentication and accounts | Active |
| Neon or Supabase | Database hosting | [FOUNDER: select] |
| Cloudflare R2 or AWS S3 | Document storage (private) | [FOUNDER: select] |
| Vercel | Application hosting (US region) | Active |
| Resend | Email delivery | Active |
| Sentry | Error monitoring | Active |
| Plaid | Bank connection | Planned |
| Middesk | Business verification of funders | Planned |

**Legal and safety.** We may disclose information to comply with law, a subpoena or court order, to protect rights and safety, or in connection with a merger, acquisition or sale of assets, subject to this policy.

## 7. We do not sell personal information

We do not intend to sell personal information or share it for cross-context behavioral advertising, and we do not use advertising cookies at launch. [COUNSEL: confirm that the platform fee paid by funders on funded deals, and delivery of authorized files to funders, is not a "sale" or "sharing" under applicable state law.]

## 8. Financial privacy (GLBA)

CapNet may be considered a "financial institution" under the Gramm-Leach-Bliley Act and related rules. [COUNSEL: determine GLBA applicability, whether a separate privacy notice is required, and Safeguards Rule obligations.]

## 9. Your privacy rights

Depending on your state, you may have rights to access, correct, delete, or obtain a copy of your personal information, and to opt out of certain processing. Some state laws exempt business-to-business data or GLBA-covered data; we intend to honor reasonable requests regardless where practical. [COUNSEL: identify applicable state privacy laws (e.g., CCPA/CPRA) and exemptions.]

To make a request, email [FOUNDER: contact email] or call [FOUNDER: phone]. We will verify your identity before acting. You may use an authorized agent where the law allows. We will not discriminate against you for exercising your rights. We honor Global Privacy Control signals as described in our Cookie Policy.

## 10. Deletion

You can ask us to delete your account. When we do, we erase or anonymize your personal identifiers. We keep transaction, offer, disclosure, consent, authorization and audit records where law, contract, or a legal hold requires, because those records are the evidence of what happened. Records under a legal hold are not deleted until the hold is released. Information a funder already received under your authorization is held by that funder under its own policies.

## 11. Retention

We keep information as long as needed for the purposes above and as required by law:
- Application data and documents: [COUNSEL: retention period].
- Offer, disclosure, consent and funding records: [COUNSEL: retention period].
- Audit and document access logs: [COUNSEL: retention period].
- Marketing preferences: until you unsubscribe or delete your account, then [COUNSEL: period].

## 12. Security

We use measures designed to protect your information and to make access visible: documents are stored in a private bucket and delivered through CapNet rather than by shareable links; each delivery is logged before it is served and watermarked to the viewer; access is permission-checked; audit records are append-only and hash-chained so tampering can be detected; and unusual access patterns are monitored and rate-limited.

These measures create evidence and help detect misuse. They do not make misuse impossible. No system is completely secure, and we cannot guarantee the security of information. If a breach affecting you occurs, we will notify you as required by law. [COUNSEL: breach notification obligations.]

## 13. Children

CapNet is not directed to children and is only for business owners 18 and older. We check age from the date of birth provided and do not knowingly collect information from anyone under 18. If you believe a minor has provided information, contact us and we will delete it.

## 14. Location

CapNet is for US businesses only, and data is processed in the United States.

## 15. Changes

We may update this policy. We will post the new version with a new "Last updated" date and, for material changes, notify you by email or in the app before they take effect.

## 16. Contact

[FOUNDER: legal entity name], [FOUNDER: mailing address], [FOUNDER: contact email], [FOUNDER: phone].
