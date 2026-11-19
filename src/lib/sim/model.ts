// Types, the default economy template and small helpers for the Startup Ecosystem simulation.
// Client-safe: no database or server imports.

export type InputNeed = { role: string; perUnit: number };
export type Driver = { role: string; weight: number };

export type RoleDef = {
  key: string;
  name: string; // "EV manufacturing"
  product: string; // unit label, e.g. "vehicles"
  blurb: string;
  basePrice: number; // reference price per unit (₹)
  unitCost: number; // variable cost per unit, excluding bought-in inputs
  fixedCost: number; // per cycle
  startCapacity: number; // units per cycle
  capexPerUnit: number; // cost of adding 1 unit of capacity (online next cycle)
  refDemand: number; // end-market demand per cycle at base price, adoption 1
  elasticity: number; // price elasticity of end-market demand
  inputs: InputNeed[]; // what this business buys from other roles, per unit produced
  drivers: Driver[]; // roles whose activity grows this role's end-market demand
};

export type EventEffects = {
  demand?: Record<string, number>; // role key or "*" → demand multiplier for that cycle
  spot?: Record<string, number>; // role key or "*" → spot price multiplier for that cycle
  cost?: Record<string, number>; // role key or "*" → unit cost multiplier for that cycle
  interestDelta?: number; // percentage points, persists
  adoptionDelta?: number; // added to the adoption index, persists
};

export type EventPreset = { key: string; title: string; description: string; effects: EventEffects };

export type ScoringConfig = { floor: number; equity: number; brand: number; reliability: number; maxMarks: number };

export type EconomyConfig = {
  industry: string;
  tagline: string;
  cycles: number;
  cycleNames: string[];
  cycleMinutes: number;
  autoAdvance: boolean; // process automatically when the decision window ends
  startCash: number;
  creditLimit: number; // max total debt per startup
  interestRate: number; // annual %, charged per cycle as rate/4
  emergencyFeePct: number; // fee on the automatic overdraft loan when cash goes negative
  spotMarkup: number; // simulated suppliers charge basePrice × this
  contractPenaltyPct: number; // seller pays this share of the contract value of undelivered units
  holdingCostPct: number; // per cycle, on unsold inventory at unit cost
  minPriceFactor: number;
  maxPriceFactor: number;
  marketingRef: number;
  qualityRef: number;
  researchCost: number;
  scoring: ScoringConfig;
  roles: RoleDef[];
  scheduledEvents: { cycle: number; title: string; description: string; effects: EventEffects }[];
  eventLibrary: EventPreset[];
};

export type Decision = {
  price: number;
  production: number;
  capacityInvest: number; // units of capacity to add
  marketing: number; // ₹
  quality: number; // ₹ spent on quality / R&D
  borrow: number; // ₹
  repay: number; // ₹
};

export type VentureState = {
  cash: number;
  debt: number;
  capacity: number;
  pendingCapacity: number;
  quality: number; // 0.5–2, 1 = industry standard
  brand: number; // 0.4–2, customer goodwill
  reliability: number; // 0–1, contract delivery record
  inventory: number;
  cumProfit: number;
  startEquity: number;
  pendingCharges: number; // research bought during the cycle, charged at processing
  lastDecision: Decision | null;
  distress: number; // cycles that needed an emergency loan
};

export type RoleMarket = { demand: number; sales: number; avgPrice: number; output: number; spotPrice: number; ventures: number };

export type MarketState = {
  cycle: number; // last processed cycle (0 = none)
  adoption: number;
  interestRate: number;
  roles: Record<string, RoleMarket>;
};

