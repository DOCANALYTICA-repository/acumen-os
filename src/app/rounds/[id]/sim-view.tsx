import { db, parseJson } from "@/lib/db";
import { parseConfig, type Decision, type MarketState, type VentureResult } from "@/lib/sim/model";
import { auctionWallet, finalStandings, marketState, maybeAdvance, ventureState } from "@/lib/sim/service";
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
        <div className="mt-4"><Alert tone="amber">Your team has not joined this economy yet. The organisers add every eligible team before the setup auction.</Alert></div>
      </Card>
    );
  }

  const visibleCycle = econ.status === "FINISHED" ? cfg.cycles : econ.currentCycle;
  const [snapshots, decision, events, contracts, messages, attempt, lots] = await Promise.all([
    db.simSnapshot.findMany({ where: { economyId: econ.id }, orderBy: { cycle: "asc" } }),
    econ.currentCycle > 0 ? db.simDecision.findUnique({ where: { ventureId_cycle: { ventureId: me.id, cycle: econ.currentCycle } } }) : null,
    db.simEvent.findMany({ where: { economyId: econ.id, cycle: { lte: visibleCycle } }, orderBy: [{ cycle: "asc" }, { createdAt: "asc" }] }),
    db.simContract.findMany({ where: { economyId: econ.id }, orderBy: { createdAt: "desc" } }),
    db.simMessage.findMany({ where: { economyId: econ.id, OR: [{ toId: null }, { toId: me.id }, { fromId: me.id }] }, orderBy: { createdAt: "asc" }, take: 400 }),
    resultsPublished ? db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId } } }) : null,
    db.simAuctionLot.findMany({ where: { economyId: econ.id }, orderBy: { order: "asc" }, include: { bids: { orderBy: [{ amount: "desc" }, { createdAt: "asc" }], take: 1 } } }),
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
  const teamName = new Map(econ.ventures.map((v) => [v.id, v.team.name]));
  const mine = (c: (typeof contracts)[number]) => c.sellerId === me.id || c.buyerId === me.id;
  const state = ventureState(me.state);
  const standings = econ.status === "FINISHED" ? await finalStandings(econ.id) : null;

  const data: WorkspaceData = {
    roundId,
    // Future scheduled events and the event library stay on the server.
    cfg: { ...cfg, scheduledEvents: [], eventLibrary: [] },
    status: econ.status,
    currentCycle: econ.currentCycle,
    cycleEndsAt: econ.cycleEndsAt?.getTime() ?? null,
    pausedMs: econ.pausedMs,
    economy: marketState(econ.market, cfg),
    me: {
      id: me.id,
      roleKey: me.roleKey,
      state,
      wallet: state ? state.cash : auctionWallet(me.state),
      decision: decision ? parseJson<Decision | null>(decision.data, null) : null,
      decisionSavedAt: decision?.updatedAt.getTime() ?? null,
    },
    history,
    marketHistory,
    ventures: econ.ventures.map((v) => {
      const last = lastByVenture.get(v.id);
      const st = ventureState(v.state);
      return {
        id: v.id,
        teamName: v.team.name,
        companyName: st?.companyName ?? "",
        roleKey: v.roleKey,
        assets: st?.assets ?? [],
        isMe: v.id === me.id,
        // Public information only: what customers can see in the market.
        last: last ? { price: last.price, endSales: last.endSales, marketShare: last.marketShare, brand: last.brand, customerSat: last.customerSat } : null,
      };
    }),
    auction: lots.map((l) => ({
      id: l.id, order: l.order, kind: l.kind as "IDENTITY" | "RESOURCE", key: l.key, name: l.name, description: l.description, reserve: l.reserve,
      status: l.status, endsAt: l.endsAt?.getTime() ?? null,
      topBid: l.bids[0] ? { amount: l.bids[0].amount, teamName: teamName.get(l.bids[0].ventureId) ?? "", mine: l.bids[0].ventureId === me.id } : null,
      winner: l.winnerId ? { teamName: teamName.get(l.winnerId) ?? "", mine: l.winnerId === me.id } : null,
      price: l.price,
    })),
    events: events.map((e) => ({ id: e.id, cycle: e.cycle, title: e.title, description: e.description })),
    contracts: contracts
      .filter((c) => mine(c) || c.status === "ACTIVE" || c.status === "COMPLETED")
      .map((c) => ({
        id: c.id, kind: c.kind, sellerId: c.sellerId, buyerId: c.buyerId, proposerId: c.proposerId,
        units: mine(c) ? c.units : null,
        unitPrice: mine(c) ? c.unitPrice : null, // other teams' terms are private
        ratePct: mine(c) ? c.ratePct : null,
        startCycle: c.startCycle, cycles: c.cycles, status: c.status, note: mine(c) ? c.note : "",
        delivered: mine(c) ? c.delivered : null, shortfall: mine(c) ? c.shortfall : null,
      })),
    messages: messages.map((m) => ({ id: m.id, fromId: m.fromId, toId: m.toId, body: m.body, kind: m.kind, at: m.createdAt.getTime() })),
    final: standings
      ? {
          awards: standings.awards,
          // The full table (with marks) only once results are published; awards are announced straight away.
          table: resultsPublished
            ? standings.metrics.map((m) => ({ ...m, marks: standings.scores.find((s) => s.id === m.ventureId)?.marks ?? 0 })).sort((a, b) => b.marks - a.marks)
            : null,
          mine: standings.metrics.find((m) => m.ventureId === me.id) ?? null,
        }
      : null,
    finalMarks: attempt?.autoScore ?? null,
    maxMarks: cfg.scoring.maxMarks,
  };
  return <SimWorkspace data={data} />;
}
