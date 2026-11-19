import { db, parseJson } from "@/lib/db";
import { parseConfig, type Decision, type MarketState, type VentureResult } from "@/lib/sim/model";
import { maybeAdvance, ventureState } from "@/lib/sim/service";
import { Alert, Card } from "@/components/ui";
import { SimWorkspace, type WorkspaceData } from "./sim-workspace";

/** Loads only what this team is allowed to see (information asymmetry is enforced here, server-side). */
export async function SimView({ roundId, teamId, resultsPublished }: { roundId: string; teamId: string; resultsPublished: boolean }) {
  const econ0 = await db.simEconomy.findUnique({ where: { roundId } });
  if (!econ0) return <Alert tone="amber">The organisers have not set up this simulation yet.</Alert>;
  await maybeAdvance(econ0.id);
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: econ0.id }, include: { ventures: { include: { team: true } } } });
  const cfg = parseConfig(econ.config);
  const me = econ.ventures.find((v) => v.teamId === teamId);
  if (!me) {
    return (
      <Card title={cfg.industry}>
        <p className="text-sm text-muted">{cfg.tagline}</p>
        <div className="mt-4"><Alert tone="amber">Your team has not been assigned a startup yet. Assignments appear here before the simulation opens.</Alert></div>
      </Card>
    );
  }

  const visibleCycle = econ.status === "FINISHED" ? cfg.cycles : econ.currentCycle;
  const [snapshots, decision, events, contracts, messages, attempt] = await Promise.all([
    db.simSnapshot.findMany({ where: { economyId: econ.id }, orderBy: { cycle: "asc" } }),
    econ.currentCycle > 0 ? db.simDecision.findUnique({ where: { ventureId_cycle: { ventureId: me.id, cycle: econ.currentCycle } } }) : null,
    db.simEvent.findMany({ where: { economyId: econ.id, cycle: { lte: visibleCycle } }, orderBy: [{ cycle: "asc" }, { createdAt: "asc" }] }),
    db.simContract.findMany({ where: { economyId: econ.id }, orderBy: { createdAt: "desc" } }),
    db.simMessage.findMany({ where: { economyId: econ.id, OR: [{ toId: null }, { toId: me.id }, { fromId: me.id }] }, orderBy: { createdAt: "asc" }, take: 400 }),
    resultsPublished ? db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId } } }) : null,
  ]);

  const lastByVenture = new Map<string, VentureResult>();
  const history: VentureResult[] = [];
  const marketHistory: MarketState[] = [];
  for (const s of snapshots) {
    if (s.ventureId === "MARKET") marketHistory.push(parseJson<MarketState>(s.data, {} as MarketState));
    else {
      const r = parseJson<VentureResult>(s.data, {} as VentureResult);
      lastByVenture.set(s.ventureId, r);
      if (s.ventureId === me.id) history.push(r);
    }
  }

  const mine = (c: (typeof contracts)[number]) => c.sellerId === me.id || c.buyerId === me.id;
  const data: WorkspaceData = {
    roundId,
    // Future scheduled events and the event library stay on the server.
    cfg: { ...cfg, scheduledEvents: [], eventLibrary: [] },
    status: econ.status,
    currentCycle: econ.currentCycle,
    cycleEndsAt: econ.cycleEndsAt?.getTime() ?? null,
    pausedMs: econ.pausedMs,
    me: {
      id: me.id,
      roleKey: me.roleKey,
      state: ventureState(me.state)!,
      decision: decision ? parseJson<Decision | null>(decision.data, null) : null,
      decisionSavedAt: decision?.updatedAt.getTime() ?? null,
    },
    history,
    marketHistory,
    ventures: econ.ventures.map((v) => {
      const last = lastByVenture.get(v.id);
      return {
        id: v.id,
        teamName: v.team.name,
        roleKey: v.roleKey,
        isMe: v.id === me.id,
        last: last ? { price: last.price, endSales: last.endSales, marketShare: last.marketShare, brand: last.brand } : null,
      };
    }),
    events: events.map((e) => ({ id: e.id, cycle: e.cycle, title: e.title, description: e.description })),
    contracts: contracts
      .filter((c) => mine(c) || c.status === "ACTIVE" || c.status === "COMPLETED")
      .map((c) => ({
        id: c.id, sellerId: c.sellerId, buyerId: c.buyerId, proposerId: c.proposerId, units: c.units,
        unitPrice: mine(c) ? c.unitPrice : null, // other teams' prices are private
        startCycle: c.startCycle, cycles: c.cycles, status: c.status, note: mine(c) ? c.note : "",
        delivered: mine(c) ? c.delivered : null, shortfall: mine(c) ? c.shortfall : null,
      })),
    messages: messages.map((m) => ({ id: m.id, fromId: m.fromId, toId: m.toId, body: m.body, kind: m.kind, at: m.createdAt.getTime() })),
    finalMarks: attempt?.autoScore ?? null,
    maxMarks: cfg.scoring.maxMarks,
  };
  return <SimWorkspace data={data} />;
}
