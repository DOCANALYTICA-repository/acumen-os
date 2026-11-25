"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Award as AwardIcon, Gavel, Handshake, LineChart as ChartIcon, Mail, Settings2, Trophy } from "lucide-react";
import { bidOnLot, buyResearch, proposeContract, respondContract, saveDecision, sendSimMessage, setCompanyName } from "@/app/actions/sim";
import type { FormState } from "@/app/actions/auth";
import type { Award } from "@/lib/sim/engine";
import {
  DEAL_KINDS, DEFAULT_LEVER_SHARE, LEVERS, cycleName, defaultDecision, inputNeed, leverRef, leverTotal, money, num, pct, roleOf, spotPrice,
  type DealKind, type Decision, type EconomyConfig, type FinalMetrics, type MarketState, type VentureResult, type VentureState,
} from "@/lib/sim/model";
import { Alert, Badge, Card, cls } from "@/components/ui";
import { SoundCheck, playSound, useSoundUnlock } from "@/components/sound";

export type WorkspaceData = {
  roundId: string;
  cfg: EconomyConfig;
  status: string;
  currentCycle: number;
  cycleEndsAt: number | null;
  pausedMs: number | null;
  economy: MarketState;
  me: { id: string; roleKey: string; state: VentureState | null; wallet: number; decision: Decision | null; decisionSavedAt: number | null };
  history: VentureResult[];
  marketHistory: MarketState[];
  ventures: {
    id: string; teamName: string; companyName: string; roleKey: string; assets: string[]; isMe: boolean;
    last: { price: number; endSales: number; marketShare: number; brand: number; customerSat: number } | null;
  }[];
  auction: {
    id: string; order: number; kind: "IDENTITY" | "RESOURCE"; key: string; name: string; description: string; reserve: number; status: string; endsAt: number | null;
    topBid: { amount: number; teamName: string; mine: boolean } | null; winner: { teamName: string; mine: boolean } | null; price: number | null;
  }[];
  events: { id: string; cycle: number; title: string; description: string }[];
  contracts: {
    id: string; kind: string; sellerId: string; buyerId: string; proposerId: string; units: number | null; unitPrice: number | null; ratePct: number | null;
    startCycle: number; cycles: number; status: string; note: string; delivered: number | null; shortfall: number | null;
  }[];
  messages: { id: string; fromId: string | null; toId: string | null; body: string; kind: string; at: number }[];
  final: { awards: Award[]; table: (FinalMetrics & { marks: number })[] | null; mine: FinalMetrics | null } | null;
  finalMarks: number | null;
  maxMarks: number;
};

function useNow(tickMs = 1000) {
  const [now, setNow] = useState<number | null>(null); // null until mounted: SSR and client markup match
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function istTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

function Msg({ state }: { state: FormState }) {
  if (!state) return null;
  return state.error ? <p className="mt-2 text-sm font-medium text-red-700" role="alert">{state.error}</p> : <p className="mt-2 text-sm text-emerald-700" role="status">{state.ok}</p>;
}

function Submit({ children, pending, variant = "primary", className = "" }: { children: React.ReactNode; pending: boolean; variant?: "primary" | "secondary" | "danger"; className?: string }) {
  return <button type="submit" disabled={pending} className={`${cls.btn} ${cls[variant]} ${className}`}>{pending ? "Working…" : children}</button>;
}

const Index = ({ label, value, hint }: { label: string; value: number; hint?: string }) => (
  <div title={hint}>
    <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><span className="font-semibold tabular-nums text-ink">{Math.round(value)}</span></div>
    <div className="mt-1 h-2 rounded-full bg-line/60"><div className="h-2 rounded-full bg-sky-600" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>
  </div>
);

const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-2xl bg-white/80 p-4 shadow-soft">
    <div className="text-xs text-muted">{label}</div>
    <div className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</div>
    {sub && <div className="text-xs text-muted">{sub}</div>}
  </div>
);

/**
 * Messages and deal proposals from other teams: plays a chime when a new one arrives and counts unread messages.
 * "Read" means seen on the Deals & messages tab; the time of the newest read message is kept in this browser.
 */
function useInbox(data: WorkspaceData) {
  const me = data.me.id;
  const key = `acumen-sim-seen:${data.roundId}:${me}`;
  const incoming = data.messages.filter((m) => m.fromId !== me && m.kind !== "INTEL"); // research reports are the team's own purchase
  const proposals = data.contracts.filter((c) => c.status === "PROPOSED" && c.proposerId !== me && (c.sellerId === me || c.buyerId === me));
  const latest = incoming.reduce((a, m) => Math.max(a, m.at), 0);

  const [seenAt, setSeenAt] = useState<number | null>(null); // null until mounted
  useEffect(() => {
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null && Number.isFinite(Number(raw))) stored = Number(raw);
    } catch {}
    setSeenAt(stored ?? latest); // first visit on this browser: what is already there counts as read
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per team
  }, [key]);
  const markSeen = useCallback(() => {
    setSeenAt(latest);
    try {
      localStorage.setItem(key, String(latest));
    } catch {}
  }, [key, latest]);

  const ids = [...incoming.map((m) => m.id), ...proposals.map((c) => c.id)].join(",");
  const heard = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    if (heard.current === null) {
      heard.current = new Set(list); // nothing plays for what was already there on load
      return;
    }
    const fresh = list.filter((id) => !heard.current!.has(id));
    fresh.forEach((id) => heard.current!.add(id));
    if (fresh.length) playSound("message");
  }, [ids]);

  const unread = seenAt === null ? 0 : incoming.filter((m) => m.at > seenAt).length;
  return { unread, proposals: proposals.length, seenAt, markSeen };
}

type Inbox = ReturnType<typeof useInbox>;

