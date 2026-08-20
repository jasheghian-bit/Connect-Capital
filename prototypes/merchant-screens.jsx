import { useState } from "react";
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
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";

/*
  Connect Capital — merchant screens, clickable prototype.

  ALL DATA BELOW IS MOCK. No API, no persistence. Shapes mirror the M1 schema
  (applications, matches, authorizations, document_access_events) so these
  components lift into the Next.js app with the mock objects swapped for loaders.

  Design notes:
  - Money and timestamps are tabular monospace. A merchant's native document is
    a bank statement; figures that line up read as a ledger, not a landing page.
  - Amber is reserved for "this needs you" and appears nowhere else. Green
    appears only on verification. Everything else is grayscale.
  - Home leads with the action list. It is the only section that changes what
    the merchant does next.
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
    title: "Harbor Point needs your August statement",
    meta: "Requested 11:12am",
    cost: "2 min",
    cta: "Upload",
  },
  {
    id: "a2",
    icon: MessageSquare,
    title: "Ridgeline asked about your second position",
    meta: "Message · 9:48am",
    cost: "1 min",
    cta: "Reply",
  },
];

const PROVIDERS = [
  { id: "p1", name: "Harbor Point Capital", state: "Reviewing", tone: "neutral" },
  { id: "p2", name: "Ridgeline Funding Group", state: "Offer ready", tone: "good" },
  { id: "p3", name: "Cardinal Advance", state: "Revoked by you", tone: "muted" },
];

const MATCHES = [
  {
    id: "m1",
    name: "Harbor Point Capital",
    range: "$25k – $500k",
    products: "MCA, revenue-based",
    reasons: [
      { ok: true, text: "$120,000 is inside their range" },
      { ok: true, text: "Auto repair is accepted" },
      { ok: true, text: "4 yrs beats their 12-month minimum" },
    ],
  },
  {
    id: "m2",
    name: "Ridgeline Funding Group",
    range: "$50k – $2M",
    products: "MCA",
    reasons: [
      { ok: true, text: "Revenue well above their minimum" },
      { ok: false, text: "Prefers 1st position — you have 1 open" },
    ],
  },
  {
    id: "m3",
    name: "Meridian Business Capital",
    range: "$10k – $250k",
    products: "MCA, equipment",
    reasons: [
      { ok: true, text: "New Jersey is accepted" },
      { ok: false, text: "Wants 6 months of statements — you have 4" },
    ],
  },
];

const ACCESS = [
  {
    id: "auth1",
    name: "Harbor Point Capital",
    status: "active",
    events: [
      { at: "11:04am", text: "Opened bank summary" },
      { at: "11:06am", text: "Opened your ID" },
      { at: "11:12am", text: "Requested August statement" },
    ],
  },
  {
    id: "auth2",
    name: "Ridgeline Funding Group",
    status: "active",
    events: [
      { at: "10:41am", text: "Authorized by you" },
      { at: "—", text: "Hasn't opened anything yet" },
    ],
  },
  {
    id: "auth3",
    name: "Cardinal Advance",
    status: "revoked",
    events: [
      { at: "Aug 16", text: "Opened bank summary" },
      { at: "Aug 17", text: "Access ended by you" },
    ],
  },
];

const money = (n) => "$" + n.toLocaleString("en-US");

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

function Verified() {
  return (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <BadgeCheck size={15} strokeWidth={2} />
    </span>
  );
}

function Header({ onBack, title, subtitle }) {
  return (
    <div className="border-b border-slate-200 px-5 pb-4 pt-5">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-3 -ml-1 flex items-center gap-1 text-sm text-slate-500"
        >
          <ArrowLeft size={16} /> Back
        </button>
      )}
      <h1 className="text-xl leading-tight tracking-tight text-slate-900">
        {title}
      </h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-5">
      <span className="text-xs uppercase tracking-widest text-slate-400">
        {children}
      </span>
      {right && <span className="text-xs text-slate-400">{right}</span>}
    </div>
  );
}

function HomeScreen({ go }) {
  return (
    <div className="pb-4">
      <div className="border-b border-slate-200 px-5 pb-5 pt-6">
        <p className="text-xs uppercase tracking-widest text-slate-400">
          Your request
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <Figure className="text-3xl text-slate-900">
            {money(APPLICATION.requestedAmount)}
          </Figure>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Submitted <Figure>{APPLICATION.submittedAt}</Figure> · 2 funders
          reviewing
        </p>
      </div>

      <div className="bg-amber-50 px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-amber-800">
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
                className="flex w-full items-start gap-3 rounded-xl border border-amber-200 bg-white p-3 text-left"
              >
                <Icon
                  size={18}
                  className="mt-0.5 shrink-0 text-amber-700"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug text-slate-900">
                    {a.title}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <Figure>{a.meta}</Figure>
                    <span className="text-slate-300">·</span>
                    <Clock size={12} />
                    <Figure>{a.cost}</Figure>
                  </span>
                </span>
                <span className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-xs text-white">
                  {a.cta}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-5">
        <SectionLabel right="1 offer">Your funders</SectionLabel>
        <div className="px-5">
          <Card>
            {PROVIDERS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => go("access")}
                className={`flex w-full items-center justify-between px-4 py-3 text-left ${
                  i > 0 ? "border-t border-slate-100" : ""
                }`}
              >
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm ${
                      p.tone === "muted" ? "text-slate-400" : "text-slate-900"
                    }`}
                  >
                    {p.name}
                  </span>
                  <span
                    className={`text-xs ${
                      p.tone === "good"
                        ? "text-emerald-700"
                        : p.tone === "muted"
                        ? "text-slate-400"
                        : "text-slate-500"
                    }`}
                  >
                    {p.state}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </Card>
        </div>
      </div>

      <div className="px-5 pt-4">
        <button
          onClick={() => go("preview")}
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
        >
          See 4 more providers that fit
        </button>
      </div>
    </div>
  );
}

function PreviewScreen({ go, onAuthorize }) {
  return (
    <div className="pb-4">
      <Header
        onBack={() => go("home")}
        title="6 providers likely fit your business"
        subtitle="Based on what you told us. Nothing is shared until you say so."
      />

      <div className="space-y-3 px-5 pt-4">
        {MATCHES.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] text-slate-900">{m.name}</span>
              <Verified />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              <Figure>{m.range}</Figure> · {m.products}
            </p>

            <div className="mt-3 space-y-1.5">
              {m.reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2">
                  {r.ok ? (
                    <ShieldCheck
                      size={14}
                      className="mt-0.5 shrink-0 text-emerald-600"
                      strokeWidth={2}
                    />
                  ) : (
                    <TriangleAlert
                      size={14}
                      className="mt-0.5 shrink-0 text-amber-600"
                      strokeWidth={2}
                    />
                  )}
                  <span className="text-xs leading-relaxed text-slate-600">
                    {r.text}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => onAuthorize(m)}
              className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-700"
            >
              Give access
            </button>
          </Card>
        ))}
      </div>

      <p className="px-6 pt-4 text-center text-[11px] leading-relaxed text-slate-400">
        This is a preview based on your own answers, not an offer. Terms come
        from the funder after they review your file.
      </p>
    </div>
  );
}

function AuthorizeSheet({ provider, onClose }) {
  const [rawDocs, setRawDocs] = useState(false);

  const shares = [
    "Your business name and contact",
    "Revenue, balances, deposit activity",
    "Your existing positions",
    "Your ID and voided check",
  ];
  const cannot = [
    "Contact you outside this platform",
    "Pass your file to anyone else",
    "See what other funders offer you",
  ];

  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-slate-900/40">
      <div className="max-h-full overflow-y-auto rounded-t-2xl bg-white">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="pr-4">
            <h2 className="text-lg leading-tight tracking-tight text-slate-900">
              Give {provider.name} access?
            </h2>
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              <Verified /> Verified provider · revoke any time
            </p>
          </div>
          <button onClick={onClose} className="-mr-1 p-1 text-slate-400">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 pt-4">
          <p className="text-xs uppercase tracking-widest text-slate-400">
            They will see
          </p>
          <div className="mt-2 space-y-1.5">
            {shares.map((s) => (
              <div key={s} className="flex items-start gap-2">
                <ShieldCheck
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-600"
                  strokeWidth={2}
                />
                <span className="text-sm text-slate-700">{s}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-amber-900">Raw bank statement PDFs</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Contains your account number and full customer list. Most
                funders don't need it.
              </p>
            </div>
            <button
              onClick={() => setRawDocs(!rawDocs)}
              aria-label="Toggle raw statement access"
              className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 ${
                rawDocs ? "bg-amber-700" : "bg-slate-300"
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white ${
                  rawDocs ? "ml-5" : "ml-0"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4">
          <p className="text-xs uppercase tracking-widest text-slate-400">
            They cannot
          </p>
          <div className="mt-2 space-y-1.5">
            {cannot.map((c) => (
              <div key={c} className="flex items-start gap-2">
                <X size={15} className="mt-0.5 shrink-0 text-rose-500" strokeWidth={2} />
                <span className="text-sm text-slate-500">{c}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 pb-6 pt-5">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-slate-900 py-3 text-sm text-white"
          >
            Authorize {provider.name.split(" ")[0]}
          </button>
          <button
            onClick={onClose}
            className="mt-2 w-full py-2.5 text-sm text-slate-500"
          >
            Not now
          </button>
          <p className="pt-2 text-center text-[11px] text-slate-400">
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
          ? {
              ...i,
              status: "revoked",
              events: [...i.events, { at: "now", text: "Access ended by you" }],
            }
          : i
      )
    );

  return (
    <div className="pb-4">
      <Header
        onBack={() => go("home")}
        title="Who has your file"
        subtitle={`${active} authorized · ${items.length - active} revoked`}
      />

      <div className="space-y-3 px-5 pt-4">
        {items.map((a) => {
          const off = a.status === "revoked";
          return (
            <Card key={a.id} className="p-4" muted={off}>
              <div className="flex items-center justify-between">
                <span
                  className={`text-[15px] ${
                    off ? "text-slate-400" : "text-slate-900"
                  }`}
                >
                  {a.name}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    off
                      ? "bg-slate-200 text-slate-500"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {off ? "Revoked" : "Active"}
                </span>
              </div>

              <div className="mt-3 border-l-2 border-slate-200 pl-3">
                {a.events.map((e, i) => (
                  <div key={i} className="flex gap-3 py-0.5">
                    <Figure className="w-16 shrink-0 text-xs text-slate-400">
                      {e.at}
                    </Figure>
                    <span
                      className={`text-xs ${
                        off ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      {e.text}
                    </span>
                  </div>
                ))}
              </div>

              {!off && (
                <button
                  onClick={() => revoke(a.id)}
                  className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-700"
                >
                  Revoke access
                </button>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mx-5 mt-4 rounded-xl bg-slate-100 p-4">
        <p className="text-sm text-slate-900">Got a call you didn't expect?</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Your funders reach you here. Anyone else can be ignored.
        </p>
        <button className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm text-slate-700">
          Report an off-platform contact
        </button>
      </div>
    </div>
  );
}

function TabBar({ screen, go }) {
  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "preview", label: "Providers", icon: Inbox },
    { id: "access", label: "Access", icon: ShieldCheck },
    { id: "docs", label: "Files", icon: FileText },
  ];
  return (
    <div className="flex border-t border-slate-200 bg-white">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = screen === t.id;
        return (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 ${
              on ? "text-slate-900" : "text-slate-400"
            }`}
          >
            <Icon size={19} strokeWidth={on ? 2 : 1.5} />
            <span className="text-[10px]">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function ConnectCapitalMerchant() {
  const [screen, setScreen] = useState("home");
  const [authorizing, setAuthorizing] = useState(null);

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <p className="mx-auto mb-4 max-w-sm text-center text-xs text-slate-400">
        Prototype · mock data · not connected to anything
      </p>

      <div className="relative mx-auto flex h-[720px] max-w-sm flex-col overflow-hidden rounded-3xl border border-slate-300 bg-white">
        <div className="flex-1 overflow-y-auto">
          {screen === "home" && <HomeScreen go={setScreen} />}
          {screen === "preview" && (
            <PreviewScreen go={setScreen} onAuthorize={setAuthorizing} />
          )}
          {screen === "access" && <AccessScreen go={setScreen} />}
          {screen === "docs" && (
            <div className="px-6 py-16 text-center">
              <FileText size={28} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">
                Your documents live here. Upload once — every funder you
                authorize reads from the same file.
              </p>
            </div>
          )}
        </div>

        <TabBar screen={screen} go={setScreen} />

        {authorizing && (
          <AuthorizeSheet
            provider={authorizing}
            onClose={() => setAuthorizing(null)}
          />
        )}
      </div>
    </div>
  );
}
