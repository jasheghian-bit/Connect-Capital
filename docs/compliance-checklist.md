# CapNet — 20-item launch compliance checklist

Status of each item in this repo. **Built** means code or a document exists and
is tested where testable. **Not live** means it is not yet wired into a running
app, because the app itself (pages, routes, email sending) is not built yet.
Nothing here is legal advice; every legal document is a draft for counsel.

| # | Item | Where | Status |
|---|---|---|---|
| 1 | Privacy policy | `docs/legal/privacy-policy.md` | Draft — counsel review required |
| 2 | Terms of service | `docs/legal/terms-of-service.md` | Draft — counsel review required |
| 3 | Refund policy | `docs/legal/refund-policy.md` | Draft. Merchants pay CapNet nothing; covers funder fee errors and reversals |
| 4 | Cookie policy | `docs/legal/cookie-policy.md` | Draft — counsel review required |
| 5 | Cookie consent banner | `lib/cookie-consent.ts`, banner in `prototypes/merchant-screens.jsx` | Built. Reject is one tap and equal to Accept; non-essential off by default; Global Privacy Control honored. Not live |
| 6 | Check form consents | `lib/consents-required.ts`, `submitApplication` | Built. No pre-checked boxes; submit now records terms **and** privacy consent in one transaction |
| 7 | No unnecessary data | `lib/data-inventory.ts` | Built. Every field has a purpose, who sees it, and a deletion rule; SSN/DOB stay vault tokens |
| 8 | Audit third-party SDKs | `docs/sdk-audit.md`, `lib/error-scrub.ts` | Done. No tracking or ad SDKs. Sign a data processing agreement (DPA) with each vendor marked DPA before launch |
| 9 | Remove dark patterns | `prototypes/merchant-screens.jsx` | Done. "Not now" is a full button; raw statement sharing defaults off; deletion is two taps; no pre-selection |
| 10 | Remove hidden fees | `lib/fee-transparency.ts`, `submitOffer` | Built. Offers with any fee not itemized are refused; merchant is told the offer includes CapNet's platform fee. Funder buy rate stays private, per founder decision |
| 11 | Remove fake reviews | Whole repo | Checked — no reviews, ratings or testimonials exist. Don't add any until they come from real, verifiable customers |
| 12 | Remove unsupported claims | Prototypes, docs | Done. "They cannot contact you outside this platform" became "They have agreed to contact you only inside CapNet" (the platform can't physically stop a call). Mock funders labelled "(test)" |
| 13 | Accessibility alt text | Prototypes | Done. No images exist; icons marked decorative; icon-only buttons and the verified badge have text labels |
| 14 | Fix color contrast | Prototypes | Done. All body text now meets WCAG AA 4.5:1 (light gray text darkened; 10px text raised to 12px) |
| 15 | Keyboard navigation | `prototypes/merchant-screens.jsx` | Done. Visible focus rings, real buttons, toggle is a proper switch, sheet takes focus and closes on Escape. Other prototypes got contrast fixes only |
| 16 | Add business details | `lib/business-details.ts`, legal footer | Built. **Founder must fill in** entity name, address, email, phone — the deploy check fails until then |
| 17 | Age consent for kids' data | `lib/age.ts` | Built as an 18+ owner check (CapNet serves business owners, not children). Must run at owner intake, which isn't built yet |
| 18 | Unsubscribe link in emails | `lib/email-preferences.ts`, migration 0010 | Built. Signed one-click unsubscribe, RFC 8058 headers, postal address footer. Marketing only — transactional emails continue. Not live (no email sending yet) |
| 19 | License fonts/images | `docs/licenses.md` | Done. System fonts only, no image files, all libraries permissively licensed |
| 20 | Data deletion request | `lib/data-deletion.ts`, migration 0010, Files screen | Built. Personal details erased; funded deals, offers, disclosures, consents and the audit log kept for the legal period; blocked by legal hold or an open application. Execution not live |

## Owner actions before launch

**Founder**
- Fill in `lib/business-details.ts`.
- Get counsel sign-off on all four documents in `docs/legal/` (83 placeholders to resolve; the full list is in `docs/legal/README.md`).

**Counsel decisions**
- How long to keep transaction and audit records after a deletion request.
- Whether the platform-fee notice satisfies each state's commercial-financing disclosure law.

**Vendors**
- Sign a DPA with every vendor marked DPA in `docs/sdk-audit.md`.

**Developer**
- Wire the cookie banner, `/unsubscribe` route, owner-intake age check and deletion execution into the real app.
