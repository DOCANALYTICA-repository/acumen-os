# Round 4 simulation: what the computer calculates

This is a reference for organisers. It lists every calculation and automation the economy simulation
runs, from the setup auction to the final marks. The code lives in `src/lib/sim/` (`engine.ts` for the
yearly maths, `model.ts` for the template and helpers, `service.ts` for the auction, timing and saving).

Teams only make decisions and sign deals. Organisers run the controls. Everything else is calculated on
the server, and the same inputs always give the same results.

Amounts below are the defaults of the electric-mobility template. Organisers can change them in
**Round settings** or the JSON editor on the simulation control page.

---

## 1. Setup auction

**Bidding rules the computer enforces**

- **Budget:** every team starts with ₹12,00,000.
- **Minimum bid:** the reserve price for the first bid (₹50,000 for an identity, ₹30,000–45,000 for a
  resource), then the current highest bid plus ₹5,000.
- **Bid limit:** a team can't bid more than its remaining budget. A team without an identity must also
  keep ₹50,000 aside when it bids on resources.
- **Rejected bids:** a second identity, a bid on a closed or expired lot, and a bid when the team
  already holds the top bid.
- **Soft close:** a bid in the final seconds moves the lot's closing time to 10 seconds after that bid.

**When a lot closes:** the highest bidder wins and pays its bid. Lots whose timer has run out close
automatically the next time anyone loads the page.

**Finishing the auction**

- Teams without an identity get a leftover one at the reserve price. The order uses a fixed, seeded
  shuffle, so it repeats exactly.
- If no identities are left, the team shares the least crowded industry.
- Each company starts with:
  - **Cash:** its unspent budget.
  - **Scores:** Technology, Brand, Customer satisfaction and Employee satisfaction all start at 50,
    plus any resource bonuses.
  - **Capacity:** the industry's starting capacity, adjusted by the Industrial land bank bonus.

**Resource bonuses**

| Resource | Lasting effect |
|---|---|
| Prime location | +6% demand every year |
| Patent portfolio | +15 Technology |
| Power purchase agreement | Unit costs −6% |
| Skilled workforce | +15 Employee satisfaction, unit costs −2% |
| Brand ambassador | +15 Brand |
| Industrial land bank | +15% capacity |
| Fast-track permits | Fixed costs −10% |
| Customer data platform | +12 Customer satisfaction |

**Starting equity** is what return on investment is measured against later:
the full ₹12L budget + half the value of the company's capacity (capacity × cost per unit of capacity
× 0.5). Money spent at auction therefore counts as an investment, not a loss.

**Skipping the auction:** identities are dealt round-robin in a seeded random order, and every team
keeps the full ₹12L.

---

## 2. Checking each year's decision

A team sets its price, production, new capacity, bank borrowing and repayment, and six spending areas:
marketing, sales, customer service, employee welfare, technology and sustainability.

| Input | Allowed range |
|---|---|
| Price | 30%–300% of the industry's base price × the price level |
| Production | Up to current capacity |
| New capacity | Up to the industry's starting capacity in one year |
| Borrowing | Up to the ₹15L credit limit, minus existing debt |
| Repayment | Up to current debt |
| Each spending area | Up to 10 × the reference amount |

**Reference spending amount:** 5% of the industry's base price × base demand
(₹30,000 for EV manufacturing, ₹8,000 for battery manufacturing).

**Standard plan:** 40% of the reference in each area, and half that for sustainability. Spending at
this level keeps every score near 50.

**If a team doesn't submit**

- **In a later year:** last year's plan carries over. Price and spending rise by last year's
  inflation; there is no new capacity, borrowing or repayment.
- **In the first year:** the team gets the standard plan, with production covering any supply
  contracts it owes.

---

## 3. Production

- **Effective capacity** = capacity × (0.85 + 0.15 × min(1, Employee satisfaction ÷ 50)).
  Below 50 Employee satisfaction, a company loses up to 15% of its output.
- **Units produced** = the smaller of planned production and effective capacity.
- New capacity bought this year comes online next year.

