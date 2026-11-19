// Deterministic economy engine. Pure functions only: same inputs → same outputs.
// The server is the only caller that persists results; the browser never computes outcomes.

import {
  defaultDecision,
  roleOf,
  segmentScale,
  spotPrice,
  type Decision,
  type EconomyConfig,
  type EventEffects,
  type MarketState,
  type RoleDef,
  type VentureResult,
  type VentureState,
} from "./model";

export type EngineVenture = { id: string; roleKey: string; state: VentureState };
export type EngineContract = { id: string; sellerId: string; buyerId: string; units: number; unitPrice: number };
export type CycleInput = {
  cfg: EconomyConfig;
  cycle: number;
  market: MarketState;
  ventures: EngineVenture[];
  decisions: Record<string, Decision | undefined>;
  contracts: EngineContract[]; // contracts active in this cycle
  effects: EventEffects[]; // events applied in this cycle
};
export type CycleOutput = {
  market: MarketState;
  states: Record<string, VentureState>;
  results: Record<string, VentureResult>;
  contracts: Record<string, { delivered: number; shortfall: number }>;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

export function initialMarket(cfg: EconomyConfig): MarketState {
  return { cycle: 0, adoption: 1, interestRate: cfg.interestRate, roles: {} };
}

export function equityOf(role: RoleDef, s: Pick<VentureState, "cash" | "debt" | "capacity" | "pendingCapacity" | "inventory">) {
  return s.cash + (s.capacity + s.pendingCapacity) * role.capexPerUnit * 0.5 + s.inventory * role.unitCost - s.debt;
}

export function initialState(cfg: EconomyConfig, role: RoleDef): VentureState {
  const base = { cash: cfg.startCash, debt: 0, capacity: role.startCapacity, pendingCapacity: 0, inventory: 0 };
  return { ...base, quality: 1, brand: 1, reliability: 1, cumProfit: 0, startEquity: equityOf(role, base), pendingCharges: 0, lastDecision: null, distress: 0 };
}

/** Clamp a submitted decision to what the rules allow. */
export function sanitizeDecision(cfg: EconomyConfig, role: RoleDef, state: VentureState, d: Partial<Decision>): Decision {
  const f = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    price: r2(clamp(f(d.price) || role.basePrice, role.basePrice * cfg.minPriceFactor, role.basePrice * cfg.maxPriceFactor)),
    production: Math.round(clamp(f(d.production), 0, state.capacity)),
    capacityInvest: Math.round(clamp(f(d.capacityInvest), 0, role.startCapacity)),
    marketing: Math.round(clamp(f(d.marketing), 0, 500_000)),
    quality: Math.round(clamp(f(d.quality), 0, 500_000)),
    borrow: Math.round(clamp(f(d.borrow), 0, Math.max(0, cfg.creditLimit - state.debt))),
    repay: Math.round(clamp(f(d.repay), 0, state.debt)),
  };
}

function combine(effects: EventEffects[], field: "demand" | "spot" | "cost", key: string) {
  return effects.reduce((m, e) => m * (e[field]?.[key] ?? 1) * (e[field]?.["*"] ?? 1), 1);
}

function attraction(cfg: EconomyConfig, role: RoleDef, price: number, s: VentureState, marketing: number) {
  return Math.pow(price / role.basePrice, -role.elasticity) * Math.pow(s.quality, 0.7) * s.brand * (1 + 0.25 * Math.log(1 + marketing / cfg.marketingRef));
}

