# CapNet — Third-party SDK and service audit

Every dependency and provisioned service, what data reaches it, and what is
owed before launch. **No tracking, analytics, or advertising SDK is present.**
None may be added without updating this file and the cookie policy, and
wiring it behind `lib/cookie-consent.ts` (default OFF, GPC honored).

Status key: **ok** (no personal data leaves us) · **DPA** (data processing
agreement needed before production) · **todo** (control not yet wired).

## npm dependencies (package.json)

| Package | Runs client-side | Data it receives | DPA | Status / risk |
|---|---|---|---|---|
| next | yes (framework) | none sent to Vercel by the package itself; telemetry is build-time only | n/a | Disable build telemetry (`next telemetry disable`) in CI |
| react, react-dom | yes | none | n/a | ok |
| lucide-react | yes | none (bundled SVG icons) | n/a | ok |
| zod | both | none (local validation) | n/a | ok |
| drizzle-orm, pg | server | DB queries to our own Postgres | via Neon/Supabase | ok |
| @clerk/nextjs | yes | names, emails, phones, IP, device info, session tokens | **DPA** | Clerk is a processor of account identity. Confirm data region (US) |
| dev: drizzle-kit, tsx, typescript, vitest, @types/* | no (dev only) | none | n/a | ok — never shipped |

## Services (README "Services to provision")

| Service | Client-side | Data it receives | DPA | Status / risk |
|---|---|---|---|---|
| Neon / Supabase | no | all platform data (encrypted at rest) | **DPA** | US region; restrict network access; backups follow deletion plan |
| Clerk | yes | account identity, MFA, IP/user agent | **DPA** | See above |
| Cloudflare R2 / AWS S3 | no | bank statements, voided checks (highest sensitivity) | **DPA** | Private bucket; reads only via `deliverDocument` |
| Vercel | hosts | request logs incl. IP, URLs | **DPA** | Do not put identifiers in URLs; set log retention short |
| Resend | no | recipient email, message bodies (offers, notices) | **DPA** | Never put SSN/EIN/account numbers in email bodies; one-click unsubscribe headers from `lib/email-preferences.ts` (todo: wire) |
| Sentry | yes (browser SDK) + server | error payloads — can contain anything | **DPA** | **Must** use `lib/error-scrub.ts` `scrubEvent()` in `beforeSend` and disable session replay / `sendDefaultPii` (todo: Sentry not installed yet) |
| Later: Plaid | yes (Link widget) | bank credentials (Plaid only), accounts, transactions | **DPA** + Plaid end-user privacy notice | `bank_connection` consent required; raw transactions never reach funders |
| Later: Middesk | no | provider (funder) business identity for KYB | **DPA** | Provider data, not merchant |

## Rules

1. No tracking pixels, session replay, ad tags, or analytics SDKs at launch.
2. Adding any SDK that runs client-side or receives personal data requires: a row
   here, a DPA, an update to the privacy and cookie policies, and — for
   non-essential cookies — gating through `lib/cookie-consent.ts`.
3. Fields in `lib/data-inventory.ts` marked `sensitive` never go to a vendor
   except the one that stores them (vault, object storage).