---

## 4. Deals between companies

**Supply contracts**

- Sellers fill contracts before selling on the open market.
- If a seller is short, every buyer gets the same percentage of what it ordered.
- The seller pays a penalty of 20% of the value of the undelivered units; the buyer receives it.
- The seller earns units delivered × agreed price; the buyer pays the same as an input cost.

**Licences**

- The licensee pays a yearly fee to the licensor.
- The licensee's Technology target rises by the larger of 5 and 60% of the technology gap between them.

**Loans between companies**

- Year 1: the principal moves from lender to borrower.
- Every year: interest on the outstanding balance plus an equal share of the principal is repaid.

**Co-marketing alliances**

- Each partner pays its yearly fee.
- That fee counts as 1.5 times its value in marketing spend.
- Each partner gets +3% demand.

**Deal value for the Top deal-maker award:** supply = units × price × years; loan = principal;
licence or alliance = fee × years.

---

## 5. Market demand and market share

Calculated separately for each industry that has at least one team.

**Total demand** =
base demand × crowding factor × market size × EV adoption × consumer confidence × event effects ×
link to related industries ÷ (1 − 0.35)

- **Crowding factor:** 1 + 0.6 × (number of teams − 1). More teams grow the market, but less than
  proportionally.
- **Market size:** starts at 1 and grows by GDP growth each year.
- **Consumer confidence:** (1 + (GDP growth − 4) ÷ 25) × event effects, kept between 0.6 and 1.4.
- **Link to related industries:** 0.6 + 0.4 × how well those industries served their customers last
  year. For example, EV demand rises with leasing and charging activity.
- **÷ (1 − 0.35):** makes room for the simulated established competitor.

**How attractive each company is**

| Factor | Formula |
|---|---|
| Price | (price ÷ market price) ^ (−elasticity), elasticity 1.8–2.0 by industry |
| Product | (0.6 + 0.8 × Technology/100)^0.7 × (0.7 + 0.6 × Customer satisfaction/100) |
| Brand | 0.6 + 0.8 × Brand/100 |
| Marketing | 1 + 0.25 × ln(1 + marketing ÷ reference) × confidence |
| Sales force | 1 + 0.3 × (1 − e^(−1.5 × sales ÷ reference)) |
| Bonuses | Location bonus × alliance bonus |

The six factors are multiplied together and the result is raised to the power 1.8. That widens the
gaps, so the best offer pulls ahead.

**Established competitor:** every market has a simulated competitor that plays at the industry
standard (market price, scores of 50, standard spending). It takes about 35% of the market when the
teams also play at the standard.

- **Each company's demand** = total demand × its weight ÷ (sum of all weights, competitor included).
- **Sales** = the smaller of demand and units available. Unmet demand lowers Customer satisfaction.
- **Market share** = the company's sales ÷ (all team sales + the competitor's sales).

---

## 6. Costs, profit, tax and cash

**Unit cost** = base unit cost × price level × event effects × resource bonuses ×
(1.15 − 0.3 × Employee satisfaction/100) × (1.1 − 0.2 × Technology/100).
Happier staff and better technology make each unit cheaper.

**Inputs not covered by a contract** are bought from outside suppliers at
1.15 × the supplier industry's base price × the price level, adjusted by any supplier-price event.

**Costs counted each year**

- Production: units produced × unit cost
- Inputs: contract inputs plus outside purchases
- Fixed costs: fixed cost × price level × permits bonus
- The six spending areas
- Deals: licence fees, alliance fees and loan interest paid
- Holding stock: 5% a year of the cost value of unsold inventory
- Bank interest: existing debt × interest rate
- Penalties paid on undelivered contract units
- Research reports: ₹25,000 each

**Revenue** = sales × price + contract revenue.

**Profit before tax** = revenue + penalties received + deal income − costs.

**Tax**

- A year's loss goes into a pool that is carried forward.
- Tax = (profit before tax − carried-forward losses used) × tax rate (25% by default).