export function processCycle(input: CycleInput): CycleOutput {
  const { cfg, cycle, market, ventures, contracts, effects } = input;
  const rate = market.interestRate + effects.reduce((s, e) => s + (e.interestDelta ?? 0), 0);
  const adoptionBase = clamp(market.adoption + effects.reduce((s, e) => s + (e.adoptionDelta ?? 0), 0), 0.5, 2);
  const byRole: Record<string, EngineVenture[]> = {};
  for (const v of ventures) (byRole[v.roleKey] ??= []).push(v);

  // ---- resolve decisions ----
  type Work = {
    v: EngineVenture; role: RoleDef; d: Decision; carried: boolean; produced: number; available: number;
    contracted: number; deliveredOut: number; contractRevenue: number; contractInputCost: number; penaltiesPaid: number; penaltyIncome: number;
    demand: number; endSales: number; notes: string[];
  };
  const owedBy: Record<string, number> = {};
  for (const c of contracts) owedBy[c.sellerId] = (owedBy[c.sellerId] ?? 0) + c.units;
  const work: Record<string, Work> = {};
  for (const v of ventures) {
    const role = roleOf(cfg, v.roleKey);
    if (!role) continue;
    const submitted = input.decisions[v.id];
    const carried = !submitted;
    let raw = submitted ?? v.state.lastDecision;
    if (!raw) {
      // Never-decided startups get a sensible plan that also covers what they owe on contracts.
      const base = defaultDecision(role, v.state.capacity, byRole[v.roleKey]?.length ?? 1);
      raw = { ...base, production: Math.min(v.state.capacity, base.production + Math.ceil(owedBy[v.id] ?? 0)) };
    }
    const d = sanitizeDecision(cfg, role, v.state, carried ? { ...raw, capacityInvest: 0, borrow: 0, repay: 0 } : raw);
    const produced = d.production;
    work[v.id] = {
      v, role, d, carried, produced, available: v.state.inventory + produced, contracted: 0, deliveredOut: 0, contractRevenue: 0,
      contractInputCost: 0, penaltiesPaid: 0, penaltyIncome: 0, demand: 0, endSales: 0, notes: carried ? ["No decision submitted: last cycle's plan was carried forward (no new investment or borrowing)."] : [],
    };
  }

  // ---- contract deliveries (sellers fill contracts before the open market) ----
  const live = contracts.filter((c) => work[c.sellerId] && work[c.buyerId]);
  for (const c of live) work[c.sellerId].contracted += c.units;
  const fillRate: Record<string, number> = {};
  for (const w of Object.values(work)) fillRate[w.v.id] = w.contracted > 0 ? Math.min(1, w.available / w.contracted) : 1;
  const contractOut: CycleOutput["contracts"] = {};
  const receivedByBuyer: Record<string, Record<string, number>> = {};
  for (const c of live) {
    const seller = work[c.sellerId], buyer = work[c.buyerId];
    const delivered = r2(c.units * fillRate[c.sellerId]);
    const shortfall = r2(c.units - delivered);
    const penalty = shortfall * c.unitPrice * (cfg.contractPenaltyPct / 100);
    seller.deliveredOut += delivered;
    seller.contractRevenue += delivered * c.unitPrice;
    seller.penaltiesPaid += penalty;
    buyer.contractInputCost += delivered * c.unitPrice;
    buyer.penaltyIncome += penalty;
    const got = (receivedByBuyer[c.buyerId] ??= {});
    got[seller.v.roleKey] = (got[seller.v.roleKey] ?? 0) + delivered;
    contractOut[c.id] = { delivered, shortfall };
    if (shortfall > 0) {
      seller.notes.push(`Delivered ${delivered} of ${c.units} contracted ${seller.role.product}; paid a ${cfg.contractPenaltyPct}% penalty on the shortfall.`);
      buyer.notes.push(`A supplier delivered only ${delivered} of ${c.units} ${seller.role.product}; the gap was bought on the spot market.`);
    }
  }
  for (const w of Object.values(work)) w.available -= w.deliveredOut;

  // ---- end markets ----
  const roleMarket: MarketState["roles"] = {};
  for (const role of cfg.roles) {
    const vs = (byRole[role.key] ?? []).filter((v) => work[v.id]);
    const n = vs.length;
    const spot = spotPrice(cfg, role.key, combine(effects, "spot", role.key));
    if (!n) {
      roleMarket[role.key] = { demand: 0, sales: 0, avgPrice: role.basePrice, output: 0, spotPrice: spot, ventures: 0 };
      continue;
    }
    let driver = 1;
    if (role.drivers.length && market.cycle > 0) {
      const tw = role.drivers.reduce((s, d) => s + d.weight, 0) || 1;
      driver = role.drivers.reduce((s, d) => {
        const prev = market.roles[d.role];
        const dRole = roleOf(cfg, d.role);
        const ratio = prev && prev.ventures > 0 && dRole ? clamp(prev.output / (dRole.refDemand * segmentScale(prev.ventures)), 0.5, 1.5) : 1;
        return s + ratio * d.weight;
      }, 0) / tw;
    }
    const D = role.refDemand * segmentScale(n) * adoptionBase * combine(effects, "demand", role.key) * (0.6 + 0.4 * driver);
    const a = vs.map((v) => attraction(cfg, role, work[v.id].d.price, v.state, work[v.id].d.marketing));
    const meanA = a.reduce((s, x) => s + x, 0) / n || 1;
    vs.forEach((v, i) => {
      const w = work[v.id];
      w.demand = Math.round((D / n) * a[i] * Math.pow(a[i] / meanA, 0.8));
      w.endSales = Math.max(0, Math.min(w.demand, Math.floor(w.available)));
      if (w.demand > w.endSales + 0.5) w.notes.push(`Customers wanted ${w.demand} ${role.product} but you could only sell ${w.endSales}. Lost sales hurt your brand.`);
    });
    const sales = vs.reduce((s, v) => s + work[v.id].endSales, 0);
    roleMarket[role.key] = {
      demand: vs.reduce((s, v) => s + work[v.id].demand, 0),
      sales,
      avgPrice: sales > 0 ? vs.reduce((s, v) => s + work[v.id].endSales * work[v.id].d.price, 0) / sales : vs.reduce((s, v) => s + work[v.id].d.price, 0) / n,
      output: vs.reduce((s, v) => s + work[v.id].endSales + work[v.id].deliveredOut, 0),
      spotPrice: spot,
      ventures: n,
    };
  }

  // ---- finance ----
  const states: CycleOutput["states"] = {};
  const results: CycleOutput["results"] = {};
  for (const w of Object.values(work)) {
    const { v, role, d } = w;
    const s = v.state;
    const unitCost = role.unitCost * combine(effects, "cost", role.key);
    let spotInputs = 0;
    for (const need of role.inputs) {
      const required = w.produced * need.perUnit;
      const got = receivedByBuyer[v.id]?.[need.role] ?? 0;
      const gap = Math.max(0, required - got);
      const unitSpot = roleMarket[need.role]?.spotPrice ?? spotPrice(cfg, need.role);
      spotInputs += gap * unitSpot;
      if (got > required + 0.5) w.notes.push(`You received ${r2(got)} contracted units from ${roleOf(cfg, need.role)?.name} but only needed ${r2(required)}. The surplus was wasted.`);
      if (gap > 0.5) w.notes.push(`Bought ${r2(gap)} ${roleOf(cfg, need.role)?.product} on the spot market at ₹${Math.round(unitSpot).toLocaleString("en-IN")} each.`);
    }
    const inventory = Math.max(0, w.available - w.endSales);
    const costs = {
      production: w.produced * unitCost,
      contractInputs: w.contractInputCost,
      spotInputs,
      fixed: role.fixedCost,
      marketing: d.marketing,
      quality: d.quality,
      holding: inventory * unitCost * (cfg.holdingCostPct / 100),
      interest: s.debt * (rate / 100 / 4),
      penalties: w.penaltiesPaid,
      research: s.pendingCharges,
    };
    const revenue = w.endSales * d.price + w.contractRevenue;
    const profit = revenue + w.penaltyIncome - Object.values(costs).reduce((a, b) => a + b, 0);
    const capex = d.capacityInvest * role.capexPerUnit;
    let cash = s.cash + profit - capex + d.borrow;
    const repaid = Math.max(0, Math.min(d.repay, s.debt + d.borrow, cash));
    cash -= repaid;
    let debt = s.debt + d.borrow - repaid;
    let emergencyLoan = 0;
    if (cash < 0) {
      emergencyLoan = -cash;
      debt += emergencyLoan * (1 + cfg.emergencyFeePct / 100);
      cash = 0;
      w.notes.push(`Cash ran out. An emergency loan of ₹${Math.round(emergencyLoan).toLocaleString("en-IN")} was drawn with a ${cfg.emergencyFeePct}% fee.`);
    }
    const fill = w.demand > 0 ? Math.min(1, w.endSales / w.demand) : 1;
    const quality = clamp(0.9 * s.quality + 0.1 + 0.15 * (d.quality / cfg.qualityRef), 0.5, 2);
    const brandTarget = (0.6 + 0.4 * fill) * Math.sqrt(quality) * (1 + 0.1 * Math.log(1 + d.marketing / cfg.marketingRef));
    const brand = clamp(0.7 * s.brand + 0.3 * brandTarget, 0.4, 2);
    const reliability = w.contracted > 0 ? clamp(0.6 * s.reliability + 0.4 * fillRate[v.id], 0, 1) : s.reliability;
    const next: VentureState = {
      cash: r2(cash), debt: r2(debt), capacity: s.capacity + s.pendingCapacity, pendingCapacity: d.capacityInvest,
      quality: r2(quality), brand: r2(brand), reliability: r2(reliability), inventory: r2(inventory),
      cumProfit: r2(s.cumProfit + profit), startEquity: s.startEquity, pendingCharges: 0,
      lastDecision: d, distress: s.distress + (emergencyLoan > 0 ? 1 : 0),
    };
    if (s.pendingCapacity > 0) w.notes.push(`${s.pendingCapacity} units of new capacity came online.`);
    if (d.capacityInvest > 0) w.notes.push(`Investing in ${d.capacityInvest} units of capacity; it comes online next cycle.`);
    states[v.id] = next;
    const roleSales = roleMarket[role.key].sales;
    results[v.id] = {
      cycle, price: d.price, produced: w.produced, demand: w.demand, endSales: w.endSales, contractSales: r2(w.deliveredOut),
      marketShare: roleSales > 0 ? w.endSales / roleSales : 1 / (roleMarket[role.key].ventures || 1),
      revenue: r2(revenue), costs: Object.fromEntries(Object.entries(costs).map(([k, x]) => [k, r2(x)])) as VentureResult["costs"],
      penaltyIncome: r2(w.penaltyIncome), profit: r2(profit), capex, borrowed: d.borrow, repaid: r2(repaid), emergencyLoan: r2(emergencyLoan),
      cash: next.cash, debt: next.debt, capacity: next.capacity, inventory: next.inventory, quality: next.quality, brand: next.brand,
      reliability: next.reliability, equity: r2(equityOf(role, next)), autoCarried: w.carried, notes: w.notes,
    };
  }

  // ---- ecosystem adoption: grows when the ecosystem actually serves customers ----
  const active = cfg.roles.filter((r) => roleMarket[r.key].ventures > 0);
  const served = active.reduce((s, r) => s + roleMarket[r.key].sales, 0);
  const reference = active.reduce((s, r) => s + r.refDemand * segmentScale(roleMarket[r.key].ventures), 0) || 1;
  const adoption = r2(clamp(0.7 * adoptionBase + 0.3 * (served / reference), 0.5, 2));

  return { market: { cycle, adoption, interestRate: rate, roles: roleMarket }, states, results, contracts: contractOut };
}

