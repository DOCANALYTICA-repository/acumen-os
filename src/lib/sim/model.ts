// Types, the default economy template and small helpers for the economy simulation (Round 4).
// Client-safe: no database or server imports.
//
// Shape of the game:
//   1. Setup auction: teams bid from a base budget for a business identity (their industry role)
//      and for resources/attributes that give lasting advantages.
//   2. About five simulated years (one cycle = one year). Every year teams set price, production,
//      capacity and spending levers, and negotiate deals with each other.
//   3. The economy has its own parameters (GDP growth, inflation, tax, interest, confidence) that
//      events and the organisers can move.
//   4. At the end, awards name the most profitable, highest revenue, highest market share, etc.

export type InputNeed = { role: string; perUnit: number };
export type Driver = { role: string; weight: number };

export type RoleDef = {
  key: string;
  name: string; // "EV manufacturing"
  product: string; // unit label, e.g. "vehicles"
  blurb: string;
  basePrice: number; // reference price per unit (₹, year-1 prices)
  unitCost: number; // variable cost per unit, excluding bought-in inputs
  fixedCost: number; // per year
  startCapacity: number; // units per year
  capexPerUnit: number; // cost of adding 1 unit of capacity (online next year)
  refDemand: number; // end-market demand for one startup per year at base price, adoption 1
  elasticity: number; // price elasticity of end-market demand
  inputs: InputNeed[]; // what this business buys from other roles, per unit produced
  drivers: Driver[]; // roles whose activity grows this role's end-market demand
};

/** Lasting advantages a startup can own (won at auction). Multipliers stack by multiplication, points by addition. */
export type Perks = {
  demandMult?: number;
  unitCostMult?: number;
  fixedCostMult?: number;
  capacityMult?: number;
  tech?: number; // index points
  brand?: number;
  customerSat?: number;
  employeeSat?: number;
};

export type AuctionResource = { key: string; name: string; description: string; reserve: number; perks: Perks };

export type AuctionConfig = {
  enabled: boolean;
  identityReserve: number; // reserve price of every identity lot
  minIncrement: number;
  lotSeconds: number; // bidding window once a lot opens; late bids extend it
  extendSeconds: number;
  resources: AuctionResource[];
};

export type EventEffects = {
  demand?: Record<string, number>; // role key or "*" → demand multiplier for that year
  spot?: Record<string, number>; // role key or "*" → supplier price multiplier for that year
  cost?: Record<string, number>; // role key or "*" → unit cost multiplier for that year
  interestDelta?: number; // percentage points, persists
  taxDelta?: number; // percentage points, persists
  inflationDelta?: number; // percentage points, persists
  gdpDelta?: number; // percentage points, persists
  confidence?: number; // consumer-confidence multiplier for that year
  adoptionDelta?: number; // added to the adoption index, persists
};

export type EventPreset = { key: string; title: string; description: string; effects: EventEffects };

export type ScoringConfig = {
  floor: number; // % of max marks the last-placed team still gets
  profit: number; // weight: return on starting equity
  revenue: number;
  marketShare: number;
  satisfaction: number; // average of customer and employee satisfaction
  brand: number;
  reliability: number; // contract delivery record
  maxMarks: number;
};

export type EconomyConfig = {
  industry: string;
  tagline: string;
  cycles: number;
  cycleNames: string[];
  cycleMinutes: number;
  autoAdvance: boolean; // process automatically when the decision window ends
  startCash: number; // base budget per team (auction bids come out of this)
  creditLimit: number; // max bank debt per startup
  interestRate: number; // annual %
  taxRate: number; // corporate tax on profit, %
  inflation: number; // annual %, raises costs (and what customers will accept)
  gdpGrowth: number; // annual %, grows end-market demand
  incumbentShare: number; // share of each market held by simulated incumbents when teams play at par (0–0.8)
  emergencyFeePct: number; // fee on the automatic overdraft loan when cash goes negative
  spotMarkup: number; // simulated suppliers charge basePrice × this
  contractPenaltyPct: number; // seller pays this share of the contract value of undelivered units
  holdingCostPct: number; // per year, on unsold inventory at unit cost
  minPriceFactor: number;
  maxPriceFactor: number;
  leverRefPct: number; // spending reference per lever as % of a role's reference revenue
  researchCost: number;
  auction: AuctionConfig;
  scoring: ScoringConfig;
  roles: RoleDef[];
  scheduledEvents: { cycle: number; title: string; description: string; effects: EventEffects }[];
  eventLibrary: EventPreset[];
};