export function SimWorkspace({ data }: { data: WorkspaceData }) {
  const router = useRouter();
  const { cfg, status } = data;
  useSoundUnlock();
  const inbox = useInbox(data);
  // Waiting for the auction and the live auction refresh fast, so every team moves on together; the years every 5 seconds.
  const fast = status === "AUCTION" || status === "SETUP";
  useEffect(() => {
    const t = setInterval(() => router.refresh(), fast ? 2000 : 5000);
    return () => clearInterval(t);
  }, [router, fast]);
  // Between the auction and year 1 the messages are on screen, so they count as read.
  const { unread, markSeen } = inbox;
  useEffect(() => {
    if (status === "READY" && unread > 0) markSeen();
  }, [status, unread, markSeen]);
  const now = useNow();
  const ended = data.cycleEndsAt !== null && now !== null && now > data.cycleEndsAt;
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(t);
  }, [ended, router]);

  const name = (id: string | null) => {
    if (!id) return "Organisers";
    const v = data.ventures.find((x) => x.id === id);
    return v ? (v.companyName ? `${v.companyName} (${v.teamName})` : v.teamName) : "Unknown";
  };

  if (status === "SETUP") {
    return (
      <Card title={cfg.industry}>
        <p className="mb-4 text-sm text-ink/80">{cfg.tagline}</p>
        <Alert tone="blue">The organisers are preparing the setup auction. Keep this page open; the auction opens here by itself.</Alert>
        <div className="mt-4"><SoundCheck /></div>
      </Card>
    );
  }
  if (status === "AUCTION") return <AuctionScreen data={data} now={now} />;
  if (status === "READY") return <ReadyScreen data={data} name={name} />;
  return <Game data={data} now={now} name={name} inbox={inbox} />;
}

// ---------------- Setup auction ----------------

