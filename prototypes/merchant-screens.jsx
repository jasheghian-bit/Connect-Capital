import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  Clock,
  FileText,
  Home,
  Inbox,
  MessageSquare,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

/*
  CapNet — merchant screens, clickable prototype.

  ALL DATA BELOW IS MOCK. Every funder name is a TEST provider. No API, no
  persistence. Shapes mirror the M1 schema (applications, matches,
  authorizations, document_access_events) so these components lift into the
  Next.js app with the mock objects swapped for loaders.

  Founder decisions this screen set follows (Sep 2026):
  - The merchant never sees a grade, a tier, a funder's criteria, or any
    warning about fit. The match screen shows the matched funders' names and
    one message: these funders fit your business, authorize them all.
  - "All" means every funder matched for THIS merchant, never the network.
  - Authorizing all is encouraged; the choice stays with the merchant.
  - A funder may pass without a reason. The screens never promise one.
  - Raw bank statement PDFs are a separate opt-in, default OFF.

  Design notes:
  - Money and timestamps are tabular monospace. A merchant's native document is
    a bank statement; figures that line up read as a ledger, not a landing page.
  - Amber is reserved for "this needs you". Green appears only on verification.
  - Home leads with the action list.
  - Accessibility: every text color on white meets WCAG AA 4.5:1 (slate-500 is
    the lightest text used; slate-300/400 appear only on decorative icons and
    borders). Icons are aria-hidden; icon-only buttons carry labels; every
    control is a real <button> so keyboard and screen readers work, and the
    sheet traps nothing, closes on Escape, and returns focus.
*/

const APPLICATION = {
  requestedAmount: 120000,
  status: "in_underwriting",
  submittedAt: "Aug 17",
};

const ACTIONS = [
  {
    id: "a1",
    icon: Upload,
    title: "Harbor Point (test) needs your August statement",
    meta: "Requested 11:12am",
    cost: "2 min",
    cta: "Upload",
  },
  {
    id: "a2",
    icon: MessageSquare,
    title: "Ridgeline (test) asked about your second position",
    meta: "Message · 9:48am",
    cost: "1 min",
    cta: "Reply",
  },
];

const PROVIDERS = [
  { id: "p1", name: "Harbor Point Capital (test)", state: "Reviewing", tone: "neutral" },
  { id: "p2", name: "Ridgeline Funding Group (test)", state: "Offer ready", tone: "good" },
  // A pass with no reason is normal. Funders are not required to give one.
  { id: "p4", name: "Meridian Business Capital (test)", state: "Passed · no reason given", tone: "muted" },
  { id: "p3", name: "Cardinal Advance (test)", state: "Access ended by you", tone: "muted" },
];

/*
  The matched set for this merchant, and nothing else. No range, no products,
  no fit reasons, no warnings: those would disclose funder criteria and the
  internal grade the funders were selected by.
*/
const MATCHED = [
  { id: "m1", name: "Harbor Point Capital (test)", authorized: true },
  { id: "m2", name: "Ridgeline Funding Group (test)", authorized: true },
  { id: "m3", name: "Meridian Business Capital (test)", authorized: true },
  { id: "m4", name: "Lakeshore Merchant Funding (test)", authorized: false },
  { id: "m5", name: "Summit Revenue Partners (test)", authorized: false },
];

const ACCESS = [
  {
    id: "auth1",
    name: "Harbor Point Capital (test)",
    status: "active",
    events: [
      { at: "11:04am", text: "Opened bank summary" },
      { at: "11:06am", text: "Opened your ID" },
      { at: "11:12am", text: "Requested August statement" },
    ],
  },
  {
    id: "auth2",
    name: "Ridgeline Funding Group (test)",
    status: "active",
    events: [
      { at: "10:41am", text: "Authorized by you" },
      { at: "—", text: "Hasn't opened anything yet" },
    ],
  },
  {
    id: "auth3",
    name: "Cardinal Advance (test)",
    status: "revoked",
    events: [
      { at: "Aug 16", text: "Opened bank summary" },
      { at: "Aug 17", text: "Access ended by you" },
    ],
  },
];