/** Spending levers set every year (₹). */
export const LEVERS = [
  { key: "marketing", label: "Marketing", hint: "Advertising and promotion. Builds brand and lifts this year's demand; works harder when consumer confidence is high." },
  { key: "sales", label: "Sales force", hint: "Sales team and channel partners. Converts more of the market this year." },
  { key: "customerService", label: "Customer service", hint: "Support, warranties and service quality. Raises customer satisfaction, which keeps customers coming back." },
  { key: "employees", label: "Employee welfare", hint: "Pay, training and benefits. Raises employee satisfaction, which lowers unit costs and keeps capacity running. Inflation erodes it." },
  { key: "technology", label: "Technology & R&D", hint: "Product and process R&D. Raises the technology index: better product and lower unit costs. Slowly goes out of date without investment." },
  { key: "sustainability", label: "Sustainability & CSR", hint: "Green operations and community work. Small boost to brand and employee morale." },
] as const;
export type LeverKey = (typeof LEVERS)[number]["key"];

export type Decision = {
  price: number;
  production: number;
  capacityInvest: number; // units of capacity to add
  borrow: number; // ₹ from the bank
  repay: number; // ₹ to the bank
} & Record<LeverKey, number>;

/** Deals teams can negotiate. The type fixes what the deal does; the numbers are negotiated. */
export const DEAL_KINDS = {
  SUPPLY: { label: "Supply contract", provider: "Seller", receiver: "Buyer", blurb: "The seller delivers units every year at an agreed price. Only for inputs the buyer actually uses. Undelivered units cost the seller a penalty." },
  LICENSE: { label: "Technology licence", provider: "Licensor", receiver: "Licensee", blurb: "The licensee pays a yearly fee; its technology index climbs towards the licensor's." },
  LOAN: { label: "Loan between companies", provider: "Lender", receiver: "Borrower", blurb: "The lender transfers the amount when the deal starts; the borrower repays in equal yearly instalments plus interest." },
  MARKETING: { label: "Co-marketing alliance", provider: "Partner A", receiver: "Partner B", blurb: "Both partners pay the yearly fee into a joint campaign; each gets the brand effect of a bigger campaign and a demand boost." },
} as const;
export type DealKind = keyof typeof DEAL_KINDS;

export type VentureState = {
  companyName: string;
  cash: number;
  debt: number;
  capacity: number;
  pendingCapacity: number;
  inventory: number;
  // indices, 0–100 (50 = industry standard)
  tech: number;
  brand: number;
  customerSat: number;
  employeeSat: number;
  reliability: number; // 0–1, contract delivery record
  perks: Perks;
  assets: string[]; // names of resources owned
  // running totals
  cumProfit: number;
  cumRevenue: number;
  cumTax: number;
  shareSum: number; // sum of yearly market shares (for the average)
  years: number;
  dealValue: number; // ₹ value of deals signed
  lossPool: number; // tax losses carried forward
  startEquity: number;
  pendingCharges: number; // research bought during the year, charged at processing
  lastDecision: Decision | null;
  distress: number; // years that needed an emergency loan
  firstRevenue: number;
  lastRevenue: number;
};

export type RoleMarket = {
  demand: number; // total market incl. incumbents
  teamSales: number;
  incumbentSales: number;
  avgPrice: number;
  output: number;
  spotPrice: number;
  ventures: number;
};

export type MarketState = {
  cycle: number; // last processed year (0 = none)
  adoption: number;
  interestRate: number;
  taxRate: number;
  inflation: number;
  gdpGrowth: number;
  priceLevel: number; // 1 = year-1 prices; × (1 + inflation) every year
  demandIndex: number; // 1 = year-1 market size; × (1 + GDP growth) every year
  confidence: number;
  roles: Record<string, RoleMarket>;
  totalRevenue: number;
};