function AuctionScreen({ data, now }: { data: WorkspaceData; now: number | null }) {
  const { cfg, me, auction } = data;
  const open = auction.find((l) => l.status === "OPEN");
  const won = auction.filter((l) => l.winner?.mine);
  const hasIdentity = won.some((l) => l.kind === "IDENTITY");
  const [state, action, pending] = useActionState(bidOnLot, undefined);
  const minBid = open ? (open.topBid ? open.topBid.amount + cfg.auction.minIncrement : open.reserve) : 0;
  const maxBid = open ? me.wallet - (open.kind === "RESOURCE" && !hasIdentity ? cfg.auction.identityReserve : 0) : 0;
  const left = open?.endsAt && now !== null ? open.endsAt - now : null;
  const blocked = open && open.kind === "IDENTITY" && hasIdentity;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Your budget left" value={money(me.wallet)} sub={`Started with ${money(cfg.startCash)}`} />
        <Kpi label="Identity" value={won.find((l) => l.kind === "IDENTITY")?.name ?? "Not yet"} sub={hasIdentity ? "Won" : `Reserve ${money(cfg.auction.identityReserve)} each`} />
        <Kpi label="Resources won" value={String(won.filter((l) => l.kind === "RESOURCE").length)} sub={won.filter((l) => l.kind === "RESOURCE").map((l) => l.name).join(", ") || "—"} />
      </div>

      <Card title={<span className="inline-flex items-center gap-2"><Gavel className="h-4 w-4" /> Setup auction</span>}>
        {open ? (
          <div className="rounded-2xl border-2 border-sky-300 bg-sky-50/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Badge tone={open.kind === "IDENTITY" ? "blue" : "amber"}>{open.kind === "IDENTITY" ? "Business identity" : "Resource"}</Badge>
                <h2 className="mt-2 text-2xl font-bold text-ink">{open.name}</h2>
                <p className="mt-1 max-w-2xl text-sm text-ink/80">{open.description}</p>
                {open.kind === "IDENTITY" && <RoleFacts cfg={cfg} roleKey={open.key} />}
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">Closes in</div>
                <div className={`font-mono text-3xl font-bold tabular-nums ${left !== null && left < 10_000 ? "text-red-600" : "text-ink"}`}>{left !== null ? clock(left) : "—"}</div>
                <div className="text-xs text-muted">Late bids add {cfg.auction.extendSeconds}s</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Kpi label="Reserve" value={money(open.reserve, false)} />
              <Kpi label="Highest bid" value={open.topBid ? money(open.topBid.amount, false) : "No bids yet"} sub={open.topBid ? (open.topBid.mine ? "That's you" : open.topBid.teamName) : undefined} />
              <Kpi label="Next bid at least" value={money(minBid, false)} sub={`You can bid up to ${money(Math.max(0, maxBid), false)}`} />
            </div>
            {blocked ? (
              <p className="mt-4 text-sm text-muted">You already own an identity, so you cannot bid on this one.</p>
            ) : (
              <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="roundId" value={data.roundId} />
                <input type="hidden" name="lotId" value={open.id} />
                <label className="block">
                  <span className={cls.label}>Your bid (₹)</span>
                  <input key={`${open.id}-${minBid}`} name="amount" type="number" min={minBid} step={cfg.auction.minIncrement} defaultValue={minBid} className={`${cls.input} w-48 text-lg`} />
                </label>
                <Submit pending={pending}>Place bid</Submit>
                <Msg state={state} />
              </form>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Waiting for the organisers to open the next lot. Win exactly one business identity; resources are optional extras that last the whole game.</p>
        )}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={cls.th}>Lot</th><th className={cls.th}>Type</th><th className={cls.th}>Reserve</th><th className={cls.th}>Result</th></tr></thead>
            <tbody>
              {auction.map((l) => (
                <tr key={l.id} className={`border-t border-line ${l.status === "OPEN" ? "bg-sky-50" : ""}`}>
                  <td className={cls.td}><div className="font-medium text-ink">{l.name}</div><div className="text-xs text-muted">{l.description}</div></td>
                  <td className={cls.td}>{l.kind === "IDENTITY" ? "Identity" : "Resource"}</td>
                  <td className={`${cls.td} tabular-nums`}>{money(l.reserve)}</td>
                  <td className={cls.td}>
                    {l.status === "SOLD" && l.winner ? <span className={l.winner.mine ? "font-semibold text-emerald-700" : ""}>{l.winner.mine ? "You" : l.winner.teamName} · {money(l.price ?? 0)}</span>
                      : l.status === "OPEN" ? <Badge tone="blue">Bidding now</Badge>
                      : l.status === "UNSOLD" ? <span className="text-muted">Unsold</span>
                      : <span className="text-muted">Coming up</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">If the auction ends and you have no identity, you are given a leftover one at the reserve price. Money you don&apos;t spend here is your starting cash.</p>
      </Card>
    </div>
  );
}

function RoleFacts({ cfg, roleKey }: { cfg: EconomyConfig; roleKey: string }) {
  const role = roleOf(cfg, roleKey);
  if (!role) return null;
  const buyers = cfg.roles.filter((r) => r.inputs.some((i) => i.role === role.key));
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-ink/70">
      <li>Sells {role.product} at about {money(role.basePrice, false)} each · capacity {role.startCapacity}/year · fixed costs {money(role.fixedCost)}/year</li>
      <li>Buys: {role.inputs.length ? role.inputs.map((i) => `${roleOf(cfg, i.role)?.name} (${i.perUnit} per unit)`).join(", ") : "nothing from other companies"}</li>
      <li>Sells to: customers{buyers.length ? `, ${buyers.map((b) => b.name).join(", ")}` : ""}</li>
    </ul>
  );
}

// ---------------- Between the auction and year 1 ----------------

function ReadyScreen({ data, name }: { data: WorkspaceData; name: (id: string | null) => string }) {
  const { cfg, me } = data;
  const role = roleOf(cfg, me.roleKey);
  return (
    <div className="space-y-6">
      <Card title="Your company">
        {role && me.state ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Identity</div>
              <h2 className="text-2xl font-bold text-ink">{role.name}</h2>
              <p className="mt-1 text-sm text-ink/80">{role.blurb}</p>
              <RoleFacts cfg={cfg} roleKey={role.key} />
              <p className="mt-3 text-sm"><strong>Starting cash:</strong> {money(me.state.cash, false)}</p>
              <p className="text-sm"><strong>Resources:</strong> {me.state.assets.join(", ") || "none"}</p>
            </div>
            <CompanyNameForm roundId={data.roundId} current={me.state.companyName} />
          </div>
        ) : <Alert tone="amber">Your identity is being assigned.</Alert>}
      </Card>
      <Alert tone="blue">Identities are set. Year 1 starts when the organisers open it. Use the time to plan and talk to the other companies.</Alert>
      <Messages data={data} name={name} />
    </div>
  );
}

function CompanyNameForm({ roundId, current }: { roundId: string; current: string }) {
  const [state, action, pending] = useActionState(setCompanyName, undefined);
  return (
    <form action={action} className="rounded-2xl bg-white/70 p-4">
      <input type="hidden" name="roundId" value={roundId} />
      <label className={cls.label} htmlFor="companyName">Company name</label>
      <input id="companyName" name="companyName" defaultValue={current} maxLength={40} placeholder="e.g. VoltWay Mobility" className={cls.input} />
      <p className="mt-1 text-xs text-muted">Shown to every other team and on the awards.</p>
      <div className="mt-3"><Submit pending={pending} variant="secondary">{current ? "Rename" : "Save name"}</Submit></div>
      <Msg state={state} />
    </form>
  );
}

// ---------------- The years ----------------

const TABS = [
  { key: "overview", label: "Overview", icon: ChartIcon },
  { key: "decide", label: "Decisions", icon: Settings2 },
  { key: "deals", label: "Deals & messages", icon: Handshake },
  { key: "market", label: "Market & economy", icon: ChartIcon },
  { key: "fin", label: "Financials", icon: ChartIcon },
] as const;

function Game({ data, now, name, inbox }: { data: WorkspaceData; now: number | null; name: (id: string | null) => string; inbox: Inbox }) {
  const { cfg, status, me } = data;
  const finished = status === "FINISHED";
  const [tab, setTab] = useState<string>(finished ? "results" : "overview");
  // Messages newer than this get a "New" tag. Fixed when the tab opens, so the tags stay while the team reads.
  const [newSince, setNewSince] = useState<number | null>(null);
  const { unread, seenAt, markSeen } = inbox;
  useEffect(() => {
    setNewSince(tab === "deals" ? seenAt : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture once per visit to the tab
  }, [tab]);
  useEffect(() => {
    if (tab === "deals" && unread > 0) markSeen();
  }, [tab, unread, markSeen]);
  const dealsBadge = inbox.unread + inbox.proposals;
  const state = me.state!;
  const role = roleOf(cfg, me.roleKey)!;
  const waiting = data.contracts.filter((c) => c.status === "PROPOSED" && c.proposerId !== me.id && (c.sellerId === me.id || c.buyerId === me.id)).length;
  const left = data.cycleEndsAt !== null && now !== null ? data.cycleEndsAt - now : null;
  const tabs = finished ? [{ key: "results", label: "Results & awards", icon: Trophy }, ...TABS] : [...TABS];

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-4 rounded-2xl px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-ink">{state.companyName || role.name}</div>
          <div className="text-xs text-muted">{state.companyName ? `${role.name} · ` : ""}{finished ? "Simulation finished" : cycleName(cfg, data.currentCycle)}</div>
        </div>
        {!finished && (
          <div className="text-right">
            <div className="text-xs text-muted">{status === "PAUSED" ? "Paused" : status === "PROCESSING" ? "Processing…" : "Decisions close in"}</div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${left !== null && left < 60_000 ? "text-red-600" : "text-ink"}`}>
              {status === "PAUSED" ? clock(data.pausedMs ?? 0) : left !== null ? clock(left) : "—"}
            </div>
          </div>
        )}
        {!finished && <Badge tone={me.decision ? "green" : "amber"}>{me.decision ? `Decision saved ${me.decisionSavedAt ? istTime(me.decisionSavedAt) : ""}` : "No decision yet"}</Badge>}
        {waiting > 0 && <button type="button" onClick={() => setTab("deals")} className={`${cls.btn} ${cls.secondary}`}><Mail className="h-4 w-4" /> {waiting} proposal{waiting === 1 ? "" : "s"} waiting</button>}
      </div>

      <nav className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`${cls.btn} ${tab === t.key ? cls.primary : cls.secondary} relative`}><t.icon className="h-4 w-4" /> {t.label}
            {t.key === "deals" && dealsBadge > 0 && (
              <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white"
                aria-label={`${dealsBadge} new`}>{dealsBadge > 9 ? "9+" : dealsBadge}</span>
            )}</button>
        ))}
      </nav>

      {tab === "results" && finished && <Results data={data} />}
      {tab === "overview" && <Overview data={data} />}
      {tab === "decide" && <Decisions data={data} />}
      {tab === "deals" && <Deals data={data} name={name} newSince={newSince} />}
      {tab === "market" && <MarketTab data={data} />}
      {tab === "fin" && <Financials data={data} />}
    </div>
  );
}

function Overview({ data }: { data: WorkspaceData }) {
  const { cfg, me, history } = data;
  const s = me.state!;
  const role = roleOf(cfg, me.roleKey)!;
  const last = history[history.length - 1];
  const chart = history.map((h) => ({ year: `Y${h.cycle}`, Revenue: Math.round(h.revenue), "Net profit": Math.round(h.profit), Cash: Math.round(h.cash) }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Cash" value={money(s.cash)} />
        <Kpi label="Bank debt" value={money(s.debt)} />
        <Kpi label="Profit to date" value={money(s.cumProfit)} />
        <Kpi label="Revenue to date" value={money(s.cumRevenue)} />
        <Kpi label="Market share (last year)" value={last ? pct(last.marketShare) : "—"} />
        <Kpi label="Capacity" value={`${num(s.capacity)}`} sub={s.pendingCapacity ? `+${s.pendingCapacity} next year` : role.product} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Company health" className="lg:col-span-1">
          <div className="space-y-3">
            <Index label="Technology" value={s.tech} hint="Better product and lower unit costs" />
            <Index label="Brand" value={s.brand} hint="Customers prefer strong brands" />
            <Index label="Customer satisfaction" value={s.customerSat} hint="Repeat business; hurt by stock-outs and high prices" />
            <Index label="Employee satisfaction" value={s.employeeSat} hint="Below 50 cuts effective capacity and raises unit costs" />
            <Index label="Contract reliability" value={s.reliability * 100} hint="Share of contracted units actually delivered" />
          </div>
          <p className="mt-3 text-xs text-muted">50 is the industry standard (the incumbent competitor in every market plays at 50).</p>
        </Card>
        <Card title="Revenue, profit and cash by year" className="lg:col-span-2">
          {chart.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v: number) => money(v)} tick={{ fontSize: 11 }} width={72} />
                  <Tooltip formatter={(v) => money(Number(v), false)} />
                  <Legend />
                  <Line type="monotone" dataKey="Revenue" stroke="#2a78d6" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="Net profit" stroke="#eb6834" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="Cash" stroke="#1f9e6e" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-muted">Results appear after year 1 is processed.</p>}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Your identity: ${role.name}`}>
          <p className="text-sm text-ink/80">{role.blurb}</p>
          <RoleFacts cfg={cfg} roleKey={role.key} />
          <p className="mt-3 text-sm"><strong>Resources owned:</strong> {s.assets.join(", ") || "none"}</p>
          {data.status !== "FINISHED" && <div className="mt-4"><CompanyNameForm roundId={data.roundId} current={s.companyName} /></div>}
        </Card>
        <Card title={last ? `What happened in year ${last.cycle}` : "Notes"}>
          {last ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
              {last.notes.length ? last.notes.map((n, i) => <li key={i}>{n}</li>) : <li>A quiet year: no shortages, penalties or surprises.</li>}
            </ul>
          ) : <p className="text-sm text-muted">Nothing processed yet. Set your year-1 decisions on the Decisions tab.</p>}
        </Card>
      </div>
    </div>
  );
}

function Decisions({ data }: { data: WorkspaceData }) {
  const { cfg, me, economy } = data;
  const s = me.state!;
  const role = roleOf(cfg, me.roleKey)!;
  const pl = economy.priceLevel;
  const owed = data.contracts
    .filter((c) => c.kind === "SUPPLY" && c.sellerId === me.id && c.status === "ACTIVE" && c.startCycle <= data.currentCycle && c.startCycle + c.cycles - 1 >= data.currentCycle)
    .reduce((a, c) => a + (c.units ?? 0), 0);
  const sameRole = data.ventures.filter((v) => v.roleKey === role.key).length;
  const base = useMemo(() => {
    const d = defaultDecision(cfg, role, s.capacity, sameRole, pl);
    return { ...d, production: Math.min(s.capacity, d.production + Math.ceil(owed)) };
  }, [cfg, role, s.capacity, sameRole, pl, owed]);
  const [d, setD] = useState<Decision>(() => ({ ...base, ...(me.decision ?? s.lastDecision ?? {}) }));
  const [state, action, pending] = useActionState(saveDecision, undefined);
  const editable = data.status === "OPEN";
  const ref = leverRef(cfg, role) * pl;
  const set = (k: keyof Decision) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) || 0 });
  const effCap = Math.floor(s.capacity * (0.85 + 0.15 * Math.min(1, s.employeeSat / 50)));
  const spend = leverTotal(d) + d.capacityInvest * role.capexPerUnit * pl;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="roundId" value={data.roundId} />
      {!editable && <Alert tone="amber">{data.status === "PAUSED" ? "The simulation is paused. You can look, but decisions reopen when it resumes." : "The decision window is closed."}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Price and production">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className={cls.label}>Price per unit (₹)</span>
              <input name="price" type="number" min={1} step="any" value={d.price} onChange={set("price")} disabled={!editable} className={cls.input} />
              <span className="text-xs text-muted">Market price now ≈ {money(role.basePrice * pl, false)} per {role.product}</span></label>
            <label className="block"><span className={cls.label}>Production (units)</span>
              <input name="production" type="number" min={0} max={s.capacity} value={d.production} onChange={set("production")} disabled={!editable} className={cls.input} />
              <span className="text-xs text-muted">Capacity {s.capacity}{effCap < s.capacity ? `, staffing allows ${effCap}` : ""}{owed ? ` · you owe ${num(owed, 1)} on contracts` : ""}</span></label>
            <label className="block"><span className={cls.label}>New capacity (units)</span>
              <input name="capacityInvest" type="number" min={0} max={role.startCapacity} value={d.capacityInvest} onChange={set("capacityInvest")} disabled={!editable} className={cls.input} />
              <span className="text-xs text-muted">{money(role.capexPerUnit * pl, false)} per unit, online next year</span></label>
          </div>
        </Card>
        <Card title="Bank">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className={cls.label}>Borrow (₹)</span>
              <input name="borrow" type="number" min={0} step="any" value={d.borrow} onChange={set("borrow")} disabled={!editable} className={cls.input} />
              <span className="text-xs text-muted">Limit {money(cfg.creditLimit - s.debt)} · {economy.interestRate}% a year</span></label>
            <label className="block"><span className={cls.label}>Repay (₹)</span>
              <input name="repay" type="number" min={0} max={s.debt} step="any" value={d.repay} onChange={set("repay")} disabled={!editable} className={cls.input} />
              <span className="text-xs text-muted">Debt {money(s.debt)}</span></label>
          </div>
          <p className="mt-3 text-sm text-ink/80">Planned spending this year: <strong>{money(spend)}</strong> (levers + new capacity) against {money(s.cash)} cash. If cash runs out, an emergency loan is drawn with a {cfg.emergencyFeePct}% fee.</p>
        </Card>
      </div>
      <Card title="Spending levers">
        <p className="mb-4 text-sm text-muted">Industry-standard spend per lever is about {money(ref * DEFAULT_LEVER_SHARE)} a year. Effects build up over years and have diminishing returns.</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {LEVERS.map((l) => (
            <label key={l.key} className="block rounded-xl bg-white/70 p-3">
              <span className={cls.label}>{l.label} (₹)</span>
              <input name={l.key} type="number" min={0} step="any" value={d[l.key]} onChange={set(l.key)} disabled={!editable} className={cls.input} />
              <span className="mt-1 block text-xs text-muted">{l.hint}</span>
            </label>
          ))}
        </div>
      </Card>
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Submit pending={pending}>Save decision for year {data.currentCycle}</Submit>
          <button type="button" onClick={() => setD(base)} className={`${cls.btn} ${cls.secondary}`}>Reset to standard plan</button>
          <Msg state={state} />
        </div>
      )}
    </form>
  );
}

