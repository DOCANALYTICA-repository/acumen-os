"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Briefcase, Handshake, Newspaper, SlidersHorizontal } from "lucide-react";
import { buyResearch, proposeContract, respondContract, saveDecision, sendSimMessage } from "@/app/actions/sim";
import type { FormState } from "@/app/actions/auth";
import { equityOf } from "@/lib/sim/engine";
import { cycleName, defaultDecision, inputNeed, money, num, roleOf, spotPrice, type Decision, type EconomyConfig, type MarketState, type VentureResult, type VentureState } from "@/lib/sim/model";
import { Alert, Badge, Card, Field, cls } from "@/components/ui";

export type WorkspaceData = {
  roundId: string;
  cfg: EconomyConfig;
  status: string;
  currentCycle: number;
  cycleEndsAt: number | null;
  pausedMs: number | null;
  me: { id: string; roleKey: string; state: VentureState; decision: Decision | null; decisionSavedAt: number | null };
  history: VentureResult[];
  marketHistory: MarketState[];
  ventures: { id: string; teamName: string; roleKey: string; isMe: boolean; last: { price: number; endSales: number; marketShare: number; brand: number } | null }[];
  events: { id: string; cycle: number; title: string; description: string }[];
  contracts: { id: string; sellerId: string; buyerId: string; proposerId: string; units: number; unitPrice: number | null; startCycle: number; cycles: number; status: string; note: string; delivered: number | null; shortfall: number | null }[];
  messages: { id: string; fromId: string | null; toId: string | null; body: string; kind: string; at: number }[];
  finalMarks: number | null;
  maxMarks: number;
};