export type VentureResult = {
  cycle: number;
  price: number;
  produced: number;
  effectiveCapacity: number;
  demand: number;
  endSales: number;
  contractSales: number; // units delivered to other startups
  marketShare: number; // of the whole segment incl. incumbents, 0–1
  economyShare: number; // share of all team revenue this year
  revenue: number;
  costs: {
    production: number;
    contractInputs: number;
    spotInputs: number;
    fixed: number;
    levers: number;
    deals: number; // licence fees, alliance fees, loan interest paid to other teams
    holding: number;
    interest: number;
    penalties: number;
    research: number;
  };
  levers: Record<LeverKey, number>;
  dealIncome: number; // licence fees, loan interest received
  penaltyIncome: number;
  profitBeforeTax: number;
  tax: number;
  profit: number;
  capex: number;
  borrowed: number;
  repaid: number;
  loanFlows: number; // principal received (+) / paid or lent (−) on company loans
  emergencyLoan: number;
  cash: number;
  debt: number;
  capacity: number;
  inventory: number;
  tech: number;
  brand: number;
  customerSat: number;
  employeeSat: number;
  reliability: number;
  equity: number;
  autoCarried: boolean;
  notes: string[];
};

export const DEFAULT_SCORING: ScoringConfig = { floor: 40, profit: 0.35, revenue: 0.15, marketShare: 0.15, satisfaction: 0.15, brand: 0.1, reliability: 0.1, maxMarks: 100 };

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
    key: "leasing", name: "Vehicle leasing & financing", product: "lease-years", blurb: "Buys vehicles and leases them to fleets and households. Lives on spreads and utilisation.",
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

const EV_RESOURCES: AuctionResource[] = [
  { key: "location", name: "Prime city-centre location", description: "Flagship site where customers already are: +6% demand every year.", reserve: 40_000, perks: { demandMult: 1.06 } },
  { key: "patents", name: "Patent portfolio", description: "Core technology patents: +15 technology index.", reserve: 40_000, perks: { tech: 15 } },
  { key: "power", name: "Long-term power purchase agreement", description: "Locked-in cheap renewable power: unit costs −6%.", reserve: 40_000, perks: { unitCostMult: 0.94 } },
  { key: "talent", name: "Skilled workforce pool", description: "Partnership with a top engineering college: +15 employee satisfaction, unit costs −2%.", reserve: 35_000, perks: { employeeSat: 15, unitCostMult: 0.98 } },
  { key: "ambassador", name: "Celebrity brand ambassador", description: "A household name fronts your campaigns: +15 brand.", reserve: 35_000, perks: { brand: 15 } },
  { key: "land", name: "Industrial land bank", description: "Room to grow: +15% capacity from year 1.", reserve: 45_000, perks: { capacityMult: 1.15 } },
  { key: "permits", name: "Fast-track government permits", description: "Less red tape and lower compliance overhead: fixed costs −10%.", reserve: 40_000, perks: { fixedCostMult: 0.9 } },
  { key: "data", name: "Customer data platform", description: "Know your customers: +12 customer satisfaction.", reserve: 30_000, perks: { customerSat: 12 } },
];

