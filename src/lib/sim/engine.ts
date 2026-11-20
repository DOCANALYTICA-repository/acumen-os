// Deterministic economy engine. Pure functions only: same inputs → same outputs.
// The server is the only caller that persists results; the browser never computes outcomes.
// Client-safe (no server imports), so the workspace can reuse the award helpers.

import {
  AWARDS,
  defaultDecision,
  leverRef,
  LEVERS,
  leverTotal,
  roleOf,
  segmentScale,
  spotPrice,
  type DealKind,
  type Decision,
  type EconomyConfig,
  type EventEffects,
  type FinalMetrics,
  type LeverKey,
  type MarketState,
  type Perks,
  type RoleDef,
  type VentureResult,
  type VentureState,
} from "./model";

export type EngineVenture = { id: string; roleKey: string; state: VentureState };
export type EngineContract = {
  id: string;
  kind: DealKind;
  sellerId: string; // provider: seller / licensor / lender / partner A
  buyerId: string; // receiver: buyer / licensee / borrower / partner B
  units: number; // supply: units per year
  unitPrice: number; // supply: price per unit · licence: fee per year · loan: principal · alliance: fee per partner per year
  ratePct: number; // loan interest, % per year
  startCycle: number;
  cycles: number;
};
export type CycleInput = {
  cfg: EconomyConfig;
  cycle: number;
  market: MarketState;
  ventures: EngineVenture[];
  decisions: Record<string, Decision | undefined>;
  contracts: EngineContract[]; // contracts active in this year
  effects: EventEffects[]; // events applied in this year
};
export type CycleOutput = {
  market: MarketState;
  states: Record<string, VentureState>;
  results: Record<string, VentureResult>;
  contracts: Record<string, { delivered: number; shortfall: number }>;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Diminishing returns: spending intensity (spend ÷ reference) → 0–100. Default spend (0.4) ≈ 50. */
const sat = (intensity: number) => 100 * (1 - Math.exp(-1.7 * Math.max(0, intensity)));
const SHARE_EXP = 1.8;

export function initialMarket(cfg: EconomyConfig): MarketState {
  return {
    cycle: 0, adoption: 1, interestRate: cfg.interestRate, taxRate: cfg.taxRate, inflation: cfg.inflation, gdpGrowth: cfg.gdpGrowth,
    priceLevel: 1, demandIndex: 1, confidence: 1, roles: {}, totalRevenue: 0,
  };
}

export function equityOf(role: RoleDef, s: Pick<VentureState, "cash" | "debt" | "capacity" | "pendingCapacity" | "inventory">, priceLevel = 1) {
  return s.cash + (s.capacity + s.pendingCapacity) * role.capexPerUnit * 0.5 * priceLevel + s.inventory * role.unitCost * priceLevel - s.debt;
}

/** Combines the perks of several resources. */
export function mergePerks(list: Perks[]): Perks {
  const out: Perks = {};
  for (const p of list) {
    for (const k of ["demandMult", "unitCostMult", "fixedCostMult", "capacityMult"] as const) if (p[k] !== undefined) out[k] = (out[k] ?? 1) * p[k]!;
    for (const k of ["tech", "brand", "customerSat", "employeeSat"] as const) if (p[k] !== undefined) out[k] = (out[k] ?? 0) + p[k]!;
  }
  return out;
}

/** A company's state when the simulation starts. Return on equity is measured against the base budget, so auction spend is an investment. */
export function initialState(cfg: EconomyConfig, role: RoleDef, opts: { cash?: number; perks?: Perks; assets?: string[]; companyName?: string } = {}): VentureState {
  const perks = opts.perks ?? {};
  const capacity = Math.round(role.startCapacity * (perks.capacityMult ?? 1));
  const startEquity = equityOf(role, { cash: cfg.startCash, debt: 0, capacity, pendingCapacity: 0, inventory: 0 });
  return {
    companyName: opts.companyName ?? "",
    cash: opts.cash ?? cfg.startCash, debt: 0, capacity, pendingCapacity: 0, inventory: 0,
    tech: clamp(50 + (perks.tech ?? 0), 0, 100), brand: clamp(50 + (perks.brand ?? 0), 0, 100),
    customerSat: clamp(50 + (perks.customerSat ?? 0), 0, 100), employeeSat: clamp(50 + (perks.employeeSat ?? 0), 0, 100),
    reliability: 1, perks, assets: opts.assets ?? [],
    cumProfit: 0, cumRevenue: 0, cumTax: 0, shareSum: 0, years: 0, dealValue: 0, lossPool: 0, startEquity,
    pendingCharges: 0, lastDecision: null, distress: 0, firstRevenue: 0, lastRevenue: 0,
  };
}

/** Clamp a submitted decision to what the rules allow. */
export function sanitizeDecision(cfg: EconomyConfig, role: RoleDef, state: VentureState, d: Partial<Decision>, priceLevel = 1): Decision {
  const f = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const ref = role.basePrice * priceLevel;
  const leverMax = leverRef(cfg, role) * 10 * priceLevel;
  const levers = Object.fromEntries(LEVERS.map((l) => [l.key, Math.round(clamp(f(d[l.key]), 0, leverMax))])) as Record<LeverKey, number>;
  return {
    price: r2(clamp(f(d.price) || ref, ref * cfg.minPriceFactor, ref * cfg.maxPriceFactor)),
    production: Math.round(clamp(f(d.production), 0, state.capacity)),
    capacityInvest: Math.round(clamp(f(d.capacityInvest), 0, role.startCapacity)),
    borrow: Math.round(clamp(f(d.borrow), 0, Math.max(0, cfg.creditLimit - state.debt))),
    repay: Math.round(clamp(f(d.repay), 0, state.debt)),
    ...levers,
  };
}

function combine(effects: EventEffects[], field: "demand" | "spot" | "cost", key: string) {
  return effects.reduce((m, e) => m * (e[field]?.[key] ?? 1) * (e[field]?.["*"] ?? 1), 1);
}

type AttractionInput = { price: number; tech: number; customerSat: number; brand: number; marketing: number; sales: number; demandMult: number };

function attraction(role: RoleDef, ref: number, pl: number, confidence: number, x: AttractionInput) {
  const priceTerm = Math.pow(x.price / (role.basePrice * pl), -role.elasticity);
  const product = Math.pow(0.6 + 0.8 * (x.tech / 100), 0.7) * (0.7 + 0.6 * (x.customerSat / 100));
  const brand = 0.6 + 0.8 * (x.brand / 100);
  const mkt = 1 + 0.25 * Math.log(1 + x.marketing / (ref * pl)) * confidence;
  const sales = 1 + 0.3 * (1 - Math.exp(-1.5 * (x.sales / (ref * pl))));
  return priceTerm * product * brand * mkt * sales * x.demandMult;
}

/** The simulated incumbent in every market plays at par: market price, standard indices, standard spend. */
function incumbentAttraction(cfg: EconomyConfig, role: RoleDef, pl: number, confidence: number) {
  const ref = leverRef(cfg, role);
  return attraction(role, ref, pl, confidence, { price: role.basePrice * pl, tech: 50, customerSat: 50, brand: 50, marketing: ref * 0.4 * pl, sales: ref * 0.4 * pl, demandMult: 1 });
}

export function processCycle(input: CycleInput): CycleOutput {
  const { cfg, cycle, market, ventures, contracts, effects } = input;
  // Persistent economy shifts apply from the year the event happens.
  const sum = (k: keyof EventEffects) => effects.reduce((s, e) => s + ((e[k] as number | undefined) ?? 0), 0);
  const rate = clamp(market.interestRate + sum("interestDelta"), 0, 40);
  const taxRate = clamp(market.taxRate + sum("taxDelta"), 0, 60);
  const inflation = clamp(market.inflation + sum("inflationDelta"), -5, 40);
  const gdp = clamp(market.gdpGrowth + sum("gdpDelta"), -15, 20);
  const eventConfidence = effects.reduce((m, e) => m * (e.confidence ?? 1), 1);
  const confidence = r2(clamp((1 + (gdp - 4) / 25) * eventConfidence, 0.6, 1.4));
  const adoptionBase = clamp(market.adoption + sum("adoptionDelta"), 0.5, 2);
  const pl = market.priceLevel;
  const s0 = clamp(cfg.incumbentShare, 0, 0.8);

  const byRole: Record<string, EngineVenture[]> = {};
  for (const v of ventures) (byRole[v.roleKey] ??= []).push(v);

  // ---- resolve decisions ----
  type Work = {
    v: EngineVenture; role: RoleDef; ref: number; d: Decision; carried: boolean; effCap: number; produced: number; available: number;
    contracted: number; deliveredOut: number; contractRevenue: number; contractInputCost: number; penaltiesPaid: number; penaltyIncome: number;
    dealCost: number; dealIncome: number; loanFlows: number; licenceBoost: number; allianceSpend: number; allianceDemand: number;
    demand: number; endSales: number; notes: string[];
  };
  const owedBy: Record<string, number> = {};
  for (const c of contracts) if (c.kind === "SUPPLY") owedBy[c.sellerId] = (owedBy[c.sellerId] ?? 0) + c.units;
  const work: Record<string, Work> = {};
  for (const v of ventures) {
    const role = roleOf(cfg, v.roleKey);
    if (!role) continue;
    const submitted = input.decisions[v.id];
    const carried = !submitted;
    let raw: Partial<Decision> | null = submitted ?? v.state.lastDecision;
    if (!raw) {
      // Never-decided companies get a sensible plan that also covers what they owe on contracts.
      const base = defaultDecision(cfg, role, v.state.capacity, byRole[v.roleKey]?.length ?? 1, pl);
      raw = { ...base, production: Math.min(v.state.capacity, base.production + Math.ceil(owedBy[v.id] ?? 0)) };
    }
    // A carried-forward plan keeps pace with last year's inflation (price and spending), but makes no new investment or borrowing.
    const carry = (x: Partial<Decision>): Partial<Decision> => {
      const k = market.cycle > 0 ? 1 + market.inflation / 100 : 1;
      const levers = Object.fromEntries(LEVERS.map((l) => [l.key, Math.round((x[l.key] ?? 0) * k)]));
      return { ...x, ...levers, price: (x.price ?? 0) * k, capacityInvest: 0, borrow: 0, repay: 0 };
    };
    const d = sanitizeDecision(cfg, role, v.state, carried && v.state.lastDecision ? carry(raw) : carried ? { ...raw, capacityInvest: 0, borrow: 0, repay: 0 } : raw, pl);
    // Unhappy staff means absenteeism and attrition: effective capacity falls below 50 satisfaction.
    const effCap = Math.floor(v.state.capacity * (0.85 + 0.15 * Math.min(1, v.state.employeeSat / 50)));
    const produced = Math.min(d.production, effCap);
    const notes = carried ? ["No decision submitted: last year's plan was carried forward, with price and spending raised in line with inflation (no new investment or borrowing)."] : [];
    if (produced < d.production) notes.push(`Staffing limited output to ${produced} of the ${d.production} planned (employee satisfaction ${Math.round(v.state.employeeSat)}).`);
    work[v.id] = {
      v, role, ref: leverRef(cfg, role), d, carried, effCap, produced, available: v.state.inventory + produced, contracted: 0, deliveredOut: 0,
      contractRevenue: 0, contractInputCost: 0, penaltiesPaid: 0, penaltyIncome: 0, dealCost: 0, dealIncome: 0, loanFlows: 0,
      licenceBoost: 0, allianceSpend: 0, allianceDemand: 1, demand: 0, endSales: 0, notes,
    };
  }

  // ---- non-supply deals ----
  for (const c of contracts) {
    const a = work[c.sellerId], b = work[c.buyerId];
    if (!a || !b) continue;
    const k = cycle - c.startCycle; // 0 = first year of the deal
    if (c.kind === "LICENSE") {
      b.dealCost += c.unitPrice;
      a.dealIncome += c.unitPrice;
      b.licenceBoost = Math.max(b.licenceBoost, Math.max(5, (a.v.state.tech - b.v.state.tech) * 0.6));
      b.notes.push(`Paid a ₹${Math.round(c.unitPrice).toLocaleString("en-IN")} licence fee; your technology is catching up with your licensor's.`);
      a.notes.push(`Earned a ₹${Math.round(c.unitPrice).toLocaleString("en-IN")} licence fee.`);
    } else if (c.kind === "LOAN") {
      if (k === 0) {
        a.loanFlows -= c.unitPrice;
        b.loanFlows += c.unitPrice;
        b.notes.push(`Received a ₹${Math.round(c.unitPrice).toLocaleString("en-IN")} loan from another company.`);
      }
      const outstanding = c.unitPrice * (1 - k / c.cycles);
      const interest = outstanding * (c.ratePct / 100);
      const principal = c.unitPrice / c.cycles;
      b.dealCost += interest;
      a.dealIncome += interest;
      b.loanFlows -= principal;
      a.loanFlows += principal;
      b.notes.push(`Loan instalment: ₹${Math.round(principal).toLocaleString("en-IN")} principal + ₹${Math.round(interest).toLocaleString("en-IN")} interest.`);
    } else if (c.kind === "MARKETING") {
      for (const w of [a, b]) {
        w.dealCost += c.unitPrice;
        w.allianceSpend += c.unitPrice * 1.5; // a joint campaign punches above its weight
        w.allianceDemand *= 1.03;
      }
    }
  }

  // ---- supply deliveries (sellers fill contracts before the open market) ----
  const live = contracts.filter((c) => c.kind === "SUPPLY" && work[c.sellerId] && work[c.buyerId]);
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
      buyer.notes.push(`A supplier delivered only ${delivered} of ${c.units} ${seller.role.product}; the gap was bought from outside suppliers.`);
    }
  }
  for (const w of Object.values(work)) w.available -= w.deliveredOut;

  // ---- end markets: teams compete with each other and with a simulated incumbent ----
  const roleMarket: MarketState["roles"] = {};
  for (const role of cfg.roles) {
    const vs = (byRole[role.key] ?? []).filter((v) => work[v.id]);
    const n = vs.length;
    const spot = spotPrice(cfg, role.key, combine(effects, "spot", role.key), pl);
    if (!n) {
      roleMarket[role.key] = { demand: 0, teamSales: 0, incumbentSales: 0, avgPrice: role.basePrice * pl, output: 0, spotPrice: spot, ventures: 0 };
      continue;
    }
    let driver = 1;
    if (role.drivers.length && market.cycle > 0) {
      const tw = role.drivers.reduce((s, d) => s + d.weight, 0) || 1;
      driver = role.drivers.reduce((s, d) => {
        const prev = market.roles[d.role];
        const dRole = roleOf(cfg, d.role);
        const ratio = prev && prev.ventures > 0 && dRole ? clamp(prev.output / (dRole.refDemand * segmentScale(prev.ventures) * market.demandIndex), 0.5, 1.5) : 1;
        return s + ratio * d.weight;
      }, 0) / tw;
    }
    const total = (role.refDemand * segmentScale(n) * market.demandIndex * adoptionBase * confidence * combine(effects, "demand", role.key) * (0.6 + 0.4 * driver)) / (1 - s0);
    const weights = vs.map((v) => {
      const w = work[v.id];
      const s = v.state;
      return Math.pow(attraction(role, w.ref, pl, confidence, {
        price: w.d.price, tech: s.tech, customerSat: s.customerSat, brand: s.brand,
        marketing: w.d.marketing + w.allianceSpend, sales: w.d.sales, demandMult: (s.perks?.demandMult ?? 1) * w.allianceDemand,
      }), SHARE_EXP);
    });
    const incumbentW = s0 > 0 ? Math.pow(incumbentAttraction(cfg, role, pl, confidence), SHARE_EXP) * n * (s0 / (1 - s0)) : 0;
    const denom = weights.reduce((a, b) => a + b, 0) + incumbentW || 1;
    vs.forEach((v, i) => {
      const w = work[v.id];
      w.demand = Math.round((total * weights[i]) / denom);
      w.endSales = Math.max(0, Math.min(w.demand, Math.floor(w.available)));
      if (w.demand > w.endSales + 0.5) w.notes.push(`Customers wanted ${w.demand} ${role.product} but you could only sell ${w.endSales}. Unmet demand hurts customer satisfaction.`);
    });
    const teamSales = vs.reduce((s, v) => s + work[v.id].endSales, 0);
    const incumbentSales = Math.round((total * incumbentW) / denom);
    roleMarket[role.key] = {
      demand: Math.round(total),
      teamSales,
      incumbentSales,
      avgPrice: teamSales > 0 ? vs.reduce((s, v) => s + work[v.id].endSales * work[v.id].d.price, 0) / teamSales : vs.reduce((s, v) => s + work[v.id].d.price, 0) / n,
      output: vs.reduce((s, v) => s + work[v.id].endSales + work[v.id].deliveredOut, 0),
      spotPrice: spot,
      ventures: n,
    };
  }

  // ---- finance and indices ----
  const states: CycleOutput["states"] = {};
  const results: CycleOutput["results"] = {};
  for (const w of Object.values(work)) {
    const { v, role, d, ref } = w;
    const s = v.state;
    const perks = s.perks ?? {};
    const unitCost = role.unitCost * pl * combine(effects, "cost", role.key) * (perks.unitCostMult ?? 1) * (1.15 - 0.3 * (s.employeeSat / 100)) * (1.1 - 0.2 * (s.tech / 100));
    let spotInputs = 0;
    for (const need of role.inputs) {
      const required = w.produced * need.perUnit;
      const got = receivedByBuyer[v.id]?.[need.role] ?? 0;
      const gap = Math.max(0, required - got);
      const unitSpot = roleMarket[need.role]?.spotPrice ?? spotPrice(cfg, need.role, 1, pl);
      spotInputs += gap * unitSpot;
      if (got > required + 0.5) w.notes.push(`You received ${r2(got)} contracted units from ${roleOf(cfg, need.role)?.name} but only needed ${r2(required)}. The surplus was wasted.`);
      if (gap > 0.5) w.notes.push(`Bought ${r2(gap)} ${roleOf(cfg, need.role)?.product} from outside suppliers at ₹${Math.round(unitSpot).toLocaleString("en-IN")} each.`);
    }
    const inventory = Math.max(0, w.available - w.endSales);
    const leverSpend = leverTotal(d);
    const costs: VentureResult["costs"] = {
      production: w.produced * unitCost,
      contractInputs: w.contractInputCost,
      spotInputs,
      fixed: role.fixedCost * pl * (perks.fixedCostMult ?? 1),
      levers: leverSpend,
      deals: w.dealCost,
      holding: inventory * unitCost * (cfg.holdingCostPct / 100),
      interest: s.debt * (rate / 100),
      penalties: w.penaltiesPaid,
      research: s.pendingCharges,
    };
    const revenue = w.endSales * d.price + w.contractRevenue;
    const pbt = revenue + w.penaltyIncome + w.dealIncome - Object.values(costs).reduce((a, b) => a + b, 0);
    let lossPool = s.lossPool;
    let taxable = 0;
    if (pbt <= 0) lossPool += -pbt;
    else {
      const offset = Math.min(lossPool, pbt);
      lossPool -= offset;
      taxable = pbt - offset;
    }
    const tax = taxable * (taxRate / 100);
    const profit = pbt - tax;
    if (tax > 0) w.notes.push(`Paid ₹${Math.round(tax).toLocaleString("en-IN")} corporate tax at ${taxRate}%${pbt > taxable ? " after using losses carried forward" : ""}.`);
    const capex = d.capacityInvest * role.capexPerUnit * pl;
    let cash = s.cash + profit - capex + d.borrow + w.loanFlows;
    const repaid = Math.max(0, Math.min(d.repay, s.debt + d.borrow, cash));
    cash -= repaid;
    let debt = s.debt + d.borrow - repaid;
    let emergencyLoan = 0;
    if (cash < 0) {
      emergencyLoan = -cash;
      debt += emergencyLoan * (1 + cfg.emergencyFeePct / 100);
      cash = 0;
      w.notes.push(`Cash ran out. An emergency bank loan of ₹${Math.round(emergencyLoan).toLocaleString("en-IN")} was drawn with a ${cfg.emergencyFeePct}% fee.`);
    }

    // Indices move 40% of the way towards this year's target each year.
    const i = (k: LeverKey, extra = 0) => (d[k] + extra) / (ref * pl);
    const fill = w.demand > 0 ? Math.min(1, w.endSales / w.demand) : 1;
    const utilisation = w.effCap > 0 ? w.produced / w.effCap : 0;
    const ema = (old: number, target: number) => clamp(r2(0.6 * old + 0.4 * clamp(target, 0, 100)), 0, 100);
    const tech = ema(s.tech, sat(i("technology")) + (perks.tech ?? 0) + w.licenceBoost);
    const employeeSat = ema(
      s.employeeSat,
      // Standard spend keeps staff at about 50 under the economy's normal inflation; an inflation spike above that erodes morale.
      sat(i("employees")) + 4 + 4 * (1 - Math.exp(-1.7 * i("sustainability"))) + (perks.employeeSat ?? 0) - Math.max(0, inflation - cfg.inflation) * 1.5 - (utilisation > 0.97 ? 3 : 0),
    );
    const priceGap = clamp((d.price / (role.basePrice * pl) - 1) * 40, -10, 20);
    const customerSat = ema(s.customerSat, 0.5 * sat(i("customerService")) + 25 * fill + 0.25 * tech - priceGap + (perks.customerSat ?? 0));
    const brand = ema(s.brand, 0.45 * sat(i("marketing", w.allianceSpend) * confidence) + 0.25 * customerSat + 0.15 * sat(i("sustainability") * 2) + 0.15 * tech + (perks.brand ?? 0));
    const reliability = w.contracted > 0 ? clamp(0.6 * s.reliability + 0.4 * fillRate[v.id], 0, 1) : s.reliability;
    if (inflation > cfg.inflation + 1) w.notes.push(`Inflation at ${inflation}% is eroding staff morale; employee welfare spending needs to keep up.`);

    const rm = roleMarket[role.key];
    const segment = rm.teamSales + rm.incumbentSales;
    const marketShare = segment > 0 ? w.endSales / segment : 0;
    const next: VentureState = {
      ...s,
      cash: r2(cash), debt: r2(debt), capacity: s.capacity + s.pendingCapacity, pendingCapacity: d.capacityInvest, inventory: r2(inventory),
      tech, brand, customerSat, employeeSat, reliability: r2(reliability),
      cumProfit: r2(s.cumProfit + profit), cumRevenue: r2(s.cumRevenue + revenue), cumTax: r2(s.cumTax + tax),
      shareSum: Math.round((s.shareSum + marketShare) * 10_000) / 10_000,
      years: s.years + 1, lossPool: r2(lossPool), pendingCharges: 0, lastDecision: d, distress: s.distress + (emergencyLoan > 0 ? 1 : 0),
      firstRevenue: s.years === 0 ? r2(revenue) : s.firstRevenue, lastRevenue: r2(revenue),
    };
    if (s.pendingCapacity > 0) w.notes.push(`${s.pendingCapacity} units of new capacity came online.`);
    if (d.capacityInvest > 0) w.notes.push(`Investing in ${d.capacityInvest} units of capacity; it comes online next year.`);
    states[v.id] = next;
    results[v.id] = {
      cycle, price: d.price, produced: w.produced, effectiveCapacity: w.effCap, demand: w.demand, endSales: w.endSales, contractSales: r2(w.deliveredOut),
      marketShare: Math.round(marketShare * 10_000) / 10_000, economyShare: 0, revenue: r2(revenue),
      costs: Object.fromEntries(Object.entries(costs).map(([k, x]) => [k, r2(x)])) as VentureResult["costs"],
      levers: Object.fromEntries(LEVERS.map((l) => [l.key, d[l.key]])) as Record<LeverKey, number>,
      dealIncome: r2(w.dealIncome), penaltyIncome: r2(w.penaltyIncome), profitBeforeTax: r2(pbt), tax: r2(tax), profit: r2(profit),
      capex: r2(capex), borrowed: d.borrow, repaid: r2(repaid), loanFlows: r2(w.loanFlows), emergencyLoan: r2(emergencyLoan),
      cash: next.cash, debt: next.debt, capacity: next.capacity, inventory: next.inventory, tech, brand, customerSat, employeeSat,
      reliability: next.reliability, equity: r2(equityOf(role, next, pl * (1 + inflation / 100))), autoCarried: w.carried, notes: w.notes,
    };
  }
  const totalRevenue = Object.values(results).reduce((s, r) => s + r.revenue, 0);
  for (const r of Object.values(results)) r.economyShare = totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 10_000) / 10_000 : 0;

  // ---- economy moves on: adoption grows when the ecosystem serves customers; prices and market size compound ----
  const active = cfg.roles.filter((r) => roleMarket[r.key].ventures > 0);
  const served = active.reduce((s, r) => s + roleMarket[r.key].teamSales, 0);
  const reference = active.reduce((s, r) => s + r.refDemand * segmentScale(roleMarket[r.key].ventures) * market.demandIndex, 0) || 1;
  const adoption = r2(clamp(0.7 * adoptionBase + 0.3 * (served / reference), 0.5, 2));

  return {
    market: {
      cycle, adoption, interestRate: rate, taxRate, inflation, gdpGrowth: gdp, confidence,
      priceLevel: Math.round(pl * (1 + inflation / 100) * 10_000) / 10_000,
      demandIndex: Math.round(market.demandIndex * (1 + gdp / 100) * 10_000) / 10_000,
      roles: roleMarket, totalRevenue: r2(totalRevenue),
    },
    states, results, contracts: contractOut,
  };
}

