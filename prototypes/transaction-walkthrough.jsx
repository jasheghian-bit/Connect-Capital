import { useState } from "react";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Landmark,
  Lock,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

/*
  Connect Capital — the whole transaction, one screen.

  ALL DATA IS MOCK. Every state below mirrors what the built system produces.

  The point of this walkthrough: step through a real funding and flip between
  the four perspectives at each moment. The company's entire thesis is "who can
  see what, and when" — this is that thesis made clickable.

  Watch step 3. The merchant authorizes Harbor Point and not Ridgeline. From
  that moment Harbor Point sees a business name and a phone number; Ridgeline
  sees industry, state, and numbers, and never learns who the merchant is.
*/

const VIEWS = [
  { id: "merchant", label: "Merchant", sub: "Northshore Auto" },
  { id: "harbor", label: "Harbor Point", sub: "authorized" },
  { id: "ridgeline", label: "Ridgeline", sub: "not authorized" },
  { id: "system", label: "System record", sub: "audit log" },
];

const STEPS = [
  {
    t: "Merchant applies",
    note: "Six questions, then a bank connection. No documents yet, no funder has seen anything.",
  },
  {
    t: "Platform matches",
    note: "Six funders fit, each with the reasons why — including the ones that don't fit cleanly.",
  },
  {
    t: "Merchant authorizes",
    note: "Harbor Point gets access. Ridgeline does not. This is the moment the product exists for.",
  },
  {
    t: "Funder reviews",
    note: "Harbor Point sees identity and documents. Ridgeline still sees a blinded card.",
  },
  {
    t: "Document requested",
    note: "One upload satisfies every funder asking for the same thing.",
  },
  {
    t: "Offer made",
    note: "Terms plus a full disclosure. The offer cannot be submitted without one.",
  },
  {
    t: "Merchant counters",
    note: "The merchant negotiates directly. No intermediary translating.",
  },
  {
    t: "Offer revised",
    note: "Revision 2. Revision 1 is not overwritten — it stays in the record.",
  },
  {
    t: "Accepted and funded",
    note: "Funder wires directly. The platform records it and accrues its fee.",
  },
];

const AUDIT = [
  { s: 0, a: "you", t: "You started your funding request." },
  { s: 0, a: "you", t: "You connected your bank account." },
  { s: 0, a: "you", t: "You submitted your request." },
  { s: 1, a: "platform", t: "We found 6 funders that fit your business." },
  { s: 2, a: "you", t: "You gave Harbor Point Capital access to your file." },
  { s: 3, a: "provider", t: "Harbor Point Capital opened your bank summary." },
  { s: 3, a: "provider", t: "Harbor Point Capital started reviewing your file." },
  { s: 4, a: "provider", t: "Harbor Point Capital asked for a bank statement." },
  { s: 4, a: "you", t: "You uploaded a bank statement." },
  { s: 5, a: "provider", t: "Harbor Point Capital offered you $118,500." },
  { s: 5, a: "you", t: "You reviewed the full terms." },
  { s: 6, a: "you", t: "You asked for better terms." },
  { s: 7, a: "provider", t: "Harbor Point Capital revised their offer." },
  { s: 7, a: "you", t: "You reviewed the full terms." },
  { s: 8, a: "you", t: "You accepted Harbor Point Capital's offer." },
  { s: 8, a: "provider", t: "Harbor Point Capital funded $120,000." },
];

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

function Mono({ children, className = "" }) {
  return (
    <span className={`font-mono tabular-nums tracking-tight ${className}`}>
      {children}
    </span>
  );
}

function Row({ label, value, warn }) {
  return (
    <div className="flex items-baseline justify-between border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <Mono className={`text-sm ${warn ? "text-rose-600" : "text-slate-900"}`}>
        {value}
      </Mono>
    </div>
  );
}

function Phone({ children }) {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border border-slate-300 bg-white">
      {children}
    </div>
  );
}