const EV_EVENTS: EventPreset[] = [
  { key: "lithium", title: "Lithium supply shock", description: "Export curbs in a major producing country tighten lithium supply. Battery inputs get expensive and recycled material is in demand.", effects: { spot: { battery: 1.4, recycling: 1.3 }, cost: { battery: 1.15 }, demand: { recycling: 1.3 } } },
  { key: "rates", title: "Interest rate hike", description: "The central bank raises rates by 3 percentage points to fight inflation. Borrowing costs rise for the rest of the game.", effects: { interestDelta: 3, demand: { leasing: 0.9 } } },
  { key: "subsidy", title: "EV purchase subsidy", description: "The government extends purchase subsidies for electric vehicles. Retail demand for EVs and leases jumps.", effects: { demand: { ev_maker: 1.15, leasing: 1.1 }, adoptionDelta: 0.05 } },
  { key: "shared", title: "Shift to shared mobility", description: "Commuters move from owning to sharing. Fleets and deliveries grow; private EV purchases soften.", effects: { demand: { fleet: 1.2, delivery: 1.1, ev_maker: 0.9 } } },
  { key: "fuel", title: "Petrol price spike", description: "Fuel prices jump 20%. Every part of the EV ecosystem gains customers.", effects: { demand: { "*": 1.1 }, adoptionDelta: 0.1 } },
  { key: "grid", title: "Grid outages", description: "Summer power cuts hit charging hubs. Charging demand falls and swap stations pick up the slack.", effects: { demand: { charging: 0.75, swapping: 1.2 } } },
  { key: "recession", title: "Recession", description: "GDP growth turns negative and consumers cut back. Demand falls this year and growth stays weaker.", effects: { gdpDelta: -4, confidence: 0.85, adoptionDelta: -0.05 } },
  { key: "boom", title: "Economic boom", description: "Strong growth and rising incomes. Consumers are spending.", effects: { gdpDelta: 3, confidence: 1.12 } },
  { key: "inflation", title: "Inflation spike", description: "Prices across the economy jump. Costs and wages rise faster from now on; staff morale suffers unless pay keeps up.", effects: { inflationDelta: 4 } },
  { key: "taxhike", title: "Corporate tax increase", description: "The government raises corporate tax by 5 percentage points.", effects: { taxDelta: 5 } },
  { key: "taxcut", title: "Green tax incentive", description: "Corporate tax on clean-mobility businesses falls by 5 percentage points.", effects: { taxDelta: -5 } },
  { key: "chips", title: "Chip shortage", description: "Semiconductor delays raise vehicle and software costs for a year.", effects: { cost: { ev_maker: 1.2, software: 1.15 }, spot: { ev_maker: 1.15 } } },
];

export const EV_TEMPLATE: EconomyConfig = {
  industry: "Electric Mobility",
  tagline: "Ten companies, one EV economy. Win your identity at auction, build your business over five years, strike deals with the others, and adapt as the economy moves.",
  cycles: 5,
  cycleNames: ["Year 1 · Establishment", "Year 2 · Market activity", "Year 3 · Competition", "Year 4 · Economic disruption", "Year 5 · Adaptation & settlement"],
  cycleMinutes: 9,
  autoAdvance: true,
  startCash: 1_200_000,
  creditLimit: 1_500_000,
  interestRate: 9,
  taxRate: 25,
  inflation: 5,
  gdpGrowth: 6,
  incumbentShare: 0.35,
  emergencyFeePct: 5,
  spotMarkup: 1.15,
  contractPenaltyPct: 20,
  holdingCostPct: 5,
  minPriceFactor: 0.3,
  maxPriceFactor: 3,
  leverRefPct: 5,
  researchCost: 25_000,
  auction: { enabled: true, identityReserve: 50_000, minIncrement: 5_000, lotSeconds: 45, extendSeconds: 10, resources: EV_RESOURCES },
  scoring: DEFAULT_SCORING,
  roles: EV_ROLES,
  scheduledEvents: [
    { cycle: 2, title: EV_EVENTS[2].title, description: EV_EVENTS[2].description, effects: EV_EVENTS[2].effects },
    { cycle: 3, title: EV_EVENTS[8].title, description: EV_EVENTS[8].description, effects: EV_EVENTS[8].effects },
    { cycle: 4, title: EV_EVENTS[0].title, description: EV_EVENTS[0].description, effects: EV_EVENTS[0].effects },
    { cycle: 4, title: EV_EVENTS[6].title, description: EV_EVENTS[6].description, effects: EV_EVENTS[6].effects },
    { cycle: 5, title: EV_EVENTS[7].title, description: EV_EVENTS[7].description, effects: EV_EVENTS[7].effects },
  ],
  eventLibrary: EV_EVENTS,
};

export const TEMPLATES: Record<string, { label: string; config: EconomyConfig }> = {
  "ev-mobility": { label: "Electric Mobility (10 companies)", config: EV_TEMPLATE },
};

export function roleOf(cfg: EconomyConfig, key: string) {
  return cfg.roles.find((r) => r.key === key);
}

/** Can a startup of role `sellerRole` supply `buyerRole`? Only when the buyer uses it as an input. */
export function inputNeed(cfg: EconomyConfig, sellerRole: string, buyerRole: string) {
  return roleOf(cfg, buyerRole)?.inputs.find((i) => i.role === sellerRole) ?? null;
}

export function spotPrice(cfg: EconomyConfig, roleKey: string, mult = 1, priceLevel = 1) {
  const r = roleOf(cfg, roleKey);
  return r ? r.basePrice * cfg.spotMarkup * mult * priceLevel : 0;
}