export type VentureScore = { id: string; roe: number; equity: number; brand: number; reliability: number; composite: number; marks: number };

/** Final marks: ROE and brand normalised across all startups, reliability absolute, with a participation floor. */
export function scoreVentures(cfg: EconomyConfig, ventures: EngineVenture[]): VentureScore[] {
  const rows = ventures.flatMap((v) => {
    const role = roleOf(cfg, v.roleKey);
    if (!role) return [];
    const equity = equityOf(role, v.state);
    return [{ id: v.id, equity, roe: (equity - v.state.startEquity) / (v.state.startEquity || 1), brand: v.state.brand, reliability: v.state.reliability }];
  });
  const norm = (xs: number[], x: number) => {
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return hi - lo < 1e-9 ? 1 : (x - lo) / (hi - lo);
  };
  const { equity: we, brand: wb, reliability: wr, floor, maxMarks } = cfg.scoring;
  const tw = we + wb + wr || 1;
  return rows.map((r) => {
    const composite = (we * norm(rows.map((x) => x.roe), r.roe) + wb * norm(rows.map((x) => x.brand), r.brand) + wr * r.reliability) / tw;
    return { ...r, roe: r2(r.roe), equity: r2(r.equity), composite: r2(composite), marks: r2(maxMarks * (floor / 100 + (1 - floor / 100) * composite)) };
  });
}

