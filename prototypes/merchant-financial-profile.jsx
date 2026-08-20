import { useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronRight,
  Eye,
  Landmark,
  Lock,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

/*
  Connect Capital — merchant financial profile.

  ALL DATA IS MOCK. The metrics, positions, and signals below are shaped exactly
  like what lib/bank-analysis.ts produces from a real transaction stream.

  Two things this screen has to do:

  1. Show the merchant what their bank connection produced — including the
     positions the platform detected, which they confirm or deny. A detection
     is a hypothesis; telling a funder someone is stacked when they aren't
     costs that merchant an approval, so they get the last word.

  2. Make the privacy boundary tangible. The "what funders see" toggle is the
     product's central promise rendered as a control the merchant can operate.
*/

const METRICS = {
  institution: "Provident Bank",
  account: "Business Checking ••4471",
  lastSynced: "12 min ago",
  monthsCovered: 6,
  avgMonthlyRevenue: 95400,
  avgDailyBalance: 8420,
  negativeDays: 2,
  nsfCount: 0,
  depositCount: 62,
  confidence: "verified",
};

const DETECTED = [
  {
    id: "p1",
    counterparty: "ridgeline funding",
    display: "Ridgeline Funding",
    paymentAmount: 420,
    frequency: "daily",
    occurrences: 34,
    firstSeen: "May 5",
    advanceAmount: 60000,
    impliedFactor: 1.32,
    paydownProgress: 0.61,
    confidence: 0.86,
  },
  {
    id: "p2",
    counterparty: "summit equip lease",
    display: "Summit Equipment Lease",
    paymentAmount: 310,
    frequency: "weekly",
    occurrences: 11,
    firstSeen: "Jun 2",
    advanceAmount: null,
    impliedFactor: null,
    paydownProgress: null,
    confidence: 0.64,
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

function Metric({ label, value, warn = false, hidden = false }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-slate-400">
        {label}
      </div>
      {hidden ? (
        <span className="inline-flex items-center gap-1 text-sm text-slate-300">
          <Lock size={12} /> hidden
        </span>
      ) : (
        <Mono className={`text-lg ${warn ? "text-amber-700" : "text-slate-900"}`}>
          {value}
        </Mono>
      )}
    </div>
  );
}

export default function MerchantFinancialProfile() {
  const [positions, setPositions] = useState(
    DETECTED.map((p) => ({ ...p, confirmed: null }))
  );
  const [funderView, setFunderView] = useState(false);

  const answer = (id, value) =>
    setPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, confirmed: value } : p))
    );

  const pending = positions.filter((p) => p.confirmed === null);
  const active = positions.filter((p) => p.confirmed === true);

  const monthlyBurden = active.reduce(
    (s, p) => s + p.paymentAmount * (p.frequency === "daily" ? 21.7 : 4.33),
    0
  );
  const newPayment = (120000 * 1.35) / 6;
  const ptr = (newPayment + monthlyBurden) / METRICS.avgMonthlyRevenue;

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <p className="mx-auto mb-4 max-w-sm text-center text-xs text-slate-400">
        Prototype · mock data · confirm a position, then flip the funder view
      </p>

      <div className="mx-auto max-w-sm overflow-hidden rounded-3xl border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-5 pb-4 pt-5">
          <h1 className="text-xl tracking-tight text-slate-900">
            Your financial picture
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Built from your bank activity — no statements to upload.
          </p>
        </div>

        <button
          onClick={() => setFunderView(!funderView)}
          className={`flex w-full items-center gap-3 border-b px-5 py-3 text-left ${
            funderView
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          <Eye size={16} className="shrink-0" />
          <span className="flex-1">
            <span className="block text-sm">
              {funderView ? "Showing what funders see" : "What do funders see?"}
            </span>
            <span
              className={`block text-xs ${
                funderView ? "text-slate-300" : "text-slate-500"
              }`}
            >
              {funderView
                ? "Your transactions and customers stay hidden"
                : "Tap to compare"}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 opacity-50" />
        </button>

        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
          <Landmark size={18} className="shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-slate-900">
              {METRICS.institution}
            </span>
            <span className="block text-xs text-slate-500">
              {funderView ? "Connected · verified" : METRICS.account}
            </span>
          </span>
          {!funderView && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
              <RefreshCw size={12} /> <Mono>{METRICS.lastSynced}</Mono>
            </span>
          )}
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span className="text-xs uppercase tracking-widest text-slate-400">
              Underwriting snapshot
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Metric label="Monthly revenue" value={money(METRICS.avgMonthlyRevenue)} />
            <Metric label="Avg daily balance" value={money(METRICS.avgDailyBalance)} />
            <Metric
              label="Negative days"
              value={METRICS.negativeDays}
              warn={METRICS.negativeDays > 3}
            />
            <Metric label="Returned payments" value={METRICS.nsfCount} />
            <Metric label="Deposits" value={METRICS.depositCount} />
            <Metric label="Months of history" value={METRICS.monthsCovered} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-4">
            <Metric
              label="Your customers"
              value="—"
              hidden={funderView}
            />
            <Metric label="Individual transactions" value="—" hidden={funderView} />
          </div>
          {funderView && (
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Funders receive the summary above. They never see who pays you,
              who you pay, or any individual transaction.
            </p>
          )}
        </div>

        {!funderView && pending.length > 0 && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-4">
            <div className="mb-1 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-700" />
              <span className="text-sm text-amber-900">
                We think we found existing financing
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-amber-800">
              Confirm these before funders see your file. We could be wrong —
              you have the last word.
            </p>

            <div className="space-y-2">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-amber-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-900">
                        {p.display}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <Mono>{money(p.paymentAmount)}</Mono> {p.frequency} ·
                        since <Mono>{p.firstSeen}</Mono>
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5">
                      <Mono className="text-[11px] text-slate-500">
                        {pct(p.confidence)} sure
                      </Mono>
                    </span>
                  </div>

                  {p.paydownProgress !== null && (
                    <div className="mt-2.5">
                      <div className="mb-1 flex justify-between">
                        <Mono className="text-[11px] text-slate-500">
                          {pct(p.paydownProgress)} paid down
                        </Mono>
                        <Mono className="text-[11px] text-slate-400">
                          {money(p.advanceAmount)} @ {p.impliedFactor}
                        </Mono>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-slate-700"
                          style={{ width: pct(p.paydownProgress) }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => answer(p.id, true)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 text-xs text-white"
                    >
                      <Check size={13} /> That's right
                    </button>
                    <button
                      onClick={() => answer(p.id, false)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-2 text-xs text-slate-700"
                    >
                      <X size={13} /> Not financing
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {active.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <div className="mb-3 flex items-center gap-1.5">
              <TrendingUp size={14} className="text-slate-400" />
              <span className="text-xs uppercase tracking-widest text-slate-400">
                Existing financing
              </span>
            </div>
            {active.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0"
              >
                <span className="text-sm text-slate-700">{p.display}</span>
                <Mono className="text-sm text-slate-600">
                  {money(p.paymentAmount)} {p.frequency}
                </Mono>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">
            If you take {money(120000)}
          </div>
          <div className="flex items-baseline gap-2">
            <Mono
              className={`text-3xl ${
                ptr > 0.35 ? "text-rose-600" : "text-slate-900"
              }`}
            >
              {pct(ptr)}
            </Mono>
            <span className="text-sm text-slate-500">of monthly revenue</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            That's what your payments would come to, including anything you
            already owe. Lower is easier to carry.
          </p>
          {ptr > 0.35 && (
            <p className="mt-2 text-xs leading-relaxed text-rose-700">
              Above 35% gets tight. A smaller amount or a longer term would
              bring it down.
            </p>
          )}
        </div>

        {active.some((p) => p.paydownProgress !== null && p.paydownProgress >= 0.5) && (
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
            <div className="flex items-start gap-2.5">
              <Building2 size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <div>
                <p className="text-sm text-slate-900">
                  You're over halfway through Ridgeline
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Most funders will look at a renewal around here. We'll let you
                  know when more of them will.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