function Deals({ data, name, newSince }: { data: WorkspaceData; name: (id: string | null) => string; newSince: number | null }) {
  const { cfg, me } = data;
  const [respState, respond, respPending] = useActionState(respondContract, undefined);
  const mine = data.contracts.filter((c) => c.sellerId === me.id || c.buyerId === me.id);
  const incoming = mine.filter((c) => c.status === "PROPOSED" && c.proposerId !== me.id);
  const outgoing = mine.filter((c) => c.status === "PROPOSED" && c.proposerId === me.id);
  const signed = mine.filter((c) => c.status === "ACTIVE" || c.status === "COMPLETED");
  const register = data.contracts.filter((c) => (c.status === "ACTIVE" || c.status === "COMPLETED") && c.sellerId !== me.id && c.buyerId !== me.id);
  const describe = (c: WorkspaceData["contracts"][number]) => {
    const k = DEAL_KINDS[c.kind as DealKind] ?? DEAL_KINDS.SUPPLY;
    const seller = data.ventures.find((v) => v.id === c.sellerId);
    const product = roleOf(cfg, seller?.roleKey ?? "")?.product ?? "units";
    const terms =
      c.unitPrice === null ? "terms private"
      : c.kind === "SUPPLY" ? `${num(c.units ?? 0, 1)} ${product}/year at ${money(c.unitPrice, false)}`
      : c.kind === "LOAN" ? `${money(c.unitPrice, false)} at ${c.ratePct}%/year`
      : c.kind === "LICENSE" ? `${money(c.unitPrice, false)}/year fee`
      : `${money(c.unitPrice, false)}/year each`;
    return `${k.label}: ${name(c.sellerId)} (${k.provider.toLowerCase()}) → ${name(c.buyerId)} (${k.receiver.toLowerCase()}) · ${terms} · years ${c.startCycle}–${c.startCycle + c.cycles - 1}`;
  };
  const respondButton = (id: string, act: string, label: string, variant: "primary" | "secondary") => (
    <form action={respond} className="inline">
      <input type="hidden" name="roundId" value={data.roundId} /><input type="hidden" name="contractId" value={id} /><input type="hidden" name="action" value={act} />
      <button type="submit" disabled={respPending} className={`${cls.btn} ${cls[variant]} px-3 py-1 text-xs`}>{label}</button>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Waiting for your answer (${incoming.length})`}>
          {incoming.length === 0 ? <p className="text-sm text-muted">No proposals for you right now.</p> : (
            <ul className="space-y-3">
              {incoming.map((c) => (
                <li key={c.id} className="rounded-xl border border-line bg-white/70 p-3 text-sm">
                  <div className="text-ink">{describe(c)}</div>
                  {c.note && <div className="mt-1 text-xs text-muted">“{c.note}”</div>}
                  <div className="mt-2 flex gap-2">{respondButton(c.id, "accept", "Accept", "primary")}{respondButton(c.id, "reject", "Decline", "secondary")}</div>
                </li>
              ))}
            </ul>
          )}
          {outgoing.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-ink">Your open proposals</h3>
              <ul className="mt-2 space-y-2">
                {outgoing.map((c) => <li key={c.id} className="flex items-start justify-between gap-2 text-sm"><span>{describe(c)}</span>{respondButton(c.id, "withdraw", "Withdraw", "secondary")}</li>)}
              </ul>
            </>
          )}
          <Msg state={respState} />
        </Card>
        <ProposeDeal data={data} />
      </div>
      <Card title={`Your signed deals (${signed.length})`}>
        {signed.length === 0 ? <p className="text-sm text-muted">No deals yet.</p> : (
          <ul className="space-y-2 text-sm">
            {signed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <span>{describe(c)}</span>
                <span className="flex gap-2">
                  {c.kind === "SUPPLY" && c.delivered !== null && <Badge tone={c.shortfall ? "amber" : "green"}>{num(c.delivered, 1)} delivered{c.shortfall ? `, ${num(c.shortfall, 1)} short` : ""}</Badge>}
                  <Badge tone={c.status === "ACTIVE" ? "blue" : "gray"}>{c.status.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Messages data={data} name={name} newSince={newSince} />
        <Card title="Public deal register">
          <p className="mb-2 text-xs text-muted">Everyone can see who has a deal with whom. Terms stay private to the two companies.</p>
          {register.length === 0 ? <p className="text-sm text-muted">No other deals yet.</p> : <ul className="space-y-1 text-sm">{register.map((c) => <li key={c.id}>{describe(c)}</li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}

function ProposeDeal({ data }: { data: WorkspaceData }) {
  const { cfg, me, economy } = data;
  const [state, action, pending] = useActionState(proposeContract, undefined);
  const [kind, setKind] = useState<DealKind>("SUPPLY");
  const [other, setOther] = useState("");
  const [direction, setDirection] = useState("provide");
  const others = data.ventures.filter((v) => !v.isMe);
  const o = others.find((v) => v.id === other);
  const k = DEAL_KINDS[kind];
  const remaining = cfg.cycles - data.currentCycle + 1;
  const supplyOk = o && (direction === "provide" ? inputNeed(cfg, me.roleKey, o.roleKey) : inputNeed(cfg, o.roleKey, me.roleKey));
  const sellerRole = o ? (direction === "provide" ? me.roleKey : o.roleKey) : me.roleKey;
  const running = data.status === "OPEN" || data.status === "PAUSED";
  return (
    <Card title="Propose a deal">
      {!running ? <p className="text-sm text-muted">Deals can be proposed while the simulation is running.</p> : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="roundId" value={data.roundId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={cls.label}>Deal type</span>
              <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as DealKind)} className={cls.input}>
                {(Object.keys(DEAL_KINDS) as DealKind[]).map((key) => <option key={key} value={key}>{DEAL_KINDS[key].label}</option>)}
              </select></label>
            <label className="block"><span className={cls.label}>With</span>
              <select name="counterpartyId" value={other} onChange={(e) => setOther(e.target.value)} className={cls.input} required>
                <option value="">Choose a company…</option>
                {others.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.teamName} · {roleOf(cfg, v.roleKey)?.name}</option>)}
              </select></label>
          </div>
          <p className="text-xs text-muted">{k.blurb}</p>
          {kind !== "MARKETING" && (
            <label className="block"><span className={cls.label}>Who is the {k.provider.toLowerCase()}?</span>
              <select name="direction" value={direction} onChange={(e) => setDirection(e.target.value)} className={cls.input}>
                <option value="provide">We are the {k.provider.toLowerCase()}</option>
                <option value="receive">They are the {k.provider.toLowerCase()}</option>
              </select></label>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {kind === "SUPPLY" && (
              <label className="block"><span className={cls.label}>Units per year</span><input name="units" type="number" min={0.1} step={0.1} className={cls.input} required /></label>
            )}
            <label className="block"><span className={cls.label}>{kind === "SUPPLY" ? "Price per unit (₹)" : kind === "LOAN" ? "Loan amount (₹)" : kind === "LICENSE" ? "Yearly fee (₹)" : "Each pays per year (₹)"}</span>
              <input name="amount" type="number" min={1} className={cls.input} required />
              {kind === "SUPPLY" && o && <span className="text-xs text-muted">Outside suppliers charge {money(spotPrice(cfg, sellerRole, 1, economy.priceLevel), false)}</span>}</label>
            {kind === "LOAN" && <label className="block"><span className={cls.label}>Interest (% a year)</span><input name="ratePct" type="number" min={0} max={30} step={0.5} defaultValue={economy.interestRate} className={cls.input} /></label>}
            <label className="block"><span className={cls.label}>Years</span><input name="cycles" type="number" min={1} max={remaining} defaultValue={Math.min(3, remaining)} className={cls.input} /></label>
          </div>
          {kind === "SUPPLY" && o && !supplyOk && <p className="text-xs text-amber-700">These two businesses have no supply relationship in that direction. Try the other direction or another deal type.</p>}
          <label className="block"><span className={cls.label}>Note (optional)</span><input name="note" maxLength={300} className={cls.input} /></label>
          <Submit pending={pending}>Send proposal</Submit>
          <Msg state={state} />
        </form>
      )}
    </Card>
  );
}

function Messages({ data, name, newSince = null }: { data: WorkspaceData; name: (id: string | null) => string; newSince?: number | null }) {
  const [thread, setThread] = useState<string>("all");
  const [state, action, pending] = useActionState(sendSimMessage, undefined);
  const me = data.me.id;
  const list = data.messages.filter((m) =>
    thread === "all" ? true : thread === "public" ? m.toId === null : (m.fromId === thread && m.toId === me) || (m.fromId === me && m.toId === thread),
  );
  const direct = thread !== "all" && thread !== "public";
  return (
    <Card title="Messages">
      <div className="mb-3 flex flex-wrap gap-2">
        <select value={thread} onChange={(e) => setThread(e.target.value)} className={`${cls.input} w-auto`} aria-label="Conversation">
          <option value="all">Everything</option>
          <option value="public">Public channel</option>
          {data.ventures.filter((v) => !v.isMe).map((v) => <option key={v.id} value={v.id}>{v.companyName || v.teamName}</option>)}
        </select>
      </div>
      <ul className="max-h-80 space-y-2 overflow-y-auto pr-1 text-sm">
        {list.length === 0 && <li className="text-muted">No messages.</li>}
        {[...list].reverse().map((m) => (
          <li key={m.id} className={`rounded-xl px-3 py-2 ${m.kind === "SYSTEM" ? "bg-sky-50" : m.kind === "INTEL" ? "bg-amber-50" : m.fromId === me ? "bg-emerald-50" : "bg-white/80"}`}>
            <div className="text-xs text-muted">{m.kind === "INTEL" ? "Research report" : name(m.fromId)}{m.toId === null ? " → everyone" : m.toId === me ? "" : ` → ${name(m.toId)}`} · {istTime(m.at)}
              {newSince !== null && m.at > newSince && m.fromId !== me && m.kind !== "INTEL" && <span className="ml-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">New</span>}</div>
            <div className="whitespace-pre-line text-ink">{m.body}</div>
          </li>
        ))}
      </ul>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="roundId" value={data.roundId} />
        <input type="hidden" name="toId" value={direct ? thread : ""} />
        <input name="body" maxLength={1000} placeholder={direct ? `Message ${name(thread)}` : "Message everyone"} className={`${cls.input} flex-1`} aria-label="Message" />
        <Submit pending={pending} variant="secondary">Send</Submit>
      </form>
      <Msg state={state} />
    </Card>
  );
}

function MarketTab({ data }: { data: WorkspaceData }) {
  const { cfg, economy } = data;
  const [state, action, pending] = useActionState(buyResearch, undefined);
  const latest = data.marketHistory[data.marketHistory.length - 1];
  return (
    <div className="space-y-6">
      <Card title="The economy">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="GDP growth" value={`${economy.gdpGrowth}%`} sub="Grows market size next year" />
          <Kpi label="Inflation" value={`${economy.inflation}%`} sub={`Prices ${((economy.priceLevel - 1) * 100).toFixed(1)}% above year 1`} />
          <Kpi label="Interest rate" value={`${economy.interestRate}%`} sub="On bank debt, per year" />
          <Kpi label="Corporate tax" value={`${economy.taxRate}%`} sub="On profit; losses carry forward" />
          <Kpi label="Consumer confidence" value={economy.confidence.toFixed(2)} sub="1.00 = normal" />
          <Kpi label="EV adoption" value={economy.adoption.toFixed(2)} sub="Grows when the ecosystem serves customers" />
        </div>
        {data.events.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-ink">Headlines</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {[...data.events].reverse().map((e) => <li key={e.id}><Badge tone="amber">Year {e.cycle}</Badge> <strong>{e.title}.</strong> <span className="text-ink/80">{e.description}</span></li>)}
            </ul>
          </div>
        )}
      </Card>
      <Card title="Companies">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={cls.th}>Company</th><th className={cls.th}>Identity</th><th className={cls.th}>Price</th><th className={cls.th}>Sales</th><th className={cls.th}>Market share</th><th className={cls.th}>Brand</th><th className={cls.th}>Resources</th></tr></thead>
            <tbody>
              {data.ventures.map((v) => (
                <tr key={v.id} className={`border-t border-line ${v.isMe ? "bg-sky-50/60" : ""}`}>
                  <td className={cls.td}><div className="font-medium text-ink">{v.companyName || v.teamName}</div>{v.companyName && <div className="text-xs text-muted">{v.teamName}</div>}</td>
                  <td className={cls.td}>{roleOf(cfg, v.roleKey)?.name}</td>
                  <td className={`${cls.td} tabular-nums`}>{v.last ? money(v.last.price, false) : "—"}</td>
                  <td className={`${cls.td} tabular-nums`}>{v.last ? num(v.last.endSales) : "—"}</td>
                  <td className={`${cls.td} tabular-nums`}>{v.last ? pct(v.last.marketShare) : "—"}</td>
                  <td className={`${cls.td} tabular-nums`}>{v.last ? Math.round(v.last.brand) : "—"}</td>
                  <td className={`${cls.td} text-xs`}>{v.assets.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data.status === "OPEN" || data.status === "PAUSED") && (
          <form action={action} className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="roundId" value={data.roundId} />
            <label className="block"><span className={cls.label}>Buy a research report ({money(cfg.researchCost, false)})</span>
              <select name="targetId" className={cls.input} required defaultValue="">
                <option value="" disabled>Choose a company…</option>
                {data.ventures.filter((v) => !v.isMe).map((v) => <option key={v.id} value={v.id}>{v.companyName || v.teamName}</option>)}
              </select></label>
            <Submit pending={pending} variant="secondary">Buy report</Submit>
            <Msg state={state} />
          </form>
        )}
        <p className="mt-2 text-xs text-muted">Reports estimate a company&apos;s finances, spending and indices (±8%) and arrive in your messages.</p>
      </Card>
      {latest && (
        <Card title={`Markets in year ${latest.cycle}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className={cls.th}>Market</th><th className={cls.th}>Total demand</th><th className={cls.th}>Teams sold</th><th className={cls.th}>Incumbents sold</th><th className={cls.th}>Avg team price</th><th className={cls.th}>Outside supplier price</th></tr></thead>
              <tbody>
                {cfg.roles.filter((r) => latest.roles[r.key]?.ventures).map((r) => {
                  const m = latest.roles[r.key];
                  return (
                    <tr key={r.key} className="border-t border-line">
                      <td className={cls.td}>{r.name}</td><td className={`${cls.td} tabular-nums`}>{num(m.demand)}</td><td className={`${cls.td} tabular-nums`}>{num(m.teamSales)}</td>
                      <td className={`${cls.td} tabular-nums`}>{num(m.incumbentSales)}</td><td className={`${cls.td} tabular-nums`}>{money(m.avgPrice, false)}</td><td className={`${cls.td} tabular-nums`}>{money(m.spotPrice, false)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Every market also has a simulated incumbent competitor that plays at the industry standard.</p>
        </Card>
      )}
    </div>
  );
}

function Financials({ data }: { data: WorkspaceData }) {
  const h = data.history;
  if (!h.length) return <Card title="Financial statements"><p className="text-sm text-muted">Statements appear after year 1 is processed.</p></Card>;
  const rows: [string, (r: VentureResult) => number, "units" | "pct" | "money"][] = [
    ["Units sold to customers", (r) => r.endSales, "units"],
    ["Units delivered on contracts", (r) => r.contractSales, "units"],
    ["Revenue", (r) => r.revenue, "money"],
    ["Production costs", (r) => -r.costs.production, "money"],
    ["Inputs (contracts)", (r) => -r.costs.contractInputs, "money"],
    ["Inputs (outside suppliers)", (r) => -r.costs.spotInputs, "money"],
    ["Fixed costs", (r) => -r.costs.fixed, "money"],
    ["Spending levers", (r) => -r.costs.levers, "money"],
    ["Deals paid (fees, loan interest)", (r) => -r.costs.deals, "money"],
    ["Deal income", (r) => r.dealIncome, "money"],
    ["Bank interest", (r) => -r.costs.interest, "money"],
    ["Penalties received − paid", (r) => r.penaltyIncome - r.costs.penalties, "money"],
    ["Holding & research", (r) => -(r.costs.holding + r.costs.research), "money"],
    ["Profit before tax", (r) => r.profitBeforeTax, "money"],
    ["Tax", (r) => -r.tax, "money"],
    ["Net profit", (r) => r.profit, "money"],
    ["Capacity investment", (r) => -r.capex, "money"],
    ["Cash at year end", (r) => r.cash, "money"],
    ["Bank debt at year end", (r) => r.debt, "money"],
    ["Market share", (r) => r.marketShare, "pct"],
  ];
  return (
    <Card title="Financial statements">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className={cls.th}></th>{h.map((r) => <th key={r.cycle} className={`${cls.th} text-right`}>Year {r.cycle}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, f, kind]) => (
              <tr key={label} className={`border-t border-line ${/^(Net profit|Revenue|Profit before)/.test(label) ? "font-semibold" : ""}`}>
                <td className={cls.td}>{label}</td>
                {h.map((r) => <td key={r.cycle} className={`${cls.td} text-right tabular-nums`}>{kind === "pct" ? pct(f(r)) : kind === "units" ? num(f(r), 1) : money(f(r))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Results({ data }: { data: WorkspaceData }) {
  const f = data.final;
  if (!f) return null;
  const meId = data.me.id;
  return (
    <div className="space-y-6">
      <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /> Awards</span>}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {f.awards.map((a) => {
            const won = a.winners.some((w) => w.ventureId === meId);
            return (
              <div key={a.title} className={`rounded-2xl p-4 shadow-soft ${won ? "bg-amber-50 ring-2 ring-amber-400" : "bg-white/80"}`}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><AwardIcon className="h-4 w-4" /> {a.title}</div>
                <div className="mt-1 text-lg font-bold text-ink">{a.winners.map((w) => w.name).join(" & ")}</div>
                <div className="text-sm text-muted">{a.label}</div>
                {won && <div className="mt-1 text-sm font-semibold text-amber-700">That&apos;s you!</div>}
              </div>
            );
          })}
        </div>
      </Card>
      {f.mine && (
        <Card title="Your final numbers">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Net profit" value={money(f.mine.cumProfit)} />
            <Kpi label="Revenue" value={money(f.mine.cumRevenue)} />
            <Kpi label="Average market share" value={pct(f.mine.avgMarketShare)} />
            <Kpi label="Return on equity" value={pct(f.mine.roe)} />
          </div>
          {data.finalMarks !== null && <p className="mt-3 text-sm"><strong>Round marks:</strong> {data.finalMarks} / {data.maxMarks}</p>}
        </Card>
      )}
      <Card title="Final standings">
        {!f.table ? <p className="text-sm text-muted">The full standings and marks appear once the organisers publish results.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className={cls.th}>#</th><th className={cls.th}>Company</th><th className={cls.th}>Net profit</th><th className={cls.th}>Revenue</th><th className={cls.th}>Avg share</th><th className={cls.th}>ROE</th><th className={cls.th}>Cust / Emp sat</th><th className={cls.th}>Marks</th></tr></thead>
              <tbody>
                {f.table.map((m, i) => (
                  <tr key={m.ventureId} className={`border-t border-line ${m.ventureId === meId ? "bg-sky-50/60 font-semibold" : ""}`}>
                    <td className={cls.td}>{i + 1}</td><td className={cls.td}>{m.companyName || m.teamName}</td><td className={`${cls.td} tabular-nums`}>{money(m.cumProfit)}</td>
                    <td className={`${cls.td} tabular-nums`}>{money(m.cumRevenue)}</td><td className={`${cls.td} tabular-nums`}>{pct(m.avgMarketShare)}</td><td className={`${cls.td} tabular-nums`}>{pct(m.roe)}</td>
                    <td className={`${cls.td} tabular-nums`}>{Math.round(m.customerSat)} / {Math.round(m.employeeSat)}</td><td className={`${cls.td} tabular-nums`}>{m.marks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