// Placeholders until the founder fills lib/business-details.ts.
const BUSINESS = {
  name: "[Legal entity name]",
  address: "[Mailing address]",
  email: "[Support email]",
};

const money = (n) => "$" + n.toLocaleString("en-US");

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2";

function Figure({ children, className = "" }) {
  return (
    <span className={`font-mono tabular-nums tracking-tight ${className}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "", muted = false }) {
  return (
    <div
      className={`rounded-xl border ${
        muted ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Means a real KYB check ran. Test providers in this mock did not run one. */
function Verified() {
  return (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <BadgeCheck size={15} strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">Verified provider</span>
    </span>
  );
}

function Header({ onBack, title, subtitle }) {
  return (
    <div className="border-b border-slate-200 px-5 pb-4 pt-5">
      {onBack && (
        <button
          onClick={onBack}
          className={`mb-3 -ml-1 flex items-center gap-1 rounded text-sm text-slate-600 ${focusRing}`}
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
      )}
      <h1 className="text-xl leading-tight tracking-tight text-slate-900">
        {title}
      </h1>
      {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-5">
      <h2 className="text-xs uppercase tracking-widest text-slate-500">
        {children}
      </h2>
      {right && <span className="text-xs text-slate-500">{right}</span>}
    </div>
  );
}

function HomeScreen({ go }) {
  const pending = MATCHED.filter((m) => !m.authorized).length;
  return (
    <div className="pb-4">
      <div className="border-b border-slate-200 px-5 pb-5 pt-6">
        <p className="text-xs uppercase tracking-widest text-slate-500">
          Your request
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <Figure className="text-3xl text-slate-900">
            {money(APPLICATION.requestedAmount)}
          </Figure>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Submitted <Figure>{APPLICATION.submittedAt}</Figure> · 2 funders
          reviewing
        </p>
      </div>

      <section aria-label="Needs you" className="bg-amber-50 px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-amber-900">
            Needs you
          </span>
          <span className="rounded bg-amber-200 px-1.5 py-0.5">
            <Figure className="text-xs text-amber-900">{ACTIONS.length}</Figure>
          </span>
        </div>

        <div className="space-y-2">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                onClick={() => go("access")}
                className={`flex w-full items-start gap-3 rounded-xl border border-amber-200 bg-white p-3 text-left ${focusRing}`}
              >
                <Icon
                  size={18}
                  className="mt-0.5 shrink-0 text-amber-700"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug text-slate-900">
                    {a.title}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                    <Figure>{a.meta}</Figure>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <Clock size={12} aria-hidden="true" />
                    <Figure>
                      <span className="sr-only">About </span>
                      {a.cost}
                    </Figure>
                  </span>
                </span>
                <span className="shrink-0 rounded-lg bg-amber-800 px-3 py-1.5 text-xs text-white">
                  {a.cta}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="pt-5">
        <SectionLabel right="1 offer">Your funders</SectionLabel>
        <div className="px-5">
          <Card>
            {PROVIDERS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => go("access")}
                className={`flex w-full items-center justify-between px-4 py-3 text-left ${focusRing} ${
                  i > 0 ? "border-t border-slate-100" : ""
                }`}
              >
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm ${
                      p.tone === "muted" ? "text-slate-600" : "text-slate-900"
                    }`}
                  >
                    {p.name}
                  </span>
                  <span
                    className={`text-xs ${
                      p.tone === "good" ? "text-emerald-700" : "text-slate-600"
                    }`}
                  >
                    {p.state}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            ))}
          </Card>
        </div>
      </section>

      {pending > 0 && (
        <div className="px-5 pt-4">
          <button
            onClick={() => go("preview")}
            className={`w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 ${focusRing}`}
          >
            {pending} more matched funders haven't been authorized yet
          </button>
        </div>
      )}
    </div>
  );
}

/*
  The match screen. Names only, one message, one primary action. The merchant
  may still pick funders one at a time; nothing is pre-selected and "Not now"
  is as easy as yes.
*/
function PreviewScreen({ go, onAuthorize, onAuthorizeAll }) {
  const pending = MATCHED.filter((m) => !m.authorized);
  return (
    <div className="pb-4">
      <Header
        onBack={() => go("home")}
        title="These funders fit your business"
        subtitle="Authorize them all to get the most offers to compare. Nothing is shared until you say so."
      />

      <ul className="space-y-2 px-5 pt-4">
        {MATCHED.map((m) => (
          <li key={m.id}>
            <Card className="flex items-center justify-between gap-3 p-4">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[15px] text-slate-900">{m.name}</span>
                <Verified />
              </span>
              {m.authorized ? (
                <span className="shrink-0 text-xs text-emerald-700">Authorized</span>
              ) : (
                <button
                  onClick={() => onAuthorize([m])}
                  className={`shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 ${focusRing}`}
                  aria-label={`Authorize ${m.name}`}
                >
                  Authorize
                </button>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {pending.length > 0 && (
        <div className="px-5 pt-4">
          <button
            onClick={() => onAuthorizeAll(pending)}
            className={`w-full rounded-xl bg-slate-900 py-3 text-sm text-white ${focusRing}`}
          >
            Authorize all {pending.length} remaining
          </button>
        </div>
      )}

      <p className="px-6 pt-4 text-center text-xs leading-relaxed text-slate-600">
        This is not an offer. Each funder reviews your file and decides for
        itself. A funder may pass without giving a reason.
      </p>
    </div>
  );
}

function AuthorizeSheet({ providers, onClose }) {
  const [rawDocs, setRawDocs] = useState(false);
  const closeRef = useRef(null);
  const one = providers.length === 1;
  const who = one ? providers[0].name : `${providers.length} funders`;

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const shares = [
    "Your business name and contact",
    "Revenue, balances, deposit activity",
    "Your existing positions",
    "Your ID and voided check",
  ];
  /*
    Worded as what funders agree to, not what the platform can physically
    prevent. CapNet cannot stop a phone call; the participation agreement
    prohibits it and the access log makes a breach detectable.
  */
  const agreed = [
    "Contact you only inside CapNet",
    "Not pass your file to anyone else",
  ];

  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-slate-900/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="authorize-title"
        className="max-h-full overflow-y-auto rounded-t-2xl bg-white"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="pr-4">
            <h2 id="authorize-title" className="text-lg leading-tight tracking-tight text-slate-900">
              Give {who} access?
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              You can end access to any funder at any time.
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className={`-mr-1 rounded p-1 text-slate-600 ${focusRing}`}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {!one && (
          <ul className="px-5 pt-4 text-sm text-slate-700">
            {providers.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        )}

        <div className="px-5 pt-4">
          <h3 className="text-xs uppercase tracking-widest text-slate-500">
            {one ? "They will see" : "Each will see"}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {shares.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" strokeWidth={2} aria-hidden="true" />
                <span className="text-sm text-slate-700">{s}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p id="raw-docs-label" className="text-sm text-amber-900">
                Also share raw bank statement PDFs
              </p>
              <p id="raw-docs-help" className="mt-1 text-xs leading-relaxed text-amber-900">
                Contains your account number and full customer list. Off unless
                you turn it on.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={rawDocs}
              aria-labelledby="raw-docs-label"
              aria-describedby="raw-docs-help"
              onClick={() => setRawDocs(!rawDocs)}
              className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 ${focusRing} ${
                rawDocs ? "bg-amber-800" : "bg-slate-500"
              }`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white ${rawDocs ? "ml-5" : "ml-0"}`} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4">
          <h3 className="text-xs uppercase tracking-widest text-slate-500">
            {one ? "They have agreed to" : "Every funder has agreed to"}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {agreed.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-500" strokeWidth={2} aria-hidden="true" />
                <span className="text-sm text-slate-700">{c}</span>
              </li>
            ))}
            <li className="flex items-start gap-2">
              <X size={15} className="mt-0.5 shrink-0 text-rose-600" strokeWidth={2} aria-hidden="true" />
              <span className="text-sm text-slate-700">
                No funder can see what another funder offers you
              </span>
            </li>
          </ul>
        </div>

        <div className="px-5 pb-6 pt-5">
          <button
            onClick={onClose}
            className={`w-full rounded-xl bg-slate-900 py-3 text-sm text-white ${focusRing}`}
          >
            {one ? `Authorize ${providers[0].name.split(" ")[0]}` : `Authorize all ${providers.length}`}
          </button>
          <button
            onClick={onClose}
            className={`mt-2 w-full rounded-xl border border-slate-300 py-2.5 text-sm text-slate-700 ${focusRing}`}
          >
            Not now
          </button>
          <p className="pt-2 text-center text-xs text-slate-600">
            Every document they open is recorded and shown to you.
          </p>
        </div>
      </div>
    </div>
  );
}

function AccessScreen({ go }) {
  const [items, setItems] = useState(ACCESS);
  const active = items.filter((i) => i.status === "active").length;

  const revoke = (id) =>
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "revoked", events: [...i.events, { at: "now", text: "Access ended by you" }] }
          : i
      )
    );

  return (
    <div className="pb-4">
      <Header
        onBack={() => go("home")}
        title="Who has your file"
        subtitle={`${active} authorized · ${items.length - active} ended`}
      />

      <ul className="space-y-3 px-5 pt-4">
        {items.map((a) => {
          const off = a.status === "revoked";
          return (
            <li key={a.id}>
              <Card className="p-4" muted={off}>
                <div className="flex items-center justify-between">
                  <h2 className={`text-[15px] ${off ? "text-slate-600" : "text-slate-900"}`}>
                    {a.name}
                  </h2>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      off ? "bg-slate-200 text-slate-700" : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {off ? "Ended" : "Active"}
                  </span>
                </div>

                <ol className="mt-3 border-l-2 border-slate-200 pl-3">
                  {a.events.map((e, i) => (
                    <li key={i} className="flex gap-3 py-0.5">
                      <Figure className="w-16 shrink-0 text-xs text-slate-600">{e.at}</Figure>
                      <span className="text-xs text-slate-700">{e.text}</span>
                    </li>
                  ))}
                </ol>

                {!off && (
                  <button
                    onClick={() => revoke(a.id)}
                    className={`mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-700 ${focusRing}`}
                  >
                    End access for {a.name.split(" ")[0]}
                  </button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="mx-5 mt-4 rounded-xl bg-slate-100 p-4">
        <p className="text-sm text-slate-900">Got a call you didn't expect?</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Funders you authorized reach you here. You don't need to take
          anyone's call to get funded through CapNet.
        </p>
        <button className={`mt-3 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm text-slate-700 ${focusRing}`}>
          Report an off-platform contact
        </button>
      </div>
    </div>
  );
}

/*
  Files and data. Deletion is reachable in two taps and explains up front what
  is erased and what the law makes CapNet keep, so the request is informed
  rather than a surprise. Retention periods are counsel's to set.
*/
function FilesScreen() {
  const [confirming, setConfirming] = useState(false);
  const [requested, setRequested] = useState(false);
  return (
    <div className="pb-4">
      <Header title="Files and your data" />
      <div className="px-5 pt-4">
        <Card className="p-4">
          <FileText size={22} className="mb-2 text-slate-400" aria-hidden="true" />
          <p className="text-sm text-slate-700">
            Upload once. Every funder you authorize reads from the same file.
          </p>
        </Card>

        <Card className="mt-4 p-4">
          <h2 className="text-sm text-slate-900">Delete my data</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            We erase your personal details and documents. Records of funded
            deals, offers you were shown, and what you agreed to are kept for the
            period the law requires, then removed.
          </p>
          {requested ? (
            <p role="status" className="mt-3 text-xs text-slate-700">
              Request received. We'll confirm by email before anything is
              deleted.
            </p>
          ) : confirming ? (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setRequested(true)}
                className={`flex-1 rounded-lg bg-rose-700 py-2 text-sm text-white ${focusRing}`}
              >
                Request deletion
              </button>
              <button
                onClick={() => setConfirming(false)}
                className={`flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-700 ${focusRing}`}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 py-2 text-sm text-slate-700 ${focusRing}`}
            >
              <Trash2 size={15} aria-hidden="true" /> Start a deletion request
            </button>
          )}
        </Card>

        <LegalFooter />
      </div>
    </div>
  );
}

function LegalFooter() {
  const links = ["Privacy", "Terms", "Cookies", "Refunds"];
  return (
    <footer className="mt-6 text-center text-xs leading-relaxed text-slate-600">
      <nav aria-label="Legal" className="flex justify-center gap-3">
        {links.map((l) => (
          <a key={l} href="#" className={`rounded underline ${focusRing}`}>
            {l}
          </a>
        ))}
      </nav>
      <p className="mt-2">
        CapNet is operated by {BUSINESS.name}, {BUSINESS.address} ·{" "}
        {BUSINESS.email}
      </p>
      <p className="mt-1">
        CapNet is not a lender. Funders make every funding decision.
      </p>
    </footer>
  );
}

/*
  Cookie banner. Reject is one tap and looks exactly like Accept; nothing
  non-essential is on until the merchant chooses. Logic: lib/cookie-consent.ts.
*/
function CookieBanner({ onDone }) {
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const btn = `flex-1 rounded-lg border border-slate-900 py-2 text-sm text-slate-900 ${focusRing}`;
  return (
    <div
      role="region"
      aria-label="Cookie choices"
      className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4"
    >
      <p className="text-xs leading-relaxed text-slate-700">
        We use necessary cookies to keep you signed in. With your OK, we'd also
        use analytics cookies to improve CapNet. No advertising cookies.{" "}
        <a href="#" className={`rounded underline ${focusRing}`}>Cookie policy</a>
      </p>
      {manage && (
        <label className="mt-3 flex items-center justify-between text-sm text-slate-700">
          Analytics cookies
          <input
            type="checkbox"
            checked={analytics}
            onChange={(e) => setAnalytics(e.target.checked)}
            className="h-4 w-4"
          />
        </label>
      )}
      <div className="mt-3 flex gap-2">
        {manage ? (
          <button onClick={onDone} className={btn}>Save choices</button>
        ) : (
          <>
            <button onClick={onDone} className={btn}>Reject non-essential</button>
            <button onClick={onDone} className={btn}>Accept all</button>
          </>
        )}
      </div>
      {!manage && (
        <button
          onClick={() => setManage(true)}
          className={`mt-2 w-full rounded py-1 text-xs text-slate-600 underline ${focusRing}`}
        >
          Choose for myself
        </button>
      )}
    </div>
  );
}

function TabBar({ screen, go }) {
  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "preview", label: "Funders", icon: Inbox },
    { id: "access", label: "Access", icon: ShieldCheck },
    { id: "docs", label: "Files", icon: FileText },
  ];
  return (
    <nav aria-label="Main" className="flex border-t border-slate-200 bg-white">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = screen === t.id;
        return (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            aria-current={on ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 ${focusRing} ${
              on ? "text-slate-900" : "text-slate-600"
            }`}
          >
            <Icon size={19} strokeWidth={on ? 2 : 1.5} aria-hidden="true" />
            <span className="text-xs">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function CapNetMerchant() {
  const [screen, setScreen] = useState("home");
  const [authorizing, setAuthorizing] = useState(null);
  const [cookiesChosen, setCookiesChosen] = useState(false);
  const closeSheet = useCallback(() => setAuthorizing(null), []);

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <p className="mx-auto mb-4 max-w-sm text-center text-xs text-slate-600">
        Prototype · mock data · every funder is a test provider · not connected
        to anything
      </p>

      <div className="relative mx-auto flex h-[720px] max-w-sm flex-col overflow-hidden rounded-3xl border border-slate-300 bg-white">
        <main className="flex-1 overflow-y-auto">
          {screen === "home" && <HomeScreen go={setScreen} />}
          {screen === "preview" && (
            <PreviewScreen
              go={setScreen}
              onAuthorize={setAuthorizing}
              onAuthorizeAll={setAuthorizing}
            />
          )}
          {screen === "access" && <AccessScreen go={setScreen} />}
          {screen === "docs" && <FilesScreen />}
        </main>

        <TabBar screen={screen} go={setScreen} />

        {authorizing && (
          <AuthorizeSheet providers={authorizing} onClose={closeSheet} />
        )}
        {!cookiesChosen && !authorizing && (
          <CookieBanner onDone={() => setCookiesChosen(true)} />
        )}
      </div>
    </div>
  );
}
