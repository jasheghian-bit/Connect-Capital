import { useState } from "react";
import {
  BadgeCheck,
  Ban,
  Building2,
  ChevronLeft,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Inbox,
  Lock,
  Send,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

/*
  Connect Capital — provider workspace, clickable prototype.

  ALL DATA IS MOCK. Shapes mirror lib/provider-view.ts, which is the module
  that actually decides blinded vs. full in production.

  The point of this screen: a funder in the queue sees enough to decide whether
  they want the file, and cannot identify or contact the merchant until the
  merchant says yes. Toggle "authorized" on any file to watch identity appear.

  Desktop-oriented. Funders work at a desk; merchants work from a phone.
*/

const QUEUE = [
  {
    id: "app_1",
    grade: "B",
    score: 88,
    authorized: false,
    interested: false,
    waitingOn: "nobody",
    industry: "Auto repair",
    naics: "811111",
    location: "Monmouth County, NJ",
    tib: 48,
    amount: 120000,
    revenue: 95000,
    dailyBalance: 8400,
    negativeDays: 2,
    nsf: 0,
    deposits: 62,
    months: 4,
    confidence: "verified",
    positions: 1,
    positionBalance: 18000,
    positionPayment: 4200,
    ptr: 0.328,
    creditBand: "fair",
    priorDeclines: 2,
    identityHash: "a91f3c0e",
    legalName: "Northshore Auto Repair LLC",
    dba: "Northshore Auto",
    street: "418 Sycamore Ave, Neptune NJ 07753",
    phone: "(732) 555-0100",
    email: "dana@northshoreauto.com",
    owner: "Dana Whitfield",
  },
  {
    id: "app_2",
    grade: "A",
    score: 96,
    authorized: true,
    interested: true,
    waitingOn: "you",
    industry: "Freight trucking",
    naics: "484121",
    location: "Middlesex County, NJ",
    tib: 91,
    amount: 250000,
    revenue: 210000,
    dailyBalance: 41000,
    negativeDays: 0,
    nsf: 0,
    deposits: 88,
    months: 6,
    confidence: "verified",
    positions: 0,
    positionBalance: 0,
    positionPayment: 0,
    ptr: 0.268,
    creditBand: "good",
    priorDeclines: 0,
    identityHash: "3f7b21ce",
    legalName: "Kestrel Logistics Inc",
    dba: "Kestrel Freight",
    street: "22 Wheeler Rd, Edison NJ 08817",
    phone: "(908) 555-0142",
    email: "ops@kestrelfreight.com",
    owner: "Marcus Ilagan",
  },
  {
    id: "app_3",
    grade: "D",
    score: 41,
    authorized: false,
    interested: false,
    waitingOn: "nobody",
    industry: "Full-service restaurant",
    naics: "722511",
    location: "Bergen County, NJ",
    tib: 19,
    amount: 45000,
    revenue: 38000,
    dailyBalance: 1100,
    negativeDays: 6,
    nsf: 3,
    deposits: 24,
    months: 4,
    confidence: "parsed",
    positions: 2,
    positionBalance: 31000,
    positionPayment: 5900,
    ptr: 0.421,
    creditBand: "poor",
    priorDeclines: 4,
    identityHash: "c02e9a41",
    legalName: "Harborview Kitchen LLC",
    dba: "Harborview",
    street: "9 Dock St, Edgewater NJ 07020",
    phone: "(201) 555-0188",
    email: "info@harborviewkitchen.com",
    owner: "Priya Raghunathan",
  },
];

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n) => Math.round(n * 100) + "%";

function Mono({ children, className = "" }) {
  return (
    <span className={`font-mono tabular-nums tracking-tight ${className}`}>
      {children}
    </span>
  );
}