// ---------------- Dry run: bots play the whole game so organisers can sanity-check the economy ----------------

export type DryRunRow = { label: string; roleKey: string; strategy: string; startEquity: number; endEquity: number; roe: number; minCash: number; distress: number; marks: number; profitByCycle: number[] };
export type DryRunReport = { rows: DryRunRow[]; adoption: number[]; warnings: string[] };

const STRATEGIES = {
  balanced: { price: 1, invest: 0, marketing: 20_000, quality: 10_000 },
  aggressive: { price: 0.88, invest: 0.12, marketing: 40_000, quality: 0 },
  premium: { price: 1.18, invest: 0, marketing: 30_000, quality: 40_000 },
} as const;

export function dryRun(cfg: EconomyConfig, teams = cfg.roles.length, withContracts = true): DryRunReport {
  const names = Object.keys(STRATEGIES) as (keyof typeof STRATEGIES)[];
  const ventures: (EngineVenture & { strategy: keyof typeof STRATEGIES })[] = Array.from({ length: teams }, (_, i) => {
    const role = cfg.roles[i % cfg.roles.length];
    return { id: `Bot ${i + 1}`, roleKey: role.key, state: initialState(cfg, role), strategy: names[i % names.length] };
  });
  const count = (k: string) => ventures.filter((v) => v.roleKey === k).length;

  // Bots sign one contract per input relationship (first seller of that role), sized to their expected need, at 90% of spot.
  const contracts: EngineContract[] = [];
  if (withContracts)
    for (const buyer of ventures) {
      const role = roleOf(cfg, buyer.roleKey)!;
      const expected = defaultDecision(role, role.startCapacity, count(role.key)).production;
      for (const need of role.inputs) {
        const seller = ventures.find((v) => v.roleKey === need.role);
        if (seller) contracts.push({ id: `${buyer.id}-${seller.id}`, sellerId: seller.id, buyerId: buyer.id, units: Math.round(expected * need.perUnit), unitPrice: r2(spotPrice(cfg, need.role) * 0.9) });
      }
    }

  let market = initialMarket(cfg);
  const lastDemand: Record<string, number> = {};
  const minCash: Record<string, number> = {};
  const profits: Record<string, number[]> = {};
  const adoption: number[] = [];
  for (let cycle = 1; cycle <= cfg.cycles; cycle++) {
    const decisions: Record<string, Decision> = {};
    for (const v of ventures) {
      const role = roleOf(cfg, v.roleKey)!;
      const st = STRATEGIES[v.strategy];
      const base = defaultDecision(role, v.state.capacity, count(role.key));
      const owed = contracts.filter((c) => c.sellerId === v.id).reduce((s, c) => s + c.units, 0);
      const target = (lastDemand[v.id] ?? base.production) * 1.05 + owed;
      decisions[v.id] = {
        ...base,
        price: role.basePrice * st.price,
        production: Math.min(v.state.capacity, Math.round(target)),
        capacityInvest: cycle <= 2 ? Math.round(role.startCapacity * st.invest) : 0,
        marketing: st.marketing,
        quality: st.quality,
      };
    }
    const effects = cfg.scheduledEvents.filter((e) => e.cycle === cycle).map((e) => e.effects);
    const out = processCycle({ cfg, cycle, market, ventures, decisions, contracts, effects });
    market = out.market;
    adoption.push(market.adoption);
    for (const v of ventures) {
      v.state = out.states[v.id];
      const res = out.results[v.id];
      lastDemand[v.id] = res.demand;
      minCash[v.id] = Math.min(minCash[v.id] ?? Infinity, res.cash);
      (profits[v.id] ??= []).push(res.profit);
    }
  }

  const scores = scoreVentures(cfg, ventures);
  const rows: DryRunRow[] = ventures.map((v) => {
    const sc = scores.find((s) => s.id === v.id)!;
    return {
      label: v.id, roleKey: v.roleKey, strategy: v.strategy, startEquity: r2(v.state.startEquity), endEquity: sc.equity, roe: sc.roe,
      minCash: r2(minCash[v.id]), distress: v.state.distress, marks: sc.marks, profitByCycle: profits[v.id].map(r2),
    };
  });

  const warnings: string[] = [];
  for (const role of cfg.roles) {
    const rs = rows.filter((r) => r.roleKey === role.key);
    if (!rs.length) continue;
    if (Math.max(...rs.map((r) => r.roe)) < -0.25) warnings.push(`${role.name}: every bot lost more than 25% of equity. The role may be too hard (raise base price or demand, or cut fixed cost).`);
    if (Math.min(...rs.map((r) => r.roe)) > 1.5) warnings.push(`${role.name}: even the weakest bot more than doubled equity. The role may be too easy.`);
    if (rs.some((r) => r.distress > 0)) warnings.push(`${role.name}: a bot needed an emergency loan. Check that cash covers fixed costs in early cycles.`);
  }
  const roes = rows.map((r) => r.roe);
  if (roes.length && Math.max(...roes) - Math.min(...roes) > 3) warnings.push("Returns differ by more than 300 percentage points between roles. Scoring normalises ROE, but consider rebalancing.");
  return { rows, adoption, warnings };
}