// ---------------- Final standings, marks and awards ----------------

export function finalMetrics(cfg: EconomyConfig, ventures: (EngineVenture & { teamName: string })[], priceLevel = 1): FinalMetrics[] {
  return ventures.flatMap((v) => {
    const role = roleOf(cfg, v.roleKey);
    if (!role) return [];
    const s = v.state;
    const equity = equityOf(role, s, priceLevel);
    return [{
      ventureId: v.id, teamName: v.teamName, companyName: s.companyName, roleKey: v.roleKey,
      cumProfit: r2(s.cumProfit), cumRevenue: r2(s.cumRevenue), avgMarketShare: s.years > 0 ? s.shareSum / s.years : 0,
      equity: r2(equity), roe: (equity - s.startEquity) / (s.startEquity || 1),
      customerSat: s.customerSat, employeeSat: s.employeeSat, tech: s.tech, brand: s.brand, reliability: s.reliability,
      dealValue: s.dealValue, growth: s.firstRevenue > 0 ? s.lastRevenue / s.firstRevenue - 1 : 0, cumTax: s.cumTax,
    }];
  });
}

export type VentureScore = { id: string; composite: number; marks: number };

/** Marks: each criterion normalised across companies (reliability absolute), weighted, with a participation floor. */
export function scoreVentures(cfg: EconomyConfig, metrics: FinalMetrics[]): VentureScore[] {
  const norm = (xs: number[], x: number) => {
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return hi - lo < 1e-9 ? 1 : (x - lo) / (hi - lo);
  };
  const w = cfg.scoring;
  const tw = w.profit + w.revenue + w.marketShare + w.satisfaction + w.brand + w.reliability || 1;
  const col = (f: (m: FinalMetrics) => number) => metrics.map(f);
  const satisfaction = (m: FinalMetrics) => (m.customerSat + m.employeeSat) / 2;
  return metrics.map((m) => {
    const composite =
      (w.profit * norm(col((x) => x.roe), m.roe) +
        w.revenue * norm(col((x) => x.cumRevenue), m.cumRevenue) +
        w.marketShare * norm(col((x) => x.avgMarketShare), m.avgMarketShare) +
        w.satisfaction * norm(col(satisfaction), satisfaction(m)) +
        w.brand * norm(col((x) => x.brand), m.brand) +
        w.reliability * m.reliability) / tw;
    return { id: m.ventureId, composite: r2(composite), marks: r2(w.maxMarks * (w.floor / 100 + (1 - w.floor / 100) * composite)) };
  });
}