export function cycleName(cfg: EconomyConfig, cycle: number) {
  return cfg.cycleNames[cycle - 1] ?? `Year ${cycle}`;
}

/** Spending reference for one lever: leverRefPct of the role's reference revenue. */
export function leverRef(cfg: EconomyConfig, role: RoleDef) {
  return (role.basePrice * role.refDemand * cfg.leverRefPct) / 100;
}

/** Segment size grows less than linearly when several startups share a role. */
export function segmentScale(ventures: number) {
  return ventures <= 1 ? 1 : 1 + 0.6 * (ventures - 1);
}

/** Default spend per lever: 40% of the reference, which keeps every index near the industry standard (50). */
export const DEFAULT_LEVER_SHARE = 0.4;

/** Sensible starting decision: market price, produce your expected share, standard spending. */
export function defaultDecision(cfg: EconomyConfig, role: RoleDef, capacity: number, ventures = 1, priceLevel = 1): Decision {
  const share = (role.refDemand * segmentScale(ventures)) / Math.max(1, ventures);
  const lv = Math.round(leverRef(cfg, role) * DEFAULT_LEVER_SHARE * priceLevel);
  const levers = Object.fromEntries(LEVERS.map((l) => [l.key, l.key === "sustainability" ? Math.round(lv / 2) : lv])) as Record<LeverKey, number>;
  return { price: Math.round(role.basePrice * priceLevel), production: Math.min(capacity, Math.round(share)), capacityInvest: 0, borrow: 0, repay: 0, ...levers };
}

export function leverTotal(d: Pick<Decision, LeverKey>) {
  return LEVERS.reduce((s, l) => s + (d[l.key] ?? 0), 0);
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

export function pct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

export function parseConfig(raw: string | null | undefined): EconomyConfig {
  try {
    const c = JSON.parse(raw ?? "") as Partial<EconomyConfig>;
    return {
      ...EV_TEMPLATE,
      ...c,
      auction: { ...EV_TEMPLATE.auction, ...(c.auction ?? {}) },
      scoring: { ...DEFAULT_SCORING, ...(c.scoring ?? {}) },
    } as EconomyConfig;
  } catch {
    return EV_TEMPLATE;
  }
}

// ---------------- Awards ----------------

/** Final standings metrics for one company. */
export type FinalMetrics = {
  ventureId: string;
  teamName: string;
  companyName: string;
  roleKey: string;
  cumProfit: number;
  cumRevenue: number;
  avgMarketShare: number; // average yearly share of its segment (incl. incumbents)
  equity: number;
  roe: number;
  customerSat: number;
  employeeSat: number;
  tech: number;
  brand: number;
  reliability: number;
  dealValue: number;
  growth: number; // revenue growth from year 1 to the final year
  cumTax: number;
};

export const AWARDS: { key: keyof FinalMetrics; title: string; label: (m: FinalMetrics) => string }[] = [
  { key: "cumProfit", title: "Most profitable", label: (m) => `${money(m.cumProfit)} net profit over the game` },
  { key: "cumRevenue", title: "Highest revenue", label: (m) => `${money(m.cumRevenue)} total revenue` },
  { key: "avgMarketShare", title: "Highest market share", label: (m) => `${pct(m.avgMarketShare)} average share of its market` },
  { key: "roe", title: "Best return on investment", label: (m) => `${pct(m.roe)} return on starting equity` },
  { key: "growth", title: "Fastest growing", label: (m) => `${pct(m.growth, 0)} revenue growth since year 1` },
  { key: "customerSat", title: "Happiest customers", label: (m) => `Customer satisfaction ${Math.round(m.customerSat)}/100` },
  { key: "employeeSat", title: "Best employer", label: (m) => `Employee satisfaction ${Math.round(m.employeeSat)}/100` },
  { key: "tech", title: "Most innovative", label: (m) => `Technology index ${Math.round(m.tech)}/100` },
  { key: "brand", title: "Strongest brand", label: (m) => `Brand ${Math.round(m.brand)}/100` },
  { key: "dealValue", title: "Top deal-maker", label: (m) => `${money(m.dealValue)} of deals signed` },
  { key: "cumTax", title: "Biggest taxpayer", label: (m) => `${money(m.cumTax)} paid in tax` },
];