const TABS = [
  { key: "overview", label: "Business overview", icon: Briefcase },
  { key: "market", label: "Market intelligence", icon: Newspaper },
  { key: "decisions", label: "Decisions", icon: SlidersHorizontal },
  { key: "deals", label: "Negotiation & contracts", icon: Handshake },
  { key: "financials", label: "Financials", icon: BarChart3 },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Result({ state }: { state: FormState }) {
  if (!state) return null;
  return <div className="mt-3"><Alert tone={state.error ? "red" : "green"}>{state.error ?? state.ok}</Alert></div>;
}

/** Current time, ticking each second. Null until mounted so server and client HTML match. */
function useClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const istTime = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-ink"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function SimWorkspace({ data }: { data: WorkspaceData }) {
  const router = useRouter();
  const now = useClock();
  const [tab, setTab] = useState<Tab>("overview");
  const { cfg, me, status } = data;
  const role = roleOf(cfg, me.roleKey)!;
  const name = (id: string | null) => (id === null ? "Organisers" : data.ventures.find((v) => v.id === id)?.teamName ?? "Unknown");
  const roleName = (id: string) => roleOf(cfg, data.ventures.find((v) => v.id === id)?.roleKey ?? "")?.name ?? "";

  // Live updates: re-render from the server every 15 s, and right after the window closes.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  const left = status === "OPEN" && data.cycleEndsAt && now !== null ? data.cycleEndsAt - now : null;
  const expired = left !== null && left <= 0;
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(t);
  }, [expired, router]);

  const last = data.history.at(-1);
  const equity = equityOf(role, me.state);
  const incoming = data.contracts.filter((c) => c.status === "PROPOSED" && c.proposerId !== me.id && (c.sellerId === me.id || c.buyerId === me.id));

  return (
    <div>
      <div className="glass mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5">
        <div>
          <div className="eyebrow">{cfg.industry} · {role.name}</div>
          <div className="mt-1 text-lg font-semibold text-ink">
            {status === "SETUP" && "Waiting for the organisers to open the economy"}
            {status === "OPEN" && <>Cycle {data.currentCycle} of {cfg.cycles}: {cycleName(cfg, data.currentCycle)}</>}
            {status === "PROCESSING" && <>Processing cycle {data.currentCycle}…</>}
            {status === "PAUSED" && <>Cycle {data.currentCycle} paused by the organisers</>}
            {status === "FINISHED" && "Simulation complete"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {status === "OPEN" && left !== null && (
            <div className={`rounded-2xl px-4 py-2 text-center ${left < 60_000 ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-800"}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide">{expired ? "Window closed" : "Decisions close in"}</div>
              <div className="font-mono text-2xl font-bold tabular-nums">{expired ? "0:00" : mmss(left)}</div>
            </div>
          )}
          {status === "PAUSED" && data.pausedMs !== null && <Badge tone="amber">{mmss(data.pausedMs)} left when resumed</Badge>}
          {status === "OPEN" && (me.decision ? <Badge tone="green">Decision saved</Badge> : <Badge tone="amber">No decision yet</Badge>)}
          {incoming.length > 0 && <button onClick={() => setTab("deals")} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{incoming.length} proposal{incoming.length > 1 ? "s" : ""} waiting</button>}
        </div>
      </div>

      {status === "FINISHED" && (
        <div className="mb-6">
          <Alert tone="blue">
            The economy has closed. {data.finalMarks !== null ? <>Your round score: <strong>{num(data.finalMarks, 1)} / {data.maxMarks}</strong>.</> : "Scores appear here once the organisers publish results."}
          </Alert>
        </div>
      )}

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-full border border-white/70 bg-white/60 p-1 backdrop-blur" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${tab === t.key ? "bg-gradient-to-r from-sky-600 to-sky-500 text-white shadow" : "text-ink/70 hover:bg-white"}`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Cash" value={money(me.state.cash)} hint={me.state.pendingCharges ? `${money(me.state.pendingCharges)} research due` : undefined} />
            <Kpi label="Debt" value={money(me.state.debt)} hint={`Limit ${money(cfg.creditLimit)}`} tone={me.state.debt > 0 ? "bad" : undefined} />
            <Kpi label="Equity" value={money(equity)} hint={`${num(((equity - me.state.startEquity) / me.state.startEquity) * 100, 1)}% vs start`} tone={equity >= me.state.startEquity ? "good" : "bad"} />
            <Kpi label="Last profit" value={last ? money(last.profit) : "—"} tone={last ? (last.profit >= 0 ? "good" : "bad") : undefined} />
            <Kpi label="Capacity" value={num(me.state.capacity)} hint={me.state.pendingCapacity ? `+${me.state.pendingCapacity} next cycle` : role.product} />
            <Kpi label="Brand · Reliability" value={`${me.state.brand.toFixed(2)} · ${Math.round(me.state.reliability * 100)}%`} hint={`Quality ${me.state.quality.toFixed(2)}`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Your startup: ${role.name}`}>
              <p className="text-sm text-ink/80">{role.blurb}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted">You sell</dt><dd className="font-medium text-ink">{role.product}</dd></div>
                <div><dt className="text-xs text-muted">Reference price</dt><dd className="font-medium text-ink">{money(role.basePrice, false)}</dd></div>
                <div><dt className="text-xs text-muted">Unit cost (before inputs)</dt><dd className="font-medium text-ink">{money(role.unitCost, false)}</dd></div>
                <div><dt className="text-xs text-muted">Fixed cost per cycle</dt><dd className="font-medium text-ink">{money(role.fixedCost)}</dd></div>
              </dl>
              <div className="mt-4 space-y-2 text-sm">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">You buy</span>
                  {role.inputs.length === 0 ? <p className="text-ink/80">No bought-in inputs.</p> : (
                    <ul className="mt-1 space-y-1">
                      {role.inputs.map((i) => {
                        const sellers = data.ventures.filter((v) => v.roleKey === i.role);
                        return <li key={i.role} className="text-ink/80">{i.perUnit} × {roleOf(cfg, i.role)?.product} per unit · spot {money(spotPrice(cfg, i.role), false)} · from {sellers.length ? sellers.map((v) => v.teamName).join(", ") : "simulated suppliers only"}</li>;
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Startups that buy from you</span>
                  <p className="text-ink/80">
                    {cfg.roles.filter((r) => r.inputs.some((i) => i.role === role.key)).flatMap((r) => data.ventures.filter((v) => v.roleKey === r.key).map((v) => `${v.teamName} (${r.name})`)).join(", ") || "None: you sell to the end market only."}
                  </p>
                </div>
                {role.drivers.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Your demand grows with</span>
                    <p className="text-ink/80">{role.drivers.map((d) => roleOf(cfg, d.role)?.name).join(", ")} activity</p>
                  </div>
                )}
              </div>
            </Card>

            <Card title={last ? `What happened in cycle ${last.cycle}` : "Before the first cycle"}>
              {last ? (
                <>
                  <p className="mb-3 text-sm text-ink/80">
                    Sold {num(last.endSales)} of {num(last.demand)} demanded at {money(last.price, false)}{last.contractSales ? `, plus ${num(last.contractSales, 1)} to contract buyers` : ""}. Revenue {money(last.revenue)}, profit {money(last.profit)}.
                  </p>
                  {last.notes.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">{last.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : <p className="text-sm text-muted">No incidents.</p>}
                </>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
                  <li>Every team makes its decisions for the cycle at the same time. Nobody sees anyone else&apos;s choices until the cycle is processed.</li>
                  <li>Sign contracts with the startups you buy from or sell to. Contracts beat the spot market on price but are binding: undelivered units cost a {cfg.contractPenaltyPct}% penalty.</li>
                  <li>Investments, loans, quality and brand carry over from one cycle to the next.</li>
                  <li>Use any tools you like, including AI. The engine decides outcomes from everyone&apos;s choices together.</li>
                </ul>
              )}
            </Card>
          </div>

          {data.history.length > 0 && (
            <Card title="Equity and cash by cycle">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[{ cycle: "Start", equity: me.state.startEquity, cash: cfg.startCash }, ...data.history.map((h) => ({ cycle: `C${h.cycle}`, equity: h.equity, cash: h.cash }))]} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="cycle" tick={{ fontSize: 12, fill: "#4b5563" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => money(v)} tick={{ fontSize: 12, fill: "#4b5563" }} axisLine={false} tickLine={false} width={72} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="equity" name="Equity" stroke="#2a78d6" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="cash" name="Cash" stroke="#eb6834" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "market" && <MarketTab data={data} name={name} />}
      {tab === "decisions" && <DecisionsTab data={data} expired={expired} />}
      {tab === "deals" && <DealsTab data={data} name={name} roleName={roleName} />}
      {tab === "financials" && <FinancialsTab data={data} />}
    </div>
  );
}

// ---------------- Market ----------------

function MarketTab({ data, name }: { data: WorkspaceData; name: (id: string | null) => string }) {
  const { cfg, me } = data;
  const market = data.marketHistory.at(-1);
  const [state, action, pending] = useActionState(buyResearch, undefined);
  const news = [...data.events].reverse();
  const running = data.status === "OPEN" || data.status === "PAUSED";
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Headlines" className="lg:col-span-2">
          {news.length === 0 ? <p className="text-sm text-muted">No market news yet.</p> : (
            <ul className="space-y-3">
              {news.map((e) => (
                <li key={e.id} className="rounded-2xl border border-line/70 bg-white/60 p-3">
                  <div className="flex items-center gap-2"><Badge tone={e.cycle === data.currentCycle && data.status !== "FINISHED" ? "amber" : "gray"}>Cycle {e.cycle}</Badge><span className="font-semibold text-ink">{e.title}</span></div>
                  <p className="mt-1 text-sm text-ink/80">{e.description}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Headlines tagged with the current cycle affect the cycle you are deciding now.</p>
        </Card>
        <Card title="Economy">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">EV adoption index</dt><dd className="font-semibold text-ink">{market ? market.adoption.toFixed(2) : "1.00"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Interest rate (annual)</dt><dd className="font-semibold text-ink">{market ? market.interestRate : cfg.interestRate}%</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Credit limit per startup</dt><dd className="font-semibold text-ink">{money(cfg.creditLimit)}</dd></div>
          </dl>
          {data.marketHistory.length > 1 && <p className="mt-3 text-xs text-muted">Adoption by cycle: {data.marketHistory.map((m) => m.adoption.toFixed(2)).join(" → ")}</p>}
        </Card>
      </div>

      <Card title={market ? `Industry report: cycle ${market.cycle}` : "Industry report"}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className={cls.th}>Segment</th><th className={cls.th}>Startups</th><th className={cls.th}>Demand</th><th className={cls.th}>Sold</th><th className={cls.th}>Avg price</th><th className={cls.th}>Spot price</th></tr></thead>
            <tbody>
              {cfg.roles.map((r) => {
                const m = market?.roles[r.key];
                return (
                  <tr key={r.key} className={`border-t border-line ${r.key === me.roleKey ? "bg-sky-50/60" : ""}`}>
                    <td className={cls.td}><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-muted">{r.product}</div></td>
                    <td className={cls.td}>{data.ventures.filter((v) => v.roleKey === r.key).length}</td>
                    <td className={cls.td}>{m ? num(m.demand) : "—"}</td>
                    <td className={cls.td}>{m ? num(m.sales) : "—"}</td>
                    <td className={cls.td}>{m ? money(m.avgPrice, false) : money(r.basePrice, false)}</td>
                    <td className={cls.td}>{money(m?.spotPrice ?? spotPrice(cfg, r.key), false)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Startups in the economy" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Business</th><th className={cls.th}>Price</th><th className={cls.th}>Sold</th><th className={cls.th}>Share</th><th className={cls.th}>Brand</th></tr></thead>
              <tbody>
                {data.ventures.map((v) => (
                  <tr key={v.id} className={`border-t border-line ${v.isMe ? "bg-sky-50/60" : ""}`}>
                    <td className={`${cls.td} font-medium text-ink`}>{v.teamName}{v.isMe && " (you)"}</td>
                    <td className={cls.td}>{roleOf(cfg, v.roleKey)?.name}</td>
                    <td className={cls.td}>{v.last ? money(v.last.price, false) : "—"}</td>
                    <td className={cls.td}>{v.last ? num(v.last.endSales) : "—"}</td>
                    <td className={cls.td}>{v.last ? `${Math.round(v.last.marketShare * 100)}%` : "—"}</td>
                    <td className={cls.td}>{v.last ? v.last.brand.toFixed(2) : "1.00"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Public data only. Cash, margins, debt and contract prices are private. Buy research or ask in negotiations to learn more.</p>
        </Card>
        <Card title="Commission research">
          <p className="mb-3 text-sm text-ink/80">An analyst report estimates a competitor&apos;s latest revenue, profit, cash, debt and capacity (±8%). Costs {money(cfg.researchCost, false)}, charged with this cycle.</p>
          <form action={action} className="space-y-3">
            <input type="hidden" name="roundId" value={data.roundId} />
            <select name="targetId" className={cls.input} required defaultValue="">
              <option value="" disabled>Choose a startup</option>
              {data.ventures.filter((v) => !v.isMe).map((v) => <option key={v.id} value={v.id}>{v.teamName} · {roleOf(cfg, v.roleKey)?.name}</option>)}
            </select>
            <button disabled={pending || !running} className={`${cls.btn} ${cls.primary} w-full`}>{pending ? "Buying…" : "Buy report"}</button>
          </form>
          <Result state={state} />
          <p className="mt-3 text-xs text-muted">Reports arrive in Negotiation → Desk ({name(null)}).</p>
        </Card>
      </div>
    </div>
  );
}

// ---------------- Decisions ----------------

function DecisionsTab({ data, expired }: { data: WorkspaceData; expired: boolean }) {
  const { cfg, me } = data;
  const role = roleOf(cfg, me.roleKey)!;
  const peers = data.ventures.filter((v) => v.roleKey === me.roleKey).length;
  const owedNow = data.contracts.filter((c) => c.sellerId === me.id && c.status === "ACTIVE" && c.startCycle <= data.currentCycle && c.startCycle + c.cycles - 1 >= data.currentCycle).reduce((s, c) => s + c.units, 0);
  const [d, setD] = useState<Decision>(() => {
    if (me.decision ?? me.state.lastDecision) return (me.decision ?? me.state.lastDecision)!;
    const base = defaultDecision(role, me.state.capacity, peers);
    return { ...base, production: Math.min(me.state.capacity, base.production + Math.ceil(owedNow)) };
  });
  const [state, action, pending] = useActionState(saveDecision, undefined);
  const open = data.status === "OPEN" && !expired;
  const market = data.marketHistory.at(-1);
  const rate = market?.interestRate ?? cfg.interestRate;

  const contractedRoles = useMemo(() => {
    const out = new Set<string>();
    for (const c of data.contracts) {
      if (c.buyerId !== me.id || c.status !== "ACTIVE" || c.startCycle > data.currentCycle || c.startCycle + c.cycles - 1 < data.currentCycle) continue;
      const seller = data.ventures.find((v) => v.id === c.sellerId);
      if (seller) out.add(seller.roleKey);
    }
    return out;
  }, [data, me.id]);
  const owed = owedNow;

  const production = Math.min(d.production, me.state.capacity);
  const inputs = role.inputs.reduce((s, i) => s + production * i.perUnit * spotPrice(cfg, i.role), 0);
  const carry = me.state.debt * (rate / 400) + me.state.pendingCharges;
  const spend = production * role.unitCost + inputs + role.fixedCost + d.marketing + d.quality + d.capacityInvest * role.capexPerUnit + carry;
  const available = me.state.cash + d.borrow - d.repay;
  const set = (k: keyof Decision) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card title={`Decisions for cycle ${data.currentCycle || 1}`}>
        {!open && <div className="mb-4"><Alert tone="amber">{data.status === "SETUP" ? "The economy has not opened yet. You can plan here, but saving is disabled." : data.status === "FINISHED" ? "The simulation has ended." : "The decision window is closed."}</Alert></div>}
        <form action={action} className="space-y-5">
          <input type="hidden" name="roundId" value={data.roundId} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Price per unit (₹)" hint={`Reference ${money(role.basePrice, false)} · allowed ${money(role.basePrice * cfg.minPriceFactor, false)}–${money(role.basePrice * cfg.maxPriceFactor, false)}`}>
              <input name="price" type="number" step="1" value={d.price} onChange={set("price")} className={cls.input} />
            </Field>
            <Field label={`Production (${role.product})`} hint={`Capacity ${num(me.state.capacity)}${owed ? ` · ${num(owed, 1)} owed to contract buyers` : ""}${me.state.inventory ? ` · ${num(me.state.inventory, 1)} in stock` : ""}`}>
              <input name="production" type="number" min={0} max={me.state.capacity} value={d.production} onChange={set("production")} className={cls.input} />
            </Field>
            <Field label="Marketing spend (₹)" hint="Lifts demand now and builds brand over time">
              <input name="marketing" type="number" min={0} step="1000" value={d.marketing} onChange={set("marketing")} className={cls.input} />
            </Field>
            <Field label="Quality / R&D spend (₹)" hint="Raises your quality index for future cycles">
              <input name="quality" type="number" min={0} step="1000" value={d.quality} onChange={set("quality")} className={cls.input} />
            </Field>
            <Field label="Add capacity (units)" hint={`${money(role.capexPerUnit, false)} per unit · online next cycle`}>
              <input name="capacityInvest" type="number" min={0} max={role.startCapacity} value={d.capacityInvest} onChange={set("capacityInvest")} className={cls.input} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Borrow (₹)" hint={`Up to ${money(Math.max(0, cfg.creditLimit - me.state.debt))} at ${rate}%/yr`}>
                <input name="borrow" type="number" min={0} step="10000" value={d.borrow} onChange={set("borrow")} className={cls.input} />
              </Field>
              <Field label="Repay (₹)" hint={`Debt ${money(me.state.debt)}`}>
                <input name="repay" type="number" min={0} step="10000" value={d.repay} onChange={set("repay")} className={cls.input} />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={!open || pending} className={`${cls.btn} ${cls.primary}`}>{pending ? "Saving…" : me.decision ? "Update decision" : "Submit decision"}</button>
            {me.decisionSavedAt && <span className="text-xs text-muted">Last saved {istTime(me.decisionSavedAt)}</span>}
          </div>
          <Result state={state} />
          <p className="text-xs text-muted">If you do not submit, last cycle&apos;s price, production, marketing and quality are reused, with no new investment or borrowing.</p>
        </form>
      </Card>

      <Card title="Cash check (estimate)">
        <dl className="space-y-2 text-sm">
          <Row k="Production" v={production * role.unitCost} />
          <Row k="Inputs at spot price" v={inputs} hint={contractedRoles.size ? "Your contracted inputs will cost less than this" : undefined} />
          <Row k="Fixed costs" v={role.fixedCost} />
          <Row k="Marketing + quality" v={d.marketing + d.quality} />
          <Row k="Capacity investment" v={d.capacityInvest * role.capexPerUnit} />
          <Row k="Interest + research" v={carry} />
          <div className="border-t border-line pt-2"><Row k="Spend before revenue" v={spend} strong /></div>
          <Row k="Cash available" v={available} strong />
        </dl>
        {spend > available && <div className="mt-3"><Alert tone="red">Spending exceeds cash before any revenue arrives. If sales fall short, an emergency loan with a {cfg.emergencyFeePct}% fee will be drawn.</Alert></div>}
        <p className="mt-3 text-xs text-muted">Revenue depends on your price, your rivals&apos; choices and the market, so it is not estimated here.</p>
      </Card>
    </div>
  );
}

function Row({ k, v, strong, hint }: { k: string; v: number; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-semibold text-ink" : "text-muted"}>{k}{hint && <span className="block text-[11px] text-muted">{hint}</span>}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-ink" : "text-ink"}`}>{money(v)}</dd>
    </div>
  );
}

// ---------------- Negotiation & contracts ----------------

function DealsTab({ data, name, roleName }: { data: WorkspaceData; name: (id: string | null) => string; roleName: (id: string) => string }) {
  const { cfg, me } = data;
  const [thread, setThread] = useState<string>("desk");
  const [msgState, msgAction, msgPending] = useActionState(sendSimMessage, undefined);
  const [propState, propAction, propPending] = useActionState(proposeContract, undefined);
  const [respState, respAction, respPending] = useActionState(respondContract, undefined);
  const running = data.status === "OPEN" || data.status === "PAUSED";
  const others = data.ventures.filter((v) => !v.isMe);
  const [cp, setCp] = useState<string>(others[0]?.id ?? "");
  const other = data.ventures.find((v) => v.id === cp);
  const canSell = other ? !!inputNeed(cfg, me.roleKey, other.roleKey) : false;
  const canBuy = other ? !!inputNeed(cfg, other.roleKey, me.roleKey) : false;
  const [dir, setDir] = useState<"sell" | "buy">("sell");
  const direction = canSell && canBuy ? dir : canSell ? "sell" : "buy";
  const sellerRole = direction === "sell" ? me.roleKey : other?.roleKey ?? "";
  const buyerRole = direction === "sell" ? other?.roleKey ?? "" : me.roleKey;
  const need = inputNeed(cfg, sellerRole, buyerRole);
  const buyerRoleDef = roleOf(cfg, buyerRole);
  const suggested = need && buyerRoleDef ? Math.round(buyerRoleDef.refDemand * need.perUnit) : 0;
  const remaining = Math.max(1, cfg.cycles - data.currentCycle + 1);

  const threadMsgs = data.messages.filter((m) =>
    thread === "desk" ? m.fromId === null : thread === "all" ? m.toId === null && m.fromId !== null : (m.fromId === thread && m.toId === me.id) || (m.fromId === me.id && m.toId === thread),
  );
  const mineContracts = data.contracts.filter((c) => c.sellerId === me.id || c.buyerId === me.id);
  const publicContracts = data.contracts.filter((c) => c.sellerId !== me.id && c.buyerId !== me.id);
  const tone = (s: string) => (s === "ACTIVE" ? "green" : s === "PROPOSED" ? "amber" : s === "COMPLETED" ? "blue" : "gray") as "green" | "amber" | "blue" | "gray";
  const productOf = (ventureId: string) => roleOf(cfg, data.ventures.find((v) => v.id === ventureId)?.roleKey ?? "")?.product;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card title="Conversations" className="h-fit">
          <ul className="space-y-1 text-sm">
            {[{ id: "desk", label: "Desk: organisers & reports" }, { id: "all", label: "Everyone (public)" }, ...others.map((v) => ({ id: v.id, label: `${v.teamName} · ${roleOf(cfg, v.roleKey)?.name}` }))].map((t) => (
              <li key={t.id}>
                <button onClick={() => setThread(t.id)} className={`w-full rounded-xl px-3 py-2 text-left transition ${thread === t.id ? "bg-sky-100 font-semibold text-sky-800" : "hover:bg-white"}`}>{t.label}</button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={thread === "desk" ? "Desk" : thread === "all" ? "Everyone" : `${name(thread)} · ${roleName(thread)}`}>
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {threadMsgs.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
            {threadMsgs.map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.fromId === me.id ? "ml-auto bg-sky-600 text-white" : m.kind === "INTEL" ? "bg-violet-50 text-ink" : m.kind === "SYSTEM" ? "bg-amber-50 text-ink" : "bg-white text-ink shadow-soft"}`}>
                <div className={`mb-0.5 text-[11px] font-semibold ${m.fromId === me.id ? "text-sky-100" : "text-muted"}`}>{m.fromId === me.id ? "You" : name(m.fromId)} · {istTime(m.at)}</div>
                <div className="whitespace-pre-line break-words">{m.body}</div>
              </div>
            ))}
          </div>
          {thread !== "desk" && (
            <form action={msgAction} className="mt-4 flex gap-2">
              <input type="hidden" name="roundId" value={data.roundId} />
              <input type="hidden" name="toId" value={thread === "all" ? "" : thread} />
              <input name="body" maxLength={1000} placeholder={thread === "all" ? "Message every team…" : "Write a message…"} className={cls.input} />
              <button disabled={msgPending} className={`${cls.btn} ${cls.primary}`}>Send</button>
            </form>
          )}
          <Result state={msgState} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Propose a contract">
          {!running ? <Alert tone="gray">Contracts can be proposed while the simulation is running.</Alert> : (
            <form action={propAction} className="space-y-3">
              <input type="hidden" name="roundId" value={data.roundId} />
              <Field label="Counterparty">
                <select name="counterpartyId" value={cp} onChange={(e) => setCp(e.target.value)} className={cls.input}>
                  {others.map((v) => {
                    const ok = inputNeed(cfg, me.roleKey, v.roleKey) || inputNeed(cfg, v.roleKey, me.roleKey);
                    return <option key={v.id} value={v.id}>{v.teamName} · {roleOf(cfg, v.roleKey)?.name}{ok ? "" : " (no trade link)"}</option>;
                  })}
                </select>
              </Field>
              {!canSell && !canBuy ? (
                <Alert tone="gray">Neither of you uses the other&apos;s product. Talk to them anyway: their moves still shape your market.</Alert>
              ) : (
                <>
                  <input type="hidden" name="direction" value={direction} />
                  {canSell && canBuy && (
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1"><input type="radio" checked={dir === "sell"} onChange={() => setDir("sell")} /> We sell to them</label>
                      <label className="flex items-center gap-1"><input type="radio" checked={dir === "buy"} onChange={() => setDir("buy")} /> We buy from them</label>
                    </div>
                  )}
                  <p className="text-sm text-ink/80">
                    {direction === "sell" ? "You supply" : "They supply"} <strong>{roleOf(cfg, sellerRole)?.product}</strong>. {buyerRoleDef?.name} uses {need?.perUnit} per unit produced (about {suggested} per cycle at reference volume). Spot price: {money(spotPrice(cfg, sellerRole), false)}.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Units / cycle"><input name="units" type="number" min={0.1} step="0.1" defaultValue={suggested || 10} key={`u${cp}${direction}`} className={cls.input} /></Field>
                    <Field label="Price / unit (₹)"><input name="unitPrice" type="number" min={1} defaultValue={Math.round(spotPrice(cfg, sellerRole) * 0.9)} key={`p${cp}${direction}`} className={cls.input} /></Field>
                    <Field label="Cycles"><input name="cycles" type="number" min={1} max={remaining} defaultValue={remaining} className={cls.input} /></Field>
                  </div>
                  <Field label="Note (optional)"><input name="note" maxLength={300} className={cls.input} placeholder="e.g. priority supply for a 3-cycle commitment" /></Field>
                  <button disabled={propPending} className={`${cls.btn} ${cls.primary}`}>{propPending ? "Sending…" : "Send proposal"}</button>
                </>
              )}
              <Result state={propState} />
            </form>
          )}
        </Card>

        <Card title="Your contracts">
          {mineContracts.length === 0 ? <p className="text-sm text-muted">No contracts yet.</p> : (
            <ul className="space-y-3">
              {mineContracts.map((c) => {
                const selling = c.sellerId === me.id;
                const otherId = selling ? c.buyerId : c.sellerId;
                return (
                  <li key={c.id} className="rounded-2xl border border-line/70 bg-white/60 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{selling ? "Sell to" : "Buy from"} {name(otherId)}</span>
                      <Badge tone={tone(c.status)}>{c.status.toLowerCase()}</Badge>
                    </div>
                    <div className="mt-1 text-ink/80">{num(c.units, 1)} {productOf(c.sellerId)}/cycle at {money(c.unitPrice ?? 0, false)} · {c.status === "PROPOSED" ? `${c.cycles} cycles` : `cycles ${c.startCycle}–${c.startCycle + c.cycles - 1}`}</div>
                    {c.note && <div className="mt-1 text-xs text-muted">“{c.note}”</div>}
                    {(c.status === "ACTIVE" || c.status === "COMPLETED") && <div className="mt-1 text-xs text-muted">Delivered {num(c.delivered ?? 0, 1)}{c.shortfall ? ` · short ${num(c.shortfall, 1)}` : ""}</div>}
                    {c.status === "PROPOSED" && running && (
                      <form action={respAction} className="mt-2 flex gap-2">
                        <input type="hidden" name="roundId" value={data.roundId} />
                        <input type="hidden" name="contractId" value={c.id} />
                        {c.proposerId === me.id ? (
                          <button name="action" value="withdraw" disabled={respPending} className={`${cls.btn} ${cls.secondary} px-3 py-1 text-xs`}>Withdraw</button>
                        ) : (
                          <>
                            <button name="action" value="accept" disabled={respPending} className={`${cls.btn} ${cls.primary} px-3 py-1 text-xs`}>Accept (binding)</button>
                            <button name="action" value="reject" disabled={respPending} className={`${cls.btn} ${cls.secondary} px-3 py-1 text-xs`}>Decline</button>
                          </>
                        )}
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Result state={respState} />
        </Card>
      </div>

      <Card title="Public contract register">
        {publicContracts.length === 0 ? <p className="text-sm text-muted">No contracts between other teams yet.</p> : (
          <ul className="grid gap-2 text-sm md:grid-cols-2">
            {publicContracts.map((c) => (
              <li key={c.id} className="rounded-xl bg-white/60 px-3 py-2 text-ink/80">
                <strong className="text-ink">{name(c.sellerId)}</strong> supplies <strong className="text-ink">{name(c.buyerId)}</strong>: {num(c.units, 1)} {productOf(c.sellerId)}/cycle, cycles {c.startCycle}–{c.startCycle + c.cycles - 1}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Volumes and parties are public. Prices stay private to the two parties.</p>
      </Card>
    </div>
  );
}

// ---------------- Financials ----------------

function FinancialsTab({ data }: { data: WorkspaceData }) {
  const h = data.history;
  if (!h.length) return <Card title="Financials"><p className="text-sm text-muted">Results appear after the first cycle is processed.</p></Card>;
  const rows: [string, (r: VentureResult) => string][] = [
    ["Price", (r) => money(r.price, false)],
    ["Produced", (r) => num(r.produced)],
    ["Customer demand", (r) => num(r.demand)],
    ["Sold to customers", (r) => num(r.endSales)],
    ["Market share", (r) => `${Math.round(r.marketShare * 100)}%`],
    ["Delivered on contracts", (r) => num(r.contractSales, 1)],
    ["Revenue", (r) => money(r.revenue)],
    ["Production cost", (r) => money(r.costs.production)],
    ["Inputs (contracts)", (r) => money(r.costs.contractInputs)],
    ["Inputs (spot)", (r) => money(r.costs.spotInputs)],
    ["Fixed costs", (r) => money(r.costs.fixed)],
    ["Marketing", (r) => money(r.costs.marketing)],
    ["Quality / R&D", (r) => money(r.costs.quality)],
    ["Interest", (r) => money(r.costs.interest)],
    ["Penalties paid / received", (r) => `${money(r.costs.penalties)} / ${money(r.penaltyIncome)}`],
    ["Research", (r) => money(r.costs.research)],
    ["Holding cost", (r) => money(r.costs.holding)],
    ["Profit", (r) => money(r.profit)],
    ["Capacity investment", (r) => money(r.capex)],
    ["Cash (end)", (r) => money(r.cash)],
    ["Debt (end)", (r) => money(r.debt)],
    ["Equity (end)", (r) => money(r.equity)],
    ["Inventory", (r) => num(r.inventory, 1)],
    ["Brand / quality", (r) => `${r.brand.toFixed(2)} / ${r.quality.toFixed(2)}`],
  ];
  return (
    <Card title="Financial statements by cycle">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className={cls.th}>Line</th>{h.map((r) => <th key={r.cycle} className={`${cls.th} text-right`}>C{r.cycle}{r.autoCarried ? "*" : ""}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label} className={`border-t border-line ${label === "Profit" || label === "Revenue" ? "font-semibold" : ""}`}>
                <td className={cls.td}>{label}</td>
                {h.map((r) => <td key={r.cycle} className={`${cls.td} text-right tabular-nums`}>{f(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {h.some((r) => r.autoCarried) && <p className="mt-3 text-xs text-muted">* No decision submitted that cycle; the previous plan was reused.</p>}
    </Card>
  );
}