function GradePill({ grade }) {
  const tone =
    grade === "A"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : grade === "B"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : grade === "C"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded border text-xs ${tone}`}
    >
      {grade}
    </span>
  );
}

function Stat({ label, value, warn = false }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-slate-400">
        {label}
      </div>
      <Mono
        className={`text-sm ${warn ? "text-amber-700" : "text-slate-900"}`}
      >
        {value}
      </Mono>
    </div>
  );
}

function QueueRow({ item, onOpen }) {
  return (
    <button
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-4 border-b border-slate-100 px-5 py-3 text-left hover:bg-slate-50"
    >
      <GradePill grade={item.grade} />

      <span className="w-52 shrink-0">
        <span className="block text-sm text-slate-900">{item.industry}</span>
        <span className="block text-xs text-slate-500">{item.location}</span>
      </span>

      <span className="w-24 shrink-0">
        <Mono className="text-sm text-slate-900">{money(item.amount)}</Mono>
      </span>

      <span className="w-28 shrink-0">
        <Mono className="text-sm text-slate-600">{money(item.revenue)}</Mono>
        <span className="block text-[11px] text-slate-400">monthly rev</span>
      </span>

      <span className="w-20 shrink-0">
        <Mono
          className={`text-sm ${
            item.positions > 1 ? "text-amber-700" : "text-slate-600"
          }`}
        >
          {item.positions}
        </Mono>
        <span className="block text-[11px] text-slate-400">positions</span>
      </span>

      <span className="w-20 shrink-0">
        <Mono
          className={`text-sm ${
            item.ptr > 0.35 ? "text-rose-600" : "text-slate-600"
          }`}
        >
          {pct(item.ptr)}
        </Mono>
        <span className="block text-[11px] text-slate-400">pmt/rev</span>
      </span>

      <span className="ml-auto shrink-0">
        {item.authorized ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
            <Eye size={12} /> Authorized
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
            <EyeOff size={12} /> Blinded
          </span>
        )}
      </span>
    </button>
  );
}

function BlindedBanner({ interested, onInterest }) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <Lock size={18} className="mt-0.5 shrink-0 text-slate-400" />
      <div className="flex-1">
        <p className="text-sm text-slate-900">Awaiting merchant authorization</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Business name, address, owner, and contact stay hidden until the
          merchant grants you access. Everything below is enough to decide
          whether you want the file.
        </p>
      </div>
      <button
        onClick={onInterest}
        disabled={interested}
        className={`shrink-0 rounded-lg px-3 py-2 text-xs ${
          interested
            ? "bg-slate-100 text-slate-400"
            : "border border-slate-300 text-slate-700 hover:bg-white"
        }`}
      >
        {interested ? "Interest sent" : "Express interest"}
      </button>
    </div>
  );
}

function IdentityPanel({ item }) {
  return (
    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <BadgeCheck size={16} className="text-emerald-700" />
        <span className="text-sm text-emerald-900">
          Authorized by the merchant
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        <Stat label="Legal name" value={item.legalName} />
        <Stat label="DBA" value={item.dba} />
        <Stat label="Owner" value={item.owner} />
        <Stat label="Phone" value={item.phone} />
        <Stat label="Address" value={item.street} />
        <Stat label="Email" value={item.email} />
      </div>
      <p className="mt-3 border-t border-emerald-200 pt-3 text-[11px] leading-relaxed text-emerald-800">
        All communication with this merchant happens in the platform. Every
        document you open is recorded and shown to them.
      </p>
    </div>
  );
}

function FileView({ item, onBack, onToggle }) {
  const [requested, setRequested] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ChevronLeft size={16} /> Queue
        </button>
        <button
          onClick={onToggle}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
        >
          Demo: {item.authorized ? "revoke" : "grant"} authorization
        </button>
      </div>

      <div className="px-5 py-5">
        {item.authorized ? (
          <IdentityPanel item={item} />
        ) : (
          <BlindedBanner interested={item.interested} onInterest={() => {}} />
        )}

        <div className="mb-5 flex items-center gap-3">
          <GradePill grade={item.grade} />
          <div>
            <div className="text-lg tracking-tight text-slate-900">
              {item.industry}
            </div>
            <div className="text-xs text-slate-500">
              NAICS <Mono>{item.naics}</Mono> · {item.location} ·{" "}
              <Mono>{Math.floor(item.tib / 12)}</Mono> yrs in business
            </div>
          </div>
          <div className="ml-auto text-right">
            <Mono className="text-2xl text-slate-900">{money(item.amount)}</Mono>
            <div className="text-xs text-slate-500">requested</div>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-4 gap-4 rounded-xl border border-slate-200 p-4">
          <Stat label="Monthly revenue" value={money(item.revenue)} />
          <Stat label="Avg daily balance" value={money(item.dailyBalance)} />
          <Stat
            label="Negative days"
            value={item.negativeDays}
            warn={item.negativeDays > 3}
          />
          <Stat label="NSF" value={item.nsf} warn={item.nsf > 0} />
          <Stat label="Deposits" value={item.deposits} />
          <Stat label="Months covered" value={item.months} />
          <Stat label="Credit band" value={item.creditBand} />
          <Stat
            label="Data"
            value={item.confidence === "verified" ? "bank-verified" : "parsed"}
          />
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-900">
              <TrendingUp size={15} className="text-slate-400" /> Existing
              positions
            </div>
            {item.positions === 0 ? (
              <p className="text-sm text-slate-500">First position available.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Count" value={item.positions} warn={item.positions > 1} />
                <Stat label="Balance" value={money(item.positionBalance)} />
                <Stat label="Payment" value={money(item.positionPayment) + "/mo"} />
              </div>
            )}
          </div>

          <div
            className={`rounded-xl border p-4 ${
              item.ptr > 0.35
                ? "border-rose-200 bg-rose-50"
                : "border-slate-200"
            }`}
          >
            <div className="mb-1 flex items-center gap-2 text-sm text-slate-900">
              {item.ptr > 0.35 && (
                <TriangleAlert size={15} className="text-rose-600" />
              )}
              Payment burden if funded
            </div>
            <Mono
              className={`text-2xl ${
                item.ptr > 0.35 ? "text-rose-700" : "text-slate-900"
              }`}
            >
              {pct(item.ptr)}
            </Mono>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              of monthly revenue, including existing positions. Indicative at
              1.35 over 6 months — not a quote.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-slate-900">
              <FileText size={15} className="text-slate-400" /> Documents
            </span>
            {item.authorized && (
              <button
                onClick={() => setRequested(true)}
                disabled={requested}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${
                  requested
                    ? "bg-slate-100 text-slate-400"
                    : "border border-slate-300 text-slate-700"
                }`}
              >
                <Send size={12} /> {requested ? "Requested" : "Request document"}
              </button>
            )}
          </div>

          {item.authorized ? (
            <div className="divide-y divide-slate-100">
              {[
                { t: "Government ID", m: "v1 · uploaded Aug 17" },
                { t: "Voided check", m: "v1 · uploaded Aug 17" },
              ].map((d) => (
                <div key={d.t} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-700">{d.t}</span>
                  <span className="text-xs text-slate-400">{d.m}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 px-4 py-3">
                <Ban size={14} className="text-slate-300" />
                <span className="text-xs text-slate-400">
                  2 documents outside your authorization scope
                </span>
              </div>
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-slate-400">
              Documents unlock when the merchant authorizes you.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProviderWorkspace() {
  const [items, setItems] = useState(QUEUE);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState("new_matches");

  const open = items.find((i) => i.id === openId);

  const toggle = (id) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, authorized: !i.authorized } : i))
    );

  const tabs = [
    { id: "new_matches", label: "New matches", n: items.filter((i) => !i.authorized).length },
    { id: "authorized", label: "Authorized", n: items.filter((i) => i.authorized).length },
    { id: "in_underwriting", label: "Needs you", n: items.filter((i) => i.authorized && i.waitingOn === "you").length },
  ];

  const shown = items.filter((i) =>
    tab === "new_matches"
      ? !i.authorized
      : tab === "authorized"
      ? i.authorized
      : i.authorized && i.waitingOn === "you"
  );

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <p className="mx-auto mb-4 max-w-5xl text-xs text-slate-400">
        Prototype · mock data · toggle authorization inside a file to see
        identity appear
      </p>

      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-300 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <Building2 size={18} className="text-slate-400" />
          <span className="text-sm text-slate-900">Harbor Point Capital</span>
          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            <BadgeCheck size={12} /> Verified
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={13} /> Accepting files
          </span>
        </div>

        {open ? (
          <FileView
            item={open}
            onBack={() => setOpenId(null)}
            onToggle={() => toggle(open.id)}
          />
        ) : (
          <>
            <div className="flex gap-1 border-b border-slate-200 px-5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`border-b-2 px-3 py-2.5 text-sm ${
                    tab === t.id
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500"
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 text-xs text-slate-400">{t.n}</span>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <Inbox size={26} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-slate-500">Nothing here right now.</p>
              </div>
            ) : (
              shown.map((i) => (
                <QueueRow key={i.id} item={i} onOpen={(x) => setOpenId(x.id)} />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