export type VentureResult = {
  cycle: number;
  price: number;
  produced: number;
  demand: number;
  endSales: number;
  contractSales: number; // units delivered to other startups
  marketShare: number; // within the role's end market, 0–1
  revenue: number;
  costs: {
    production: number;
    contractInputs: number;
    spotInputs: number;
    fixed: number;
    marketing: number;
    quality: number;
    holding: number;
    interest: number;
    penalties: number;
    research: number;
  };
  penaltyIncome: number;
  profit: number;
  capex: number;
  borrowed: number;
  repaid: number;
  emergencyLoan: number;
  cash: number;
  debt: number;
  capacity: number;
  inventory: number;
  quality: number;
  brand: number;
  reliability: number;
  equity: number;
  autoCarried: boolean;
  notes: string[];
};

export const DEFAULT_SCORING: ScoringConfig = { floor: 40, equity: 0.6, brand: 0.2, reliability: 0.2, maxMarks: 100 };

const EV_ROLES: RoleDef[] = [
  {
    key: "ev_maker", name: "EV manufacturing", product: "vehicles", blurb: "Builds electric vehicles for retail buyers and leasing companies. Needs one battery pack per vehicle.",
    basePrice: 6000, unitCost: 2000, fixedCost: 90000, startCapacity: 110, capexPerUnit: 5000, refDemand: 100, elasticity: 2.0,
    inputs: [{ role: "battery", perUnit: 1 }], drivers: [{ role: "leasing", weight: 0.5 }, { role: "charging", weight: 0.5 }],
  },
  {
    key: "battery", name: "Battery manufacturing", product: "battery packs", blurb: "Makes battery packs for vehicle makers, swap stations and service centres. Needs recycled material.",
    basePrice: 2000, unitCost: 600, fixedCost: 45000, startCapacity: 220, capexPerUnit: 1500, refDemand: 80, elasticity: 1.8,
    inputs: [{ role: "recycling", perUnit: 1 }], drivers: [{ role: "ev_maker", weight: 1 }],
  },
  {
    key: "charging", name: "Charging infrastructure", product: "charging blocks (1,000 sessions)", blurb: "Runs public charging hubs. Demand grows with the number of EVs and fleets on the road.",
    basePrice: 1500, unitCost: 450, fixedCost: 65000, startCapacity: 140, capexPerUnit: 3500, refDemand: 120, elasticity: 2.0,
    inputs: [{ role: "software", perUnit: 0.1 }], drivers: [{ role: "ev_maker", weight: 0.5 }, { role: "fleet", weight: 0.5 }],
  },
  {
    key: "swapping", name: "Battery swapping", product: "swap blocks (100 swaps)", blurb: "Operates swap stations for two- and three-wheelers. Keeps a stock of battery packs.",
    basePrice: 1250, unitCost: 350, fixedCost: 26000, startCapacity: 160, capexPerUnit: 2500, refDemand: 140, elasticity: 2.0,
    inputs: [{ role: "battery", perUnit: 0.2 }], drivers: [{ role: "delivery", weight: 0.6 }, { role: "fleet", weight: 0.4 }],
  },
  {
    key: "fleet", name: "EV fleet operations", product: "fleet blocks (1,000 km)", blurb: "Runs a ride-hailing and logistics fleet. Leases vehicles, charges them and keeps them serviced.",
    basePrice: 2500, unitCost: 450, fixedCost: 80000, startCapacity: 180, capexPerUnit: 4000, refDemand: 160, elasticity: 2.0,
    inputs: [{ role: "leasing", perUnit: 0.2 }, { role: "charging", perUnit: 0.25 }, { role: "maintenance", perUnit: 0.15 }, { role: "software", perUnit: 0.1 }],
    drivers: [{ role: "charging", weight: 1 }],
  },
  {
    key: "delivery", name: "Last-mile delivery", product: "delivery blocks (100 orders)", blurb: "Delivers parcels and food. Hires fleet capacity and depends on fast battery swaps.",
    basePrice: 2000, unitCost: 400, fixedCost: 70000, startCapacity: 220, capexPerUnit: 3000, refDemand: 200, elasticity: 2.2,
    inputs: [{ role: "fleet", perUnit: 0.2 }, { role: "swapping", perUnit: 0.25 }, { role: "software", perUnit: 0.05 }],
    drivers: [{ role: "swapping", weight: 1 }],
  },
  {
    key: "leasing", name: "Vehicle leasing & financing", product: "lease-quarters", blurb: "Buys vehicles and leases them to fleets and households. Lives on spreads and utilisation.",
    basePrice: 2000, unitCost: 150, fixedCost: 40000, startCapacity: 170, capexPerUnit: 2500, refDemand: 150, elasticity: 1.8,
    inputs: [{ role: "ev_maker", perUnit: 0.2 }], drivers: [{ role: "ev_maker", weight: 0.6 }, { role: "fleet", weight: 0.4 }],
  },
  {
    key: "recycling", name: "Battery recycling", product: "material lots", blurb: "Recovers lithium, nickel and cobalt from used packs and sells material back to battery makers.",
    basePrice: 500, unitCost: 180, fixedCost: 34000, startCapacity: 320, capexPerUnit: 800, refDemand: 150, elasticity: 1.6,
    inputs: [], drivers: [{ role: "battery", weight: 0.7 }, { role: "ev_maker", weight: 0.3 }],
  },
  {
    key: "software", name: "Fleet management software", product: "subscriptions", blurb: "Sells routing, telematics and charging-optimisation software to operators. High fixed cost, tiny unit cost.",
    basePrice: 900, unitCost: 80, fixedCost: 110000, startCapacity: 400, capexPerUnit: 600, refDemand: 180, elasticity: 1.8,
    inputs: [], drivers: [{ role: "fleet", weight: 0.5 }, { role: "delivery", weight: 0.5 }],
  },
  {
    key: "maintenance", name: "EV maintenance & servicing", product: "service jobs", blurb: "Services vehicles for households and fleets. Uses battery packs for replacements.",
    basePrice: 1000, unitCost: 300, fixedCost: 55000, startCapacity: 200, capexPerUnit: 2000, refDemand: 180, elasticity: 2.0,
    inputs: [{ role: "battery", perUnit: 0.08 }], drivers: [{ role: "ev_maker", weight: 0.5 }, { role: "fleet", weight: 0.5 }],
  },
];