export type Award = { title: string; winners: { ventureId: string; name: string }[]; label: string };

/** Who wins each award (ties share it; an award everyone ties on, or that nobody earned, is not given). */
export function computeAwards(metrics: FinalMetrics[]): Award[] {
  if (!metrics.length) return [];
  return AWARDS.flatMap((a) => {
    const best = Math.max(...metrics.map((m) => Number(m[a.key])));
    const winners = metrics.filter((m) => Math.abs(Number(m[a.key]) - best) < 1e-6);
    if (best <= 0 && a.key !== "avgMarketShare") return [];
    if (metrics.length > 1 && winners.length === metrics.length) return [];
    return [{ title: a.title, winners: winners.map((m) => ({ ventureId: m.ventureId, name: m.companyName ? `${m.companyName} (${m.teamName})` : m.teamName })), label: a.label(winners[0]) }];
  });
}

// ---------------- Dry run: bots play the whole game so organisers can sanity-check the economy ----------------

export type DryRunRow = { label: string; roleKey: string; strategy: string; startEquity: number; endEquity: number; roe: number; minCash: number; distress: number; marks: number; avgShare: number; profitByCycle: number[] };
export type DryRunReport = { rows: DryRunRow[]; adoption: number[]; warnings: string[] };

const STRATEGIES: Record<string, { price: number; invest: number; levers: number; focus: LeverKey | null }> = {
  balanced: { price: 1, invest: 0, levers: 1, focus: null },
  aggressive: { price: 0.9, invest: 0.12, levers: 1.2, focus: "marketing" },
  premium: { price: 1.15, invest: 0, levers: 1.2, focus: "technology" },
  lean: { price: 1, invest: 0, levers: 0.5, focus: null },
};

