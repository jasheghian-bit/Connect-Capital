# Prototypes

Clickable React prototypes. **Mock data only — not wired to the services.**

| File | What it shows |
|---|---|
| `transaction-walkthrough.jsx` | The full transaction, four perspectives, step by step. **Start here.** |
| `merchant-screens.jsx` | Merchant home, match preview, authorization sheet, access center |
| `merchant-financial-profile.jsx` | Bank connection, detected positions, "what funders see" toggle |
| `provider-workspace.jsx` | Funder queue and file view — authorized files only; empty until a merchant grants access |

These lift into the Next.js app: swap the mock objects for loaders from `lib/`.
The layouts and interaction patterns stay.

`transaction-walkthrough.jsx` is the demo to open in a funder meeting. Step 3,
then switch between the Harbor Point and Ridgeline views. Ridgeline (not
authorized) sees nothing at all — no blinded card, no numbers, no grade, not
even that the file exists (founder decision, Sep 2026). Grades are internal and
appear on no funder screen.
