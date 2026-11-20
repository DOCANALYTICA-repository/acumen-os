import Link from "next/link";
import { notFound } from "next/navigation";
import { db, parseJson } from "@/lib/db";
import { dryRun } from "@/lib/sim/engine";
import { DEAL_KINDS, cycleName, describeEffects, money, num, parseConfig, pct, roleOf, TEMPLATES, type DealKind, type VentureResult } from "@/lib/sim/model";
import { auctionWallet, eligibleTeams, finalStandings, marketState, maybeAdvance, ventureState } from "@/lib/sim/service";
import {
  simAddEvent, simAdjustCash, simAutoAssign, simBroadcast, simCloseLot, simCreate, simDeleteEvent, simExtend, simFinishAuction, simLoadTemplate,
  simOpenLot, simPause, simPrepareAuction, simProcess, simRescore, simReset, simResume, simRunSavedEvent, simSaveBasics, simSaveJson, simSetEconomy, simSetRole, simStart,
} from "@/app/actions/sim-admin";
import { Alert, Badge, Card, Field, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LiveClock } from "./live-clock";

const STATUS_TONE = { SETUP: "gray", AUCTION: "blue", READY: "blue", OPEN: "green", PROCESSING: "amber", PAUSED: "amber", FINISHED: "blue" } as const;
const STATUS_LABEL: Record<string, string> = {
  SETUP: "Setting up", AUCTION: "Setup auction", READY: "Identities set, waiting to start", OPEN: "Year open", PROCESSING: "Processing", PAUSED: "Paused", FINISHED: "Finished",
};