const EV_EVENTS: EventPreset[] = [
  { key: "lithium", title: "Lithium supply shock", description: "Export curbs in a major producing country tighten lithium supply. Battery inputs get expensive and recycled material is in demand.", effects: { spot: { battery: 1.4, recycling: 1.3 }, cost: { battery: 1.15 }, demand: { recycling: 1.3 } } },
  { key: "rates", title: "Interest rate hike", description: "The central bank raises rates by 3 percentage points to fight inflation. Borrowing costs rise for the rest of the game.", effects: { interestDelta: 3, demand: { leasing: 0.9 } } },
  { key: "subsidy", title: "EV purchase subsidy", description: "The government extends purchase subsidies for electric vehicles. Retail demand for EVs and leases jumps.", effects: { demand: { ev_maker: 1.15, leasing: 1.1 }, adoptionDelta: 0.05 } },
  { key: "shared", title: "Shift to shared mobility", description: "Commuters move from owning to sharing. Fleets and deliveries grow; private EV purchases soften.", effects: { demand: { fleet: 1.2, delivery: 1.1, ev_maker: 0.9 } } },
  { key: "fuel", title: "Petrol price spike", description: "Fuel prices jump 20%. Every part of the EV ecosystem gains customers.", effects: { demand: { "*": 1.1 }, adoptionDelta: 0.1 } },
  { key: "grid", title: "Grid outages", description: "Summer power cuts hit charging hubs. Charging demand falls and swap stations pick up the slack.", effects: { demand: { charging: 0.75, swapping: 1.2 } } },
  { key: "slowdown", title: "Economic slowdown", description: "Consumer spending cools across the board.", effects: { demand: { "*": 0.85 }, adoptionDelta: -0.05 } },
  { key: "chips", title: "Chip shortage", description: "Semiconductor delays raise vehicle and software costs for one cycle.", effects: { cost: { ev_maker: 1.2, software: 1.15 }, spot: { ev_maker: 1.15 } } },
];