function Desk({ name, verified, children }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <span className="text-sm text-slate-900">{name}</span>
        {verified && (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            <BadgeCheck size={11} /> Verified
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function MerchantView({ step }) {
  return (
    <Phone>
      <div className="border-b border-slate-200 px-5 pb-4 pt-5">
        <div className="text-[11px] uppercase tracking-widest text-slate-400">
          Your request
        </div>
        <Mono className="text-2xl text-slate-900">{money(120000)}</Mono>
        <div className="mt-0.5 text-xs text-slate-500">
          {step === 0 && "Submitted just now"}
          {step === 1 && "6 funders fit your business"}
          {step >= 2 && step < 5 && "1 funder authorized · reviewing"}
          {step >= 5 && step < 8 && "1 offer · negotiating"}
          {step === 8 && "Funded"}
        </div>
      </div>

      {step === 0 && (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <Landmark size={16} className="shrink-0 text-emerald-700" />
            <div>
              <div className="text-sm text-emerald-900">Provident Bank connected</div>
              <div className="text-xs text-emerald-800">
                No statements to upload
              </div>
            </div>
          </div>
          <Row label="Monthly revenue" value={money(95400)} />
          <Row label="Negative days" value="2" />
          <Row label="Open positions" value="1" />
        </div>
      )}

      {step === 1 && (
        <div className="px-5 py-4">
          {[
            {
              n: "Harbor Point Capital",
              r: ["$120,000 is inside their range", "Auto repair accepted"],
              ok: true,
            },
            {
              n: "Ridgeline Funding",
              r: ["Revenue clears their minimum", "Prefers 1st position"],
              ok: false,
            },
          ].map((p) => (
            <div
              key={p.n}
              className="mb-2 rounded-xl border border-slate-200 p-3"
            >
              <div className="flex items-center gap-1.5 text-sm text-slate-900">
                {p.n} <BadgeCheck size={14} className="text-emerald-600" />
              </div>
              {p.r.map((x, i) => (
                <div key={x} className="mt-1.5 flex items-start gap-1.5">
                  {i === 1 && !p.ok ? (
                    <TriangleAlert size={12} className="mt-0.5 text-amber-600" />
                  ) : (
                    <ShieldCheck size={12} className="mt-0.5 text-emerald-600" />
                  )}
                  <span className="text-xs text-slate-600">{x}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="text-center text-xs text-slate-400">+ 4 more</div>
        </div>
      )}

      {step === 2 && (
        <div className="px-5 py-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-900">
              Give Harbor Point Capital access?
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-slate-600">
              <div>Business name and contact</div>
              <div>Revenue and balances</div>
              <div>Your ID and voided check</div>
            </div>
            <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
              Raw bank statements — <Mono>off</Mono>
            </div>
            <button className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-xs text-white">
              Authorize Harbor Point
            </button>
          </div>
        </div>
      )}

      {step >= 3 && step < 5 && (
        <div className="px-5 py-4">
          <div className="mb-2 text-[11px] uppercase tracking-widest text-slate-400">
            Who has your file
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-900">Harbor Point Capital</span>
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                Active
              </span>
            </div>
            <div className="mt-2 border-l-2 border-slate-200 pl-2.5 text-xs text-slate-500">
              <div>Opened bank summary · 11:04am</div>
              {step >= 4 && <div>Requested a statement · 11:12am</div>}
            </div>
          </div>
          {step === 4 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm text-amber-900">
                Harbor Point needs your August statement
              </div>
              <button className="mt-2 w-full rounded-lg bg-amber-700 py-2 text-xs text-white">
                Upload
              </button>
            </div>
          )}
        </div>
      )}

      {step >= 5 && (
        <div className="px-5 py-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-slate-900">Harbor Point Capital</span>
              {step >= 7 && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  Revision 2
                </span>
              )}
            </div>
            <Row
              label="You receive"
              value={money(step >= 7 ? 120000 : 118500)}
            />
            <Row
              label="You repay"
              value={money(step >= 7 ? 158400 : 160000)}
            />
            <Row
              label="Daily payment"
              value={money(step >= 7 ? 1257 : 1270)}
            />
            <Row label="Estimated APR" value={step >= 7 ? "94.2%" : "101.8%"} />
            <Row
              label="Share of revenue"
              value={step >= 7 ? "29%" : "31%"}
            />
            {step === 6 && (
              <div className="mt-3 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-600">
                You asked for a lower factor and a longer term.
              </div>
            )}
            {step === 8 ? (
              <div className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-center text-xs text-emerald-800">
                Accepted · funded <Mono>{money(120000)}</Mono>
              </div>
            ) : (
              <button className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-xs text-white">
                {step === 5 ? "Counter" : step === 7 ? "Accept" : "Waiting"}
              </button>
            )}
          </div>
        </div>
      )}
    </Phone>
  );
}

function HarborView({ step }) {
  const authorized = step >= 3;
  return (
    <Desk name="Harbor Point Capital" verified>
      {!authorized ? (
        <BlindedBody step={step} />
      ) : (
        <div className="p-4">
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm text-emerald-900">
              <Eye size={14} /> Authorized by the merchant
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <div>
                <div className="text-slate-500">Legal name</div>
                <div className="text-slate-900">Northshore Auto Repair LLC</div>
              </div>
              <div>
                <div className="text-slate-500">Owner</div>
                <div className="text-slate-900">Dana Whitfield</div>
              </div>
              <div>
                <div className="text-slate-500">Phone</div>
                <Mono className="text-slate-900">(732) 555-0100</Mono>
              </div>
              <div>
                <div className="text-slate-500">Address</div>
                <div className="text-slate-900">418 Sycamore Ave, NJ</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Row label="Monthly revenue" value={money(95400)} />
              <Row label="Avg daily balance" value={money(8420)} />
              <Row label="Negative days" value="2" />
            </div>
            <div>
              <Row label="Open positions" value="1" />
              <Row label="Payment burden" value="33%" />
              <Row label="Data" value="bank-verified" />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-700">
              <FileText size={13} className="text-slate-400" /> Documents
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              <div className="flex justify-between px-3 py-2">
                <span className="text-slate-700">Government ID</span>
                <span className="text-slate-400">v1</span>
              </div>
              {step >= 5 && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-slate-700">August statement</span>
                  <span className="text-slate-400">v1</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 px-3 py-2 text-slate-400">
                <Lock size={11} /> 2 outside your scope
              </div>
            </div>
          </div>

          {step >= 5 && (
            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <div className="mb-2 text-xs text-slate-500">
                Your offer {step >= 7 && "· revision 2"}
              </div>
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">Advance</div>
                  <Mono className="text-slate-900">
                    {money(step >= 7 ? 120000 : 118500)}
                  </Mono>
                </div>
                <div>
                  <div className="text-slate-500">Factor</div>
                  <Mono className="text-slate-900">
                    {step >= 7 ? "1.32" : "1.35"}
                  </Mono>
                </div>
                <div>
                  <div className="text-slate-500">Est. APR</div>
                  <Mono className="text-slate-900">
                    {step >= 7 ? "94.2%" : "101.8%"}
                  </Mono>
                </div>
                <div>
                  <div className="text-slate-500">Status</div>
                  <span className="text-slate-900">
                    {step === 8 ? "Funded" : step === 6 ? "Countered" : "Live"}
                  </span>
                </div>
              </div>
              {step === 8 && (
                <div className="mt-3 rounded-lg bg-slate-100 p-2 text-xs text-slate-600">
                  Platform fee accrued: <Mono>{money(3600)}</Mono> · 3% of{" "}
                  <Mono>{money(120000)}</Mono>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Desk>
  );
}

function BlindedBody({ step }) {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <EyeOff size={16} className="mt-0.5 shrink-0 text-slate-400" />
        <div>
          <div className="text-sm text-slate-900">
            {step < 2
              ? "Awaiting merchant authorization"
              : "The merchant chose other funders"}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Name, address, owner, and contact stay hidden. Everything below is
            enough to decide whether you want the file.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8">
        <div>
          <Row label="Industry" value="Auto repair" />
          <Row label="Location" value="Monmouth Cty, NJ" />
          <Row label="Time in business" value="4 yrs" />
          <Row label="Requested" value={money(120000)} />
        </div>
        <div>
          <Row label="Monthly revenue" value={money(95400)} />
          <Row label="Negative days" value="2" />
          <Row label="Open positions" value="1" />
          <Row label="Payment burden" value="33%" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {["Business name", "Owner", "Phone", "Documents"].map((f) => (
          <div
            key={f}
            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-400"
          >
            <Lock size={11} /> {f}
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemView({ step }) {
  const shown = AUDIT.filter((e) => e.s <= step);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <span className="text-sm text-slate-900">Transaction record</span>
        <span className="ml-2 text-xs text-slate-400">
          <Mono>{shown.length}</Mono> events · hash-chained · append-only
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {shown.map((e, i) => (
          <div key={i} className="flex items-baseline gap-3 px-4 py-2">
            <Mono className="w-8 shrink-0 text-[11px] text-slate-400">
              {String(i + 1).padStart(2, "0")}
            </Mono>
            <span
              className={`w-16 shrink-0 text-[11px] ${
                e.a === "you"
                  ? "text-slate-900"
                  : e.a === "provider"
                  ? "text-slate-500"
                  : "text-slate-400"
              }`}
            >
              {e.a === "you" ? "merchant" : e.a}
            </span>
            <span className="text-xs text-slate-700">{e.t}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-400">
        Refused access attempts, admin actions, and internal underwriting notes
        exist in the audit log and never render here. The timeline is an
        allowlist.
      </div>
    </div>
  );
}

export default function TransactionWalkthrough() {
  const [step, setStep] = useState(0);
  const [view, setView] = useState("merchant");

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl">
        <p className="mb-4 text-xs text-slate-400">
          Prototype · mock data · step through the transaction, switch
          perspective at any point
        </p>

        <div className="mb-4 flex gap-1 rounded-xl border border-slate-300 bg-white p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-left ${
                view === v.id ? "bg-slate-900 text-white" : "text-slate-600"
              }`}
            >
              <span className="block text-xs">{v.label}</span>
              <span
                className={`block text-[10px] ${
                  view === v.id ? "text-slate-400" : "text-slate-400"
                }`}
              >
                {v.sub}
              </span>
            </button>
          ))}
        </div>

        <div className="mb-4 rounded-xl border border-slate-300 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 text-sm text-slate-500 disabled:text-slate-300"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <div className="text-center">
              <Mono className="text-[11px] text-slate-400">
                {step + 1} / {STEPS.length}
              </Mono>
              <div className="text-sm text-slate-900">{STEPS[step].t}</div>
            </div>
            <button
              onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}
              disabled={step === STEPS.length - 1}
              className="flex items-center gap-1 text-sm text-slate-900 disabled:text-slate-300"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1 flex-1 rounded-full ${
                  i <= step ? "bg-slate-900" : "bg-slate-200"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mb-4">
          {view === "merchant" && <MerchantView step={step} />}
          {view === "harbor" && <HarborView step={step} />}
          {view === "ridgeline" && (
            <Desk name="Ridgeline Funding Group" verified>
              <BlindedBody step={step} />
            </Desk>
          )}
          {view === "system" && <SystemView step={step} />}
        </div>

        <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-600">
          {STEPS[step].note}
        </div>
      </div>
    </div>
  );
}