export function dryRun(cfg: EconomyConfig, teams = cfg.roles.length, withContracts = true): DryRunReport {
  const names = Object.keys(STRATEGIES);
  const ventures: (EngineVenture & { strategy: string; teamName: string })[] = Array.from({ length: teams }, (_, i) => {
    const role = cfg.roles[i % cfg.roles.length];
    return { id: `Bot ${i + 1}`, teamName: `Bot ${i + 1}`, roleKey: role.key, state: initialState(cfg, role), strategy: names[i % names.length] };
  });
  const count = (k: string) => ventures.filter((v) => v.roleKey === k).length;

  // Bots sign one supply contract per input relationship (first seller of that role), sized to expected need, at 90% of the supplier price.
  const contracts: EngineContract[] = [];
  if (withContracts)
    for (const buyer of ventures) {
      const role = roleOf(cfg, buyer.roleKey)!;
      const expected = defaultDecision(cfg, role, role.startCapacity, count(role.key)).production;
      for (const need of role.inputs) {
        const seller = ventures.find((v) => v.roleKey === need.role);
        if (seller) contracts.push({ id: `${buyer.id}-${seller.id}`, kind: "SUPPLY", sellerId: seller.id, buyerId: buyer.id, units: Math.round(expected * need.perUnit), unitPrice: r2(spotPrice(cfg, need.role) * 0.9), ratePct: 0, startCycle: 1, cycles: cfg.cycles });
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
      const base = defaultDecision(cfg, role, v.state.capacity, count(role.key), market.priceLevel);
      const owed = contracts.filter((c) => c.sellerId === v.id).reduce((s, c) => s + c.units, 0);
      const target = (lastDemand[v.id] ?? base.production) * 1.05 + owed;
      const levers = Object.fromEntries(LEVERS.map((l) => [l.key, Math.round(base[l.key] * st.levers * (st.focus === l.key ? 1.8 : 1))]));
      decisions[v.id] = {
        ...base,
        ...levers,
        price: Math.round(role.basePrice * market.priceLevel * st.price),
        production: Math.min(v.state.capacity, Math.round(target)),
        capacityInvest: cycle <= 2 ? Math.round(role.startCapacity * st.invest) : 0,
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

  const metrics = finalMetrics(cfg, ventures, market.priceLevel);
  const scores = scoreVentures(cfg, metrics);
  const rows: DryRunRow[] = ventures.map((v) => {
    const m = metrics.find((x) => x.ventureId === v.id)!;
    return {
      label: v.id, roleKey: v.roleKey, strategy: v.strategy, startEquity: r2(v.state.startEquity), endEquity: m.equity, roe: r2(m.roe),
      minCash: r2(minCash[v.id]), distress: v.state.distress, marks: scores.find((s) => s.id === v.id)!.marks, avgShare: r2(m.avgMarketShare), profitByCycle: profits[v.id].map(r2),
    };
  });

  const warnings: string[] = [];
  for (const role of cfg.roles) {
    const rs = rows.filter((r) => r.roleKey === role.key);
    if (!rs.length) continue;
    if (Math.max(...rs.map((r) => r.roe)) < -0.25) warnings.push(`${role.name}: every bot lost more than 25% of equity. The role may be too hard (raise base price or demand, or cut fixed cost).`);
    if (Math.min(...rs.map((r) => r.roe)) > 1.5) warnings.push(`${role.name}: even the weakest bot more than doubled equity. The role may be too easy.`);
    if (rs.some((r) => r.distress > 0)) warnings.push(`${role.name}: a bot needed an emergency loan. Check that cash covers fixed costs in early years.`);
  }
  const roes = rows.map((r) => r.roe);
  if (roes.length && Math.max(...roes) - Math.min(...roes) > 3) warnings.push("Returns differ by more than 300 percentage points between roles. Scoring normalises results, but consider rebalancing.");
  return { rows, adoption, warnings };
}