export default async function SimControl({ params, searchParams }: { params: Promise<{ roundId: string }>; searchParams: Promise<{ dry?: string }> }) {
  const { roundId } = await params;
  const { dry } = await searchParams;
  const round = await db.round.findUnique({ where: { id: roundId }, include: { economy: true } });
  if (!round || round.type !== "SIMULATION") notFound();

  if (!round.economy) {
    return (
      <>
        <PageHeader title={round.name} subtitle="Simulation control room" />
        <Card title="Create the economy">
          <p className="mb-4 text-sm text-muted">Start from a template. You can edit every number before identities are handed out.</p>
          <form action={simCreate} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="roundId" value={round.id} />
            <select name="template" className={`${cls.input} max-w-xs`}>
              {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
            <SubmitButton>Create economy</SubmitButton>
          </form>
        </Card>
      </>
    );
  }

  await maybeAdvance(round.economy.id);
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: round.economy.id }, include: { ventures: { include: { team: true }, orderBy: { roleKey: "asc" } } } });
  const cfg = parseConfig(econ.config);
  const [decisions, contracts, allEvents, messages, snapshots, eligible, lots] = await Promise.all([
    db.simDecision.findMany({ where: { economyId: econ.id, cycle: econ.currentCycle } }),
    db.simContract.findMany({ where: { economyId: econ.id }, orderBy: { createdAt: "desc" } }),
    db.simEvent.findMany({ where: { economyId: econ.id }, orderBy: [{ cycle: "asc" }, { createdAt: "asc" }] }),
    db.simMessage.findMany({ where: { economyId: econ.id }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.simSnapshot.findMany({ where: { economyId: econ.id, NOT: { ventureId: "MARKET" } }, orderBy: { cycle: "asc" } }),
    econ.status === "SETUP" || econ.status === "READY" ? eligibleTeams(round.id) : Promise.resolve([]),
    db.simAuctionLot.findMany({ where: { economyId: econ.id }, orderBy: { order: "asc" }, include: { bids: { orderBy: [{ amount: "desc" }, { createdAt: "asc" }], take: 1 }, _count: { select: { bids: true } } } }),
  ]);
  const economy = marketState(econ.market, cfg);
  const lastResult = new Map<string, VentureResult>();
  for (const s of snapshots) lastResult.set(s.ventureId, parseJson<VentureResult>(s.data, {} as VentureResult));
  const teamName = (ventureId: string | null) => (ventureId === null ? "Organisers" : econ.ventures.find((v) => v.id === ventureId)?.team.name ?? "?");
  const running = econ.status === "OPEN" || econ.status === "PAUSED";
  const events = allEvents.filter((e) => e.status !== "SAVED");
  const savedEvents = allEvents.filter((e) => e.status === "SAVED");
  const canRunEvents = running;
  const beforeStart = econ.status === "SETUP" || econ.status === "READY";
  const openLot = lots.find((l) => l.status === "OPEN");
  const standings = econ.status === "FINISHED" ? await finalStandings(econ.id) : null;
  const report = dry ? dryRun(cfg, Math.min(40, Math.max(2, Number(dry) || cfg.roles.length))) : null;
  const hidden = <input type="hidden" name="economyId" value={econ.id} />;

  return (
    <>
      <PageHeader
        title={`${round.name}: control room`}
        subtitle={<>{cfg.industry} · <Badge tone={STATUS_TONE[econ.status as keyof typeof STATUS_TONE] ?? "gray"}>{STATUS_LABEL[econ.status] ?? econ.status}</Badge>{running && <> · {cycleName(cfg, econ.currentCycle)}</>}</>}
        actions={<Link href={`/admin/rounds/${round.id}`} className={`${cls.btn} ${cls.secondary}`}>Round settings</Link>}
      />

      {/* ---------- Main controls ---------- */}
      <Card title="Controls" className="mb-6">
        {econ.status === "SETUP" && (
          <div className="space-y-4">
            <p className="text-sm text-ink/80">{eligible.length} eligible teams (paid{round.restrictToQualified ? ", qualified" : ""}). Start with the setup auction, or skip it and hand out identities automatically.</p>
            <div className="flex flex-wrap gap-3">
              <form action={simPrepareAuction}>{hidden}<SubmitButton pendingText="Preparing…" confirm="Set up the auction? Every eligible team joins with the base budget.">Set up the auction</SubmitButton></form>
              <form action={simAutoAssign}>{hidden}<SubmitButton variant="secondary" pendingText="Assigning…">Skip auction: auto-assign identities</SubmitButton></form>
            </div>
          </div>
        )}

        {econ.status === "AUCTION" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              {openLot ? (
                <div className="flex-1 rounded-xl border border-sky-200 bg-sky-50 p-3">
                  <div className="text-xs text-muted">Bidding now</div>
                  <div className="text-lg font-bold text-ink">{openLot.name}</div>
                  <div className="text-sm">Highest: {openLot.bids[0] ? `${money(openLot.bids[0].amount, false)} by ${teamName(openLot.bids[0].ventureId)}` : "no bids"} · {openLot._count.bids} bids</div>
                </div>
              ) : <p className="flex-1 text-sm text-muted">No lot open. Open the next one below.</p>}
              <LiveClock endsAt={openLot?.endsAt?.getTime() ?? null} refreshMs={openLot ? 2000 : 4000} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={cls.th}>Lot</th><th className={cls.th}>Reserve</th><th className={cls.th}>Status</th><th className={cls.th}>Result</th><th className={cls.th}></th></tr></thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.id} className={`border-t border-line ${l.status === "OPEN" ? "bg-sky-50" : ""}`}>
                      <td className={cls.td}><div className="font-medium">{l.name}</div><div className="text-xs text-muted">{l.kind === "IDENTITY" ? "Identity" : "Resource"}</div></td>
                      <td className={cls.td}>{money(l.reserve)}</td>
                      <td className={cls.td}><Badge tone={l.status === "SOLD" ? "green" : l.status === "OPEN" ? "blue" : l.status === "UNSOLD" ? "amber" : "gray"}>{l.status.toLowerCase()}</Badge></td>
                      <td className={cls.td}>{l.winnerId ? `${teamName(l.winnerId)} · ${money(l.price ?? 0)}` : "—"}</td>
                      <td className={cls.td}>
                        {l.status === "OPEN"
                          ? <form action={simCloseLot}><input type="hidden" name="lotId" value={l.id} /><SubmitButton variant="secondary" className="px-3 py-1 text-xs">Close now</SubmitButton></form>
                          : (l.status === "PENDING" || l.status === "UNSOLD") && !openLot
                            ? <form action={simOpenLot}><input type="hidden" name="lotId" value={l.id} /><SubmitButton className="px-3 py-1 text-xs">{l.status === "UNSOLD" ? "Re-open" : "Open bidding"}</SubmitButton></form>
                            : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Lots close {cfg.auction.lotSeconds}s after opening (late bids extend by {cfg.auction.extendSeconds}s). Teams without an identity at the end get a leftover one at the reserve price.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Budget left</th><th className={cls.th}>Won</th></tr></thead>
                <tbody>
                  {econ.ventures.map((v) => (
                    <tr key={v.id} className="border-t border-line">
                      <td className={cls.td}>{v.team.name}</td>
                      <td className={cls.td}>{money(auctionWallet(v.state))}</td>
                      <td className={`${cls.td} text-xs`}>{lots.filter((l) => l.winnerId === v.id).map((l) => l.name).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form action={simFinishAuction}>{hidden}<SubmitButton confirm="Finish the auction? Open lots close now and teams without an identity get a leftover one.">Finish auction</SubmitButton></form>
          </div>
        )}

        {econ.status === "READY" && (
          <div className="space-y-4">
            <p className="text-sm text-ink/80">Every team has an identity. Check the assignments below, then start year 1. Each year lasts {cfg.cycleMinutes} minutes ({cfg.cycles} years ≈ {cfg.cycles * cfg.cycleMinutes} minutes).</p>
            <div className="flex flex-wrap gap-3">
              <form action={simStart}>{hidden}<SubmitButton pendingText="Starting…" confirm="Start year 1? The decision clock starts for every team.">Start year 1</SubmitButton></form>
              <form action={simAutoAssign}>{hidden}<SubmitButton variant="secondary" confirm="Re-assign every identity automatically? Auction results are discarded.">Re-assign automatically</SubmitButton></form>
            </div>
          </div>
        )}

        {(running || econ.status === "PROCESSING") && (
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs text-muted">{econ.status === "PAUSED" ? "Paused with" : "Decisions close in"}</div>
              {econ.status === "PAUSED" ? <span className="font-mono text-2xl font-bold">{Math.ceil((econ.pausedMs ?? 0) / 60000)} min</span> : <LiveClock endsAt={econ.cycleEndsAt?.getTime() ?? null} />}
              <div className="text-xs text-muted">{decisions.length} of {econ.ventures.length} decisions in · auto-advance {cfg.autoAdvance ? "on" : "off"}</div>
            </div>
            <form action={simProcess}>{hidden}<SubmitButton pendingText="Processing…" confirm={`Process year ${econ.currentCycle} now? Teams that have not decided carry last year's plan forward.`}>Process year {econ.currentCycle} now</SubmitButton></form>
            {econ.status === "OPEN" && <form action={simPause}>{hidden}<SubmitButton variant="secondary">Pause</SubmitButton></form>}
            {econ.status === "PAUSED" && <form action={simResume}>{hidden}<SubmitButton variant="secondary">Resume</SubmitButton></form>}
            <form action={simExtend} className="flex items-end gap-2">{hidden}<input name="minutes" type="number" defaultValue={2} className={`${cls.input} w-20`} aria-label="Minutes to add" /><SubmitButton variant="secondary">Add minutes</SubmitButton></form>
          </div>
        )}

        {econ.status === "FINISHED" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink/80">All {cfg.cycles} years are processed and marks are written to results.</p>
            <form action={simRescore}>{hidden}<SubmitButton variant="secondary">Recalculate marks</SubmitButton></form>
          </div>
        )}

        {econ.status !== "SETUP" && (
          <form action={simReset} className="mt-6 border-t border-line pt-4">{hidden}<SubmitButton variant="danger" confirm="Reset the whole simulation? This deletes identities, auction results, decisions, deals, messages, results and this round's marks. It cannot be undone.">Reset simulation</SubmitButton></form>
        )}
      </Card>

      {/* ---------- Economy and broadcast ---------- */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Economy">
          <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
            <div><div className="text-xs text-muted">Price level</div>{((economy.priceLevel - 1) * 100).toFixed(1)}% above Y1</div>
            <div><div className="text-xs text-muted">Market size</div>{((economy.demandIndex - 1) * 100).toFixed(1)}% above Y1</div>
            <div><div className="text-xs text-muted">Confidence / adoption</div>{economy.confidence.toFixed(2)} / {economy.adoption.toFixed(2)}</div>
          </div>
          {econ.status === "FINISHED" ? <p className="text-sm text-muted">The economy is closed.</p> : (
            <form action={simSetEconomy} className="space-y-3">
              {hidden}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Interest %"><input name="interestRate" type="number" step="0.25" defaultValue={economy.interestRate} className={cls.input} /></Field>
                <Field label="Corporate tax %"><input name="taxRate" type="number" step="0.5" defaultValue={economy.taxRate} className={cls.input} /></Field>
                <Field label="Inflation %"><input name="inflation" type="number" step="0.5" defaultValue={economy.inflation} className={cls.input} /></Field>
                <Field label="GDP growth %"><input name="gdpGrowth" type="number" step="0.5" defaultValue={economy.gdpGrowth} className={cls.input} /></Field>
              </div>
              <Field label="Announcement (optional)"><input name="note" className={cls.input} placeholder="e.g. The central bank surprises markets." /></Field>
              <SubmitButton variant="secondary">Apply and announce</SubmitButton>
              <p className="text-xs text-muted">Applies from the year being decided now. Every team sees the announcement.</p>
            </form>
          )}
        </Card>
        <Card title="Broadcast">
          <form action={simBroadcast} className="space-y-3">
            {hidden}
            <textarea name="body" rows={3} maxLength={1000} className={cls.input} placeholder="Message to every team" aria-label="Broadcast message" />
            <SubmitButton variant="secondary">Send to everyone</SubmitButton>
          </form>
        </Card>
      </div>

      {/* ---------- Companies ---------- */}
      {econ.ventures.length > 0 && econ.status !== "AUCTION" && (
        <Card title={`Companies (${econ.ventures.length})`} className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={cls.th}>Team / company</th><th className={cls.th}>Identity</th><th className={cls.th}>Cash</th><th className={cls.th}>Debt</th><th className={cls.th}>Profit to date</th>
                  <th className={cls.th}>Share</th><th className={cls.th}>Tech · Brand · Cust · Emp</th>{running && <th className={cls.th}>Decided</th>}<th className={cls.th}>Adjust cash</th>
                </tr>
              </thead>
              <tbody>
                {econ.ventures.map((v) => {
                  const st = ventureState(v.state);
                  const last = lastResult.get(v.id);
                  return (
                    <tr key={v.id} className="border-t border-line align-top">
                      <td className={cls.td}><div className="font-medium">{v.team.name}</div><div className="text-xs text-muted">{st?.companyName || "—"}</div>{st?.assets.length ? <div className="text-xs text-muted">{st.assets.join(", ")}</div> : null}</td>
                      <td className={cls.td}>
                        {beforeStart ? (
                          <form action={simSetRole} className="flex gap-1">
                            {hidden}<input type="hidden" name="teamId" value={v.teamId} />
                            <select name="roleKey" defaultValue={v.roleKey} className={`${cls.input} py-1 text-xs`} aria-label={`Identity for ${v.team.name}`}>
                              <option value="">— remove —</option>
                              {cfg.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                            </select>
                            <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Set</SubmitButton>
                          </form>
                        ) : roleOf(cfg, v.roleKey)?.name}
                      </td>
                      <td className={`${cls.td} tabular-nums`}>{st ? money(st.cash) : "—"}</td>
                      <td className={`${cls.td} tabular-nums`}>{st ? money(st.debt) : "—"}</td>
                      <td className={`${cls.td} tabular-nums`}>{st ? money(st.cumProfit) : "—"}</td>
                      <td className={`${cls.td} tabular-nums`}>{last ? pct(last.marketShare) : "—"}</td>
                      <td className={`${cls.td} tabular-nums text-xs`}>{st ? `${Math.round(st.tech)} · ${Math.round(st.brand)} · ${Math.round(st.customerSat)} · ${Math.round(st.employeeSat)}` : "—"}</td>
                      {running && <td className={cls.td}>{decisions.some((d) => d.ventureId === v.id) ? <Badge tone="green">yes</Badge> : <Badge tone="amber">no</Badge>}</td>}
                      <td className={cls.td}>
                        <form action={simAdjustCash} className="flex flex-wrap gap-1">
                          <input type="hidden" name="ventureId" value={v.id} />
                          <input name="amount" type="number" placeholder="±₹" className={`${cls.input} w-24 py-1`} aria-label={`Cash adjustment for ${v.team.name}`} />
                          <input name="reason" placeholder="Reason" className={`${cls.input} w-28 py-1`} aria-label="Reason" />
                          <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Apply</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {beforeStart && eligible.length > econ.ventures.length && <p className="mt-3 text-xs text-amber-800">{eligible.length - econ.ventures.length} eligible team(s) are not in the economy yet. Re-run the auction setup or auto-assign to include them.</p>}
        </Card>
      )}

      {/* ---------- Final results ---------- */}
      {standings && (
        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <Card title="Awards">
            <ul className="space-y-2 text-sm">
              {standings.awards.map((a) => <li key={a.title}><strong>{a.title}:</strong> {a.winners.map((w) => w.name).join(" & ")} <span className="text-muted">({a.label})</span></li>)}
            </ul>
          </Card>
          <Card title="Final standings and marks">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={cls.th}>Company</th><th className={cls.th}>Profit</th><th className={cls.th}>Revenue</th><th className={cls.th}>Share</th><th className={cls.th}>ROE</th><th className={cls.th}>Marks</th></tr></thead>
                <tbody>
                  {[...standings.metrics]
                    .sort((a, b) => (standings.scores.find((s) => s.id === b.ventureId)?.marks ?? 0) - (standings.scores.find((s) => s.id === a.ventureId)?.marks ?? 0))
                    .map((m) => (
                      <tr key={m.ventureId} className="border-t border-line">
                        <td className={cls.td}>{m.companyName || m.teamName}<div className="text-xs text-muted">{m.teamName}</div></td>
                        <td className={cls.td}>{money(m.cumProfit)}</td><td className={cls.td}>{money(m.cumRevenue)}</td><td className={cls.td}>{pct(m.avgMarketShare)}</td><td className={cls.td}>{pct(m.roe)}</td>
                        <td className={`${cls.td} font-semibold`}>{standings.scores.find((s) => s.id === m.ventureId)?.marks}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ---------- Events ---------- */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Saved events (${savedEvents.length})`}>
          <p className="mb-3 text-xs text-muted">
            Prepare events in advance with “Save for later”. During an open year, “Run now” announces one to every team at once; it takes effect when that year is processed. Saved events stay here, so you can run them again.
          </p>
          {savedEvents.length === 0 ? <p className="text-sm text-muted">No saved events yet.</p> : (
            <ul className="space-y-2 text-sm">
              {savedEvents.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-2">
                  <div className="min-w-0 flex-1">
                    <strong>{e.title}</strong> {e.firedCycle ? <Badge tone="green">Ran in year {e.firedCycle}</Badge> : null}
                    {e.description && <div className="text-xs text-muted">{e.description}</div>}
                    <div className="text-xs text-ink/80">{describeEffects(cfg, parseJson(e.effects, {}))}</div>
                  </div>
                  <div className="flex gap-1">
                    {canRunEvents && (
                      <form action={simRunSavedEvent}><input type="hidden" name="eventId" value={e.id} /><SubmitButton className="px-3 py-1 text-xs" pendingText="Running…" confirm={`Run “${e.title}” now? Every team sees it immediately and it applies when year ${econ.currentCycle} is processed.`}>Run now</SubmitButton></form>
                    )}
                    <form action={simDeleteEvent}><input type="hidden" name="eventId" value={e.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="Delete this saved event?">Delete</SubmitButton></form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!canRunEvents && savedEvents.length > 0 && <p className="mt-3 text-xs text-muted">“Run now” appears while a year is open for decisions.</p>}
        </Card>
        <Card title={`Scheduled events (${events.length})`}>
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 border-b border-line pb-2">
                <div className="min-w-0"><Badge tone={econ.currentCycle > e.cycle || econ.status === "FINISHED" ? "gray" : "amber"}>Year {e.cycle}</Badge> <strong>{e.title}</strong><div className="text-xs text-muted">{e.description}</div><div className="text-xs text-ink/80">{describeEffects(cfg, parseJson(e.effects, {}))}</div></div>
                {econ.status !== "FINISHED" && (econ.currentCycle === 0 || e.cycle >= econ.currentCycle) && (
                  <form action={simDeleteEvent}><input type="hidden" name="eventId" value={e.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="Delete this event?">Delete</SubmitButton></form>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Create an event" className="xl:col-span-2">
          <form action={simAddEvent} className="space-y-3">
            {hidden}
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Start from a preset">
                <select name="preset" className={cls.input} defaultValue="">
                  <option value="">Custom (fill in below)</option>
                  {cfg.eventLibrary.map((e) => <option key={e.key} value={e.key}>{e.title}</option>)}
                </select>
              </Field>
              <Field label="Headline" hint="Leave empty to use the preset's"><input name="title" className={cls.input} /></Field>
              <Field label="Year (only for “Schedule”)"><input name="cycle" type="number" min={Math.max(1, econ.currentCycle)} max={cfg.cycles} defaultValue={Math.max(1, econ.currentCycle)} className={cls.input} /></Field>
            </div>
            <Field label="What teams read" hint="Leave empty to use the preset's"><textarea name="description" rows={2} className={cls.input} /></Field>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Demand change %"><input name="demandPct" type="number" step="1" placeholder="e.g. -15" className={cls.input} /></Field>
              <Field label="…in market">
                <select name="demandRole" className={cls.input} defaultValue="*"><option value="*">All markets</option>{cfg.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
              </Field>
              <Field label="Unit cost change %"><input name="costPct" type="number" step="1" placeholder="e.g. 10" className={cls.input} /></Field>
              <Field label="…for">
                <select name="costRole" className={cls.input} defaultValue="*"><option value="*">Everyone</option>{cfg.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
              </Field>
              <Field label="Tax rate ± pts"><input name="taxDelta" type="number" step="0.5" className={cls.input} /></Field>
              <Field label="Interest rate ± pts"><input name="interestDelta" type="number" step="0.5" className={cls.input} /></Field>
              <Field label="Inflation ± pts"><input name="inflationDelta" type="number" step="0.5" className={cls.input} /></Field>
              <Field label="GDP growth ± pts"><input name="gdpDelta" type="number" step="0.5" className={cls.input} /></Field>
              <Field label="Consumer confidence %" hint="This year only"><input name="confidencePct" type="number" step="1" placeholder="e.g. -10" className={cls.input} /></Field>
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-brand">Advanced: effects as JSON (overrides the fields above)</summary>
              <div className="mt-2"><input name="effects" placeholder='{"demand": {"*": 0.9}, "taxDelta": 2}' className={cls.input} /></div>
            </details>
            <p className="text-xs text-muted">Demand, cost and confidence changes last for the year the event runs in; tax, interest, inflation and GDP changes persist for the rest of the game.</p>
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="mode" value="save" pendingText="Saving…">Save for later</SubmitButton>
              {econ.status !== "FINISHED" && <SubmitButton name="mode" value="schedule" variant="secondary" pendingText="Scheduling…">Schedule for the year above</SubmitButton>}
            </div>
          </form>
        </Card>
      </div>

      {/* ---------- Deals and messages ---------- */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Deals (${contracts.length})`}>
          <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {contracts.length === 0 && <li className="text-muted">No deals yet.</li>}
            {contracts.map((c) => {
              const k = DEAL_KINDS[c.kind as DealKind] ?? DEAL_KINDS.SUPPLY;
              const terms = c.kind === "SUPPLY" ? `${num(c.units, 1)}/yr at ${money(c.unitPrice, false)}` : c.kind === "LOAN" ? `${money(c.unitPrice, false)} at ${c.ratePct}%` : `${money(c.unitPrice, false)}/yr`;
              return (
                <li key={c.id} className="border-b border-line pb-2">
                  <Badge tone={c.status === "ACTIVE" ? "green" : c.status === "PROPOSED" ? "amber" : "gray"}>{c.status.toLowerCase()}</Badge> {k.label}: {teamName(c.sellerId)} → {teamName(c.buyerId)} · {terms} · Y{c.startCycle}–{c.startCycle + c.cycles - 1}
                  {c.kind === "SUPPLY" && c.status !== "PROPOSED" && <span className="text-xs text-muted"> · delivered {num(c.delivered, 1)}, short {num(c.shortfall, 1)}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Latest messages">
          <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {messages.map((m) => (
              <li key={m.id} className="border-b border-line pb-2">
                <div className="text-xs text-muted">{m.kind} · {teamName(m.fromId)} → {m.toId ? teamName(m.toId) : "everyone"} · {fmtDate(m.createdAt)}</div>
                <div className="whitespace-pre-line">{m.body}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ---------- Settings ---------- */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Settings">
          <form action={simSaveBasics} className="space-y-3">
            {hidden}
            {econ.status !== "SETUP" && <Alert tone="amber">Only the year length, auto-advance and scoring can change after identities are handed out.</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minutes per year"><input name="cycleMinutes" type="number" min={1} defaultValue={cfg.cycleMinutes} className={cls.input} /></Field>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="autoAdvance" defaultChecked={cfg.autoAdvance} /> Process automatically when time is up</label>
            </div>
            <fieldset disabled={econ.status !== "SETUP"} className="space-y-3 disabled:opacity-60">
              <Field label="Industry"><input name="industry" defaultValue={cfg.industry} className={cls.input} /></Field>
              <Field label="Tagline"><input name="tagline" defaultValue={cfg.tagline} className={cls.input} /></Field>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Field label="Years"><input name="cycles" type="number" min={1} max={12} defaultValue={cfg.cycles} className={cls.input} /></Field>
                <Field label="Base budget (₹)"><input name="startCash" type="number" defaultValue={cfg.startCash} className={cls.input} /></Field>
                <Field label="Bank credit limit (₹)"><input name="creditLimit" type="number" defaultValue={cfg.creditLimit} className={cls.input} /></Field>
                <Field label="Interest %"><input name="interestRate" type="number" step="0.25" defaultValue={cfg.interestRate} className={cls.input} /></Field>
                <Field label="Corporate tax %"><input name="taxRate" type="number" step="0.5" defaultValue={cfg.taxRate} className={cls.input} /></Field>
                <Field label="Inflation %"><input name="inflation" type="number" step="0.5" defaultValue={cfg.inflation} className={cls.input} /></Field>
                <Field label="GDP growth %"><input name="gdpGrowth" type="number" step="0.5" defaultValue={cfg.gdpGrowth} className={cls.input} /></Field>
                <Field label="Incumbent share %" hint="Market held by simulated incumbents at par"><input name="incumbentShare" type="number" min={0} max={80} defaultValue={Math.round(cfg.incumbentShare * 100)} className={cls.input} /></Field>
                <Field label="Contract penalty %"><input name="contractPenaltyPct" type="number" defaultValue={cfg.contractPenaltyPct} className={cls.input} /></Field>
                <Field label="Research report (₹)"><input name="researchCost" type="number" defaultValue={cfg.researchCost} className={cls.input} /></Field>
              </div>
              <Field label="Year names (one per line)"><textarea name="cycleNames" rows={3} defaultValue={cfg.cycleNames.join("\n")} className={cls.input} /></Field>
              <div className="rounded-lg border border-line p-3">
                <label className="mb-2 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="auctionEnabled" defaultChecked={cfg.auction.enabled} /> Setup auction</label>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label="Identity reserve (₹)"><input name="identityReserve" type="number" defaultValue={cfg.auction.identityReserve} className={cls.input} /></Field>
                  <Field label="Min increment (₹)"><input name="minIncrement" type="number" defaultValue={cfg.auction.minIncrement} className={cls.input} /></Field>
                  <Field label="Seconds per lot"><input name="lotSeconds" type="number" defaultValue={cfg.auction.lotSeconds} className={cls.input} /></Field>
                  <Field label="Late-bid extension (s)"><input name="extendSeconds" type="number" defaultValue={cfg.auction.extendSeconds} className={cls.input} /></Field>
                </div>
                <p className="mt-2 text-xs text-muted">Resources for sale ({cfg.auction.resources.length}) are edited in the JSON configuration.</p>
              </div>
            </fieldset>
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 text-sm font-semibold">Scoring (weights are relative)</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Profit (ROE)"><input name="wProfit" type="number" step="0.05" defaultValue={cfg.scoring.profit} className={cls.input} /></Field>
                <Field label="Revenue"><input name="wRevenue" type="number" step="0.05" defaultValue={cfg.scoring.revenue} className={cls.input} /></Field>
                <Field label="Market share"><input name="wShare" type="number" step="0.05" defaultValue={cfg.scoring.marketShare} className={cls.input} /></Field>
                <Field label="Satisfaction"><input name="wSatisfaction" type="number" step="0.05" defaultValue={cfg.scoring.satisfaction} className={cls.input} /></Field>
                <Field label="Brand"><input name="wBrand" type="number" step="0.05" defaultValue={cfg.scoring.brand} className={cls.input} /></Field>
                <Field label="Reliability"><input name="wReliability" type="number" step="0.05" defaultValue={cfg.scoring.reliability} className={cls.input} /></Field>
                <Field label="Floor %"><input name="floor" type="number" min={0} max={100} defaultValue={cfg.scoring.floor} className={cls.input} /></Field>
                <Field label="Max marks"><input name="maxMarks" type="number" min={1} defaultValue={cfg.scoring.maxMarks} className={cls.input} /></Field>
              </div>
            </div>
            <SubmitButton>Save settings</SubmitButton>
          </form>
        </Card>
        <div className="space-y-6">
          <Card title="Template and full configuration">
            <form action={simLoadTemplate} className="mb-4 flex flex-wrap items-end gap-2">
              {hidden}
              <select name="template" defaultValue={econ.template} className={`${cls.input} max-w-xs`} disabled={!beforeStart} aria-label="Template">
                {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
              {beforeStart && <SubmitButton variant="secondary" confirm="Load this template? Identities and the auction are cleared.">Load template</SubmitButton>}
            </form>
            <form action={simSaveJson} className="space-y-2">
              {hidden}
              <textarea name="config" rows={14} defaultValue={JSON.stringify(cfg, null, 2)} readOnly={econ.status !== "SETUP"} className={`${cls.input} font-mono text-xs`} aria-label="Economy configuration JSON" />
              {econ.status === "SETUP" ? <SubmitButton variant="secondary">Save JSON</SubmitButton> : <p className="text-xs text-muted">Read-only after identities are handed out.</p>}
            </form>
          </Card>
          <Card title="Dry run">
            <p className="mb-3 text-sm text-muted">Bots play every year with different strategies (balanced, aggressive, premium, lean) so you can check the economy before the event.</p>
            <div className="flex flex-wrap gap-2">
              {[cfg.roles.length, 11, 15].map((nTeams) => <Link key={nTeams} href={`?dry=${nTeams}`} className={`${cls.btn} ${cls.secondary}`}>Run with {nTeams} bots</Link>)}
            </div>
            {report && (
              <div className="mt-4 space-y-3">
                {report.warnings.length ? <Alert tone="amber"><ul className="list-disc pl-4">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert> : <Alert tone="green">No balance warnings.</Alert>}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr><th className={cls.th}>Bot</th><th className={cls.th}>Identity</th><th className={cls.th}>Strategy</th><th className={cls.th}>ROE</th><th className={cls.th}>Avg share</th><th className={cls.th}>Min cash</th><th className={cls.th}>Marks</th></tr></thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={r.label} className="border-t border-line">
                          <td className={cls.td}>{r.label}</td><td className={cls.td}>{roleOf(cfg, r.roleKey)?.name}</td><td className={cls.td}>{r.strategy}</td>
                          <td className={cls.td}>{pct(r.roe)}</td><td className={cls.td}>{pct(r.avgShare)}</td><td className={cls.td}>{money(r.minCash)}</td><td className={cls.td}>{r.marks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