**Cash** = cash + profit after tax − spending on new capacity + borrowing ± loan flows between
companies − repayment.
If cash would go below zero, the computer takes an emergency loan for the gap and adds a 5% fee to debt.

---

## 7. Company scores (0–100)

**How scores move:** each year a score moves 40% of the way to that year's target:
new = 0.6 × old + 0.4 × target.

**Turning spending into points:** points = 100 × (1 − e^(−1.7 × spending ÷ reference)). Each extra
rupee adds less than the one before. The standard 40% spend gives about 50 points.

| Score | This year's target |
|---|---|
| Technology | technology points + patent bonus + licence boost |
| Employee satisfaction | employee points + 4 + up to 4 from sustainability + resource bonus − 1.5 per inflation point above normal − 3 if producing above 97% of capacity |
| Customer satisfaction | 0.5 × customer-service points + 25 × share of demand served + 0.25 × Technology − overpricing penalty (−10 to +20) + resource bonus |
| Brand | 0.45 × marketing points (alliances included, × confidence) + 0.25 × Customer satisfaction + 0.15 × sustainability points + 0.15 × Technology + resource bonus |
| Contract reliability | 0.6 × old + 0.4 × share of contracted units delivered (0–100%) |

---

## 8. The economy each year

**Events**

- One year only: demand, supplier price, cost and confidence changes apply only in the year the
  event runs.
- Permanent: interest, tax, inflation, GDP and EV adoption changes stay for the rest of the game.
- Saved events are stored without a year. "Run now" copies one into the current year and posts a
  "Breaking:" message to every team.

**Year-end updates**

- Price level × (1 + inflation). Prices, costs and wages all rise with it.
- Market size × (1 + GDP growth).
- EV adoption = 0.7 × old + 0.3 × (actual sales ÷ reference demand), kept between 0.5 and 2.
- Economy share: each company's revenue as a share of everyone's.

**Organiser changes** to the economy apply from the year being decided.

---

## 9. End of game: awards and marks

**Final equity** = cash + half the value of capacity + inventory at cost − debt.

**Return on investment** = (final equity − starting equity) ÷ starting equity.

**Awards (11):** most profitable, highest revenue, highest average market share, best return on
investment, fastest growing (last year's revenue vs year 1's), happiest customers, best employer,
most innovative, strongest brand, top deal-maker and biggest taxpayer.

- Tied teams share the award.
- An award isn't given if everyone ties, or if the best value is zero or below (except market share).

**Marks**

1. For each measure the computer ranks teams from 0 (worst) to 1 (best). Contract reliability is the
   exception: it uses each team's actual 0–1 value.
2. Weights:

   | Measure | Weight |
   |---|---|
   | Return on investment | 35% |
   | Revenue | 15% |
   | Market share | 15% |
   | Average of customer and employee satisfaction | 15% |
   | Brand | 10% |
   | Contract reliability | 10% |

3. Marks = 100 × (0.40 + 0.60 × weighted score). The last-placed team still gets 40.
4. Marks are written to the round's scores and from there to the leaderboard.

---

## 10. Other automation

- **Timer:** each year closes when its clock runs out if auto-advance is on. "Process now" closes it
  straight away; the computer doesn't wait for every team.
- **Research reports:** a rival's figures from its latest year, each changed by up to ±8%. The same
  buyer, rival and year always give the same report.
- **Dry run:** computer-played teams with four strategies (balanced, aggressive, premium, lean) play
  the whole game. It warns when an industry loses more than 25% of its equity, more than doubles it,
  any team needs an emergency loan, or returns are badly unbalanced.
- **Year report notes** for each team, for example "Staffing limited output", "Bought X from outside
  suppliers", "Paid tax after using losses carried forward" or "Emergency loan".

## What people decide

- **Teams:** auction bids, yearly decisions, deal proposals and acceptances, research purchases.
- **Organisers:** opening and closing lots, starting and processing years, creating, saving and
  running events, changing economy settings, adjusting cash, and setting the marking weights.

The only randomness is the seeded shuffle for leftover identities and the research reports' ±8%;
both repeat exactly for the same game.