export const EV_TEMPLATE: EconomyConfig = {
  industry: "Electric Mobility",
  tagline: "Ten startups, one EV economy. Build your business, negotiate with the others, and adapt as the market moves.",
  cycles: 5,
  cycleNames: ["Establishment", "Market activity", "Competition", "Economic disruption", "Adaptation & settlement"],
  cycleMinutes: 15,
  autoAdvance: true,
  startCash: 1_000_000,
  creditLimit: 1_500_000,
  interestRate: 10,
  emergencyFeePct: 5,
  spotMarkup: 1.15,
  contractPenaltyPct: 20,
  holdingCostPct: 5,
  minPriceFactor: 0.3,
  maxPriceFactor: 3,
  marketingRef: 40_000,
  qualityRef: 40_000,
  researchCost: 25_000,
  scoring: DEFAULT_SCORING,
  roles: EV_ROLES,
  scheduledEvents: [
    { cycle: 2, title: EV_EVENTS[2].title, description: EV_EVENTS[2].description, effects: EV_EVENTS[2].effects },
    { cycle: 4, title: EV_EVENTS[0].title, description: EV_EVENTS[0].description, effects: EV_EVENTS[0].effects },
    { cycle: 4, title: EV_EVENTS[1].title, description: EV_EVENTS[1].description, effects: EV_EVENTS[1].effects },
  ],
  eventLibrary: EV_EVENTS,
};

export const TEMPLATES: Record<string, { label: string; config: EconomyConfig }> = {
  "ev-mobility": { label: "Electric Mobility (10 startups)", config: EV_TEMPLATE },
};

export function roleOf(cfg: EconomyConfig, key: string) {
  return cfg.roles.find((r) => r.key === key);
}

/** Can a startup of role `sellerRole` sell its output to `buyerRole`? Only when the buyer uses it as an input. */
export function inputNeed(cfg: EconomyConfig, sellerRole: string, buyerRole: string) {
  return roleOf(cfg, buyerRole)?.inputs.find((i) => i.role === sellerRole) ?? null;
}

export function spotPrice(cfg: EconomyConfig, roleKey: string, mult = 1) {
  const r = roleOf(cfg, roleKey);
  return r ? r.basePrice * cfg.spotMarkup * mult : 0;
}

export function cycleName(cfg: EconomyConfig, cycle: number) {
  return cfg.cycleNames[cycle - 1] ?? `Cycle ${cycle}`;
}

/** Segment demand grows less than linearly when several startups share a role. */
export function segmentScale(ventures: number) {
  return ventures <= 1 ? 1 : 1 + 0.6 * (ventures - 1);
}

/** Sensible starting decision: base price, produce your share of reference demand. */
export function defaultDecision(role: RoleDef, capacity: number, ventures = 1): Decision {
  const share = (role.refDemand * segmentScale(ventures)) / Math.max(1, ventures);
  return { price: role.basePrice, production: Math.min(capacity, Math.round(share)), capacityInvest: 0, marketing: 20_000, quality: 10_000, borrow: 0, repay: 0 };
}

/** ₹ with lakh formatting for big numbers. */
export function money(n: number, compact = true) {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (compact && a >= 100_000) return `${sign}₹${(a / 100_000).toFixed(2)}L`;
  return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
}

export function num(n: number, digits = 0) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function parseConfig(raw: string | null | undefined): EconomyConfig {
  try {
    const c = JSON.parse(raw ?? "") as Partial<EconomyConfig>;
    return { ...EV_TEMPLATE, ...c, scoring: { ...DEFAULT_SCORING, ...(c.scoring ?? {}) } } as EconomyConfig;
  } catch {
    return EV_TEMPLATE;
  }
}
