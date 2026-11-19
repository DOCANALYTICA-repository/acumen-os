import Link from "next/link";
import { notFound } from "next/navigation";
import { db, parseJson } from "@/lib/db";
import { dryRun, equityOf, scoreVentures } from "@/lib/sim/engine";
import { cycleName, money, num, parseConfig, roleOf, TEMPLATES, type MarketState, type VentureResult } from "@/lib/sim/model";
import { eligibleTeams, maybeAdvance, ventureState } from "@/lib/sim/service";
import {
  simAddEvent, simAdjustCash, simAutoAssign, simBroadcast, simCreate, simDeleteEvent, simExtend, simLoadTemplate, simPause,
  simProcess, simRescore, simReset, simResume, simSaveBasics, simSaveJson, simSetRole, simStart,
} from "@/app/actions/sim-admin";
import { Alert, Badge, Card, Field, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LiveClock } from "./live-clock";

const STATUS_TONE = { SETUP: "gray", OPEN: "green", PROCESSING: "amber", PAUSED: "amber", FINISHED: "blue" } as const;

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
          <p className="mb-4 text-sm text-muted">Start from a template. You can edit every number before the simulation opens.</p>
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
  const [decisions, contracts, events, messages, snapshots, eligible] = await Promise.all([
    db.simDecision.findMany({ where: { economyId: econ.id, cycle: econ.currentCycle } }),
    db.simContract.findMany({ where: { economyId: econ.id }, orderBy: { createdAt: "desc" } }),
    db.simEvent.findMany({ where: { economyId: econ.id }, orderBy: [{ cycle: "asc" }, { createdAt: "asc" }] }),
    db.simMessage.findMany({ where: { economyId: econ.id }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.simSnapshot.findMany({ where: { economyId: econ.id }, orderBy: { cycle: "asc" } }),
    econ.status === "SETUP" ? eligibleTeams(round.id) : Promise.resolve([]),
  ]);
  const market = parseJson<MarketState | null>(snapshots.filter((s) => s.ventureId === "MARKET").at(-1)?.data, null);
  const lastResult = new Map<string, VentureResult>();
  for (const s of snapshots) if (s.ventureId !== "MARKET") lastResult.set(s.ventureId, parseJson<VentureResult>(s.data, {} as VentureResult));
  const teamName = (ventureId: string | null) => (ventureId === null ? "Organisers" : econ.ventures.find((v) => v.id === ventureId)?.team.name ?? "?");
  const productOf = (ventureId: string) => roleOf(cfg, econ.ventures.find((v) => v.id === ventureId)?.roleKey ?? "")?.product ?? "";
  const running = econ.status === "OPEN" || econ.status === "PAUSED";
  const setup = econ.status === "SETUP";
  const roleCount = (k: string) => econ.ventures.filter((v) => v.roleKey === k).length;
  const report = dry ? dryRun(cfg, Math.min(40, Math.max(2, Number(dry) || cfg.roles.length))) : null;
  const finalScores = econ.status === "FINISHED"
    ? scoreVentures(cfg, econ.ventures.flatMap((v) => {
        const state = ventureState(v.state);
        return state ? [{ id: v.id, roleKey: v.roleKey, state }] : [];
      })).sort((a, b) => b.marks - a.marks)
    : [];

  // Teams shown in setup: everyone eligible plus anyone already assigned.
  const setupRows = setup
    ? [
        ...eligible.map((t) => ({ teamId: t.id, name: t.name, eligible: true })),
        ...econ.ventures.filter((v) => !eligible.some((t) => t.id === v.teamId)).map((v) => ({ teamId: v.teamId, name: v.team.name, eligible: false })),
      ]
    : [];

  return (
    <>
      <PageHeader
        title={round.name}
        subtitle={<>Simulation control room · {cfg.industry} · <Badge tone={STATUS_TONE[econ.status as keyof typeof STATUS_TONE] ?? "gray"}>{econ.status.toLowerCase()}</Badge></>}
        actions={<><Link href={`/admin/rounds/${round.id}`} className={`${cls.btn} ${cls.secondary}`}>Round settings</Link><Link href="/admin/results" className={`${cls.btn} ${cls.secondary}`}>Results & publishing</Link></>}
      />

      {/* ---------- Cycle controls ---------- */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="eyebrow">{setup ? "Not started" : econ.status === "FINISHED" ? "Complete" : `Cycle ${econ.currentCycle} of ${cfg.cycles}`}</div>
            <div className="mt-1 text-xl font-semibold text-ink">{setup ? `${econ.ventures.length} startups assigned` : econ.status === "FINISHED" ? "All cycles processed" : cycleName(cfg, econ.currentCycle)}</div>
            {running && <div className="mt-1 text-sm text-muted">Decisions in: <strong className="text-ink">{decisions.length} / {econ.ventures.length}</strong> · auto-process at deadline: {cfg.autoAdvance ? "on" : "off"}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {econ.status === "OPEN" && <LiveClock endsAt={econ.cycleEndsAt?.getTime() ?? null} />}
            {econ.status === "PAUSED" && <Badge tone="amber">Paused · {Math.round((econ.pausedMs ?? 0) / 1000)}s left</Badge>}
            {setup && (
              <form action={simStart}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton confirm={`Open cycle 1 for ${econ.ventures.length} teams? Roles lock once it starts.`}>Start simulation</SubmitButton></form>
            )}
            {running && (
              <form action={simProcess}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton pendingText="Processing…" confirm={`Close cycle ${econ.currentCycle} now and process everyone's decisions? Teams without a decision keep last cycle's plan.`}>{econ.currentCycle >= cfg.cycles ? "Process final cycle" : "Close & process cycle"}</SubmitButton></form>
            )}
            {econ.status === "OPEN" && <form action={simPause}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton variant="secondary">Pause</SubmitButton></form>}
            {econ.status === "PAUSED" && <form action={simResume}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton variant="secondary">Resume</SubmitButton></form>}
            {running && (
              <form action={simExtend} className="flex items-center gap-2">
                <input type="hidden" name="economyId" value={econ.id} />
                <input name="minutes" type="number" defaultValue={2} className={`${cls.input} w-20 py-1.5`} aria-label="Minutes to add" />
                <SubmitButton variant="secondary">± min</SubmitButton>
              </form>
            )}
            {econ.status === "FINISHED" && <form action={simRescore}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton variant="secondary">Recalculate marks</SubmitButton></form>}
            {!setup && (
              <form action={simReset}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton variant="danger" confirm="Reset the whole simulation? All decisions, contracts, messages, results and this round's marks are deleted. This cannot be undone.">Reset</SubmitButton></form>
            )}
          </div>
        </div>
        {!setup && (
          <form action={simBroadcast} className="mt-5 flex gap-2 border-t border-line pt-4">
            <input type="hidden" name="economyId" value={econ.id} />
            <input name="body" maxLength={1000} placeholder="Broadcast a message to every team's desk…" className={cls.input} />
            <SubmitButton variant="secondary">Broadcast</SubmitButton>
          </form>
        )}
      </Card>

      {/* ---------- Startups ---------- */}
      {setup ? (
        <Card title="Startup assignments" className="mb-6" action={<form action={simAutoAssign}><input type="hidden" name="economyId" value={econ.id} /><SubmitButton variant="secondary" confirm="Replace all assignments with an automatic shuffle of eligible teams?">Auto-assign eligible teams</SubmitButton></form>}>
          <div className="mb-4 flex flex-wrap gap-2">
            {cfg.roles.map((r) => <Badge key={r.key} tone={roleCount(r.key) ? "green" : "amber"}>{r.name}: {roleCount(r.key)}</Badge>)}
          </div>
          {setupRows.length === 0 ? <p className="text-sm text-muted">No eligible teams yet. Teams must be paid (and qualified, if the round is restricted).</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Startup role</th></tr></thead>
                <tbody>
                  {setupRows.map((t) => {
                    const v = econ.ventures.find((x) => x.teamId === t.teamId);
                    return (
                      <tr key={t.teamId} className="border-t border-line">
                        <td className={cls.td}>{t.name} {!t.eligible && <Badge tone="red">not eligible</Badge>}</td>
                        <td className={cls.td}>
                          <form action={simSetRole} className="flex gap-2">
                            <input type="hidden" name="economyId" value={econ.id} />
                            <input type="hidden" name="teamId" value={t.teamId} />
                            <select name="roleKey" defaultValue={v?.roleKey ?? ""} className={`${cls.input} max-w-xs py-1.5`}>
                              <option value="">Not playing</option>
                              {cfg.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                            </select>
                            <SubmitButton variant="secondary" className="px-3 py-1 text-xs">Save</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Startups" className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["Team", "Business", "Decision", "Cash", "Debt", "Equity", "ROE", "Last profit", "Brand", "Reliability", "Adjust cash"].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
              <tbody>
                {econ.ventures.map((v) => {
                  const st = ventureState(v.state);
                  const role = roleOf(cfg, v.roleKey);
                  if (!st || !role) return null;
                  const eq = equityOf(role, st);
                  const r = lastResult.get(v.id);
                  const submitted = decisions.some((d) => d.ventureId === v.id);
                  return (
                    <tr key={v.id} className="border-t border-line">
                      <td className={`${cls.td} font-medium text-ink`}>{v.team.name}</td>
                      <td className={cls.td}>{role.name}</td>
                      <td className={cls.td}>{running ? (submitted ? <Badge tone="green">in</Badge> : <Badge tone="amber">waiting</Badge>) : "—"}</td>
                      <td className={cls.td}>{money(st.cash)}</td>
                      <td className={cls.td}>{st.debt ? money(st.debt) : "—"}</td>
                      <td className={cls.td}>{money(eq)}</td>
                      <td className={cls.td}>{num(((eq - st.startEquity) / st.startEquity) * 100, 1)}%</td>
                      <td className={cls.td}>{r ? money(r.profit) : "—"}</td>
                      <td className={cls.td}>{st.brand.toFixed(2)}</td>
                      <td className={cls.td}>{Math.round(st.reliability * 100)}% {st.distress ? <Badge tone="red">{st.distress} bailout</Badge> : null}</td>
                      <td className={cls.td}>
                        <form action={simAdjustCash} className="flex gap-1">
                          <input type="hidden" name="ventureId" value={v.id} />
                          <input name="amount" type="number" placeholder="±₹" className={`${cls.input} w-24 py-1`} aria-label="Amount" />
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
          <p className="mt-3 text-xs text-muted">Cash adjustments are for recovering from mistakes. Each one is logged and the team is told why.</p>
        </Card>
      )}

      {finalScores.length > 0 && (
        <Card title="Final simulation marks" className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["Rank", "Team", "Business", "Equity", "ROE", "Brand", "Reliability", "Marks"].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
              <tbody>
                {finalScores.map((s, i) => {
                  const v = econ.ventures.find((x) => x.id === s.id);
                  return (
                    <tr key={s.id} className="border-t border-line">
                      <td className={cls.td}>{i + 1}</td>
                      <td className={`${cls.td} font-medium text-ink`}>{v?.team.name}</td>
                      <td className={cls.td}>{roleOf(cfg, v?.roleKey ?? "")?.name}</td>
                      <td className={cls.td}>{money(s.equity)}</td>
                      <td className={cls.td}>{num(s.roe * 100, 1)}%</td>
                      <td className={cls.td}>{s.brand.toFixed(2)}</td>
                      <td className={cls.td}>{Math.round(s.reliability * 100)}%</td>
                      <td className={`${cls.td} font-semibold`}>{num(s.marks, 1)} / {cfg.scoring.maxMarks}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">These marks are stored as this round&apos;s scores and feed the leaderboard. Publish them on Results when ready; use overrides there for adjustments.</p>
        </Card>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        {/* ---------- Market ---------- */}
        <Card title={market ? `Market after cycle ${market.cycle}` : "Market"}>
          <p className="mb-3 text-sm text-muted">Adoption index {market?.adoption.toFixed(2) ?? "1.00"} · interest {market?.interestRate ?? cfg.interestRate}%</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["Segment", "Startups", "Demand", "Sold", "Avg price", "Spot"].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
              <tbody>
                {cfg.roles.map((r) => {
                  const m = market?.roles[r.key];
                  return (
                    <tr key={r.key} className="border-t border-line">
                      <td className={cls.td}>{r.name}</td><td className={cls.td}>{roleCount(r.key)}</td>
                      <td className={cls.td}>{m ? num(m.demand) : "—"}</td><td className={cls.td}>{m ? num(m.sales) : "—"}</td>
                      <td className={cls.td}>{m ? money(m.avgPrice, false) : "—"}</td><td className={cls.td}>{m ? money(m.spotPrice, false) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ---------- Events ---------- */}
        <Card title="Economic events">
          <ul className="mb-4 space-y-2">
            {events.length === 0 && <li className="text-sm text-muted">No events scheduled.</li>}
            {events.map((e) => {
              const applied = econ.status === "FINISHED" || e.cycle < econ.currentCycle;
              const visible = !applied && running && e.cycle === econ.currentCycle;
              return (
                <li key={e.id} className="flex items-start justify-between gap-3 rounded-2xl border border-line/70 bg-white/60 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={applied ? "gray" : visible ? "amber" : "blue"}>C{e.cycle}{applied ? " · applied" : visible ? " · visible now" : " · hidden"}</Badge><span className="font-semibold text-ink">{e.title}</span></div>
                    <code className="mt-1 block break-all text-xs text-muted">{e.effects}</code>
                  </div>
                  {!applied && <form action={simDeleteEvent}><input type="hidden" name="eventId" value={e.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="Delete this event?">Delete</SubmitButton></form>}
                </li>
              );
            })}
          </ul>
          {econ.status !== "FINISHED" && (
            <form action={simAddEvent} className="space-y-3 border-t border-line pt-4">
              <input type="hidden" name="economyId" value={econ.id} />
              <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
                <Field label="Preset">
                  <select name="preset" className={cls.input} defaultValue="">
                    <option value="">Custom (fill below)</option>
                    {cfg.eventLibrary.map((e) => <option key={e.key} value={e.key}>{e.title}</option>)}
                  </select>
                </Field>
                <Field label="Cycle"><input name="cycle" type="number" min={setup ? 1 : econ.currentCycle} max={cfg.cycles} defaultValue={Math.max(1, econ.currentCycle)} className={cls.input} /></Field>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Custom headline and effects</summary>
                <div className="mt-3 space-y-3">
                  <input name="title" placeholder="Headline" className={cls.input} />
                  <textarea name="description" rows={2} placeholder="What teams read" className={cls.input} />
                  <textarea name="effects" rows={3} placeholder='{"demand": {"fleet": 1.2, "*": 0.95}, "spot": {"battery": 1.3}, "cost": {"ev_maker": 1.1}, "interestDelta": 2, "adoptionDelta": 0.05}' className={`${cls.input} font-mono text-xs`} />
                </div>
              </details>
              <p className="text-xs text-muted">Events for the current cycle are shown to teams immediately and applied when it is processed. Future events stay hidden until their cycle opens.</p>
              <SubmitButton variant="secondary">Schedule event</SubmitButton>
            </form>
          )}
        </Card>
      </div>

      {/* ---------- Contracts & messages ---------- */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Contracts (${contracts.length})`}>
          {contracts.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full">
                <thead><tr>{["Seller → buyer", "Terms", "Status", "Delivered"].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className={`${cls.td} text-xs`}>{teamName(c.sellerId)} → {teamName(c.buyerId)}</td>
                      <td className={`${cls.td} text-xs`}>{num(c.units, 1)} {productOf(c.sellerId)} @ {money(c.unitPrice, false)} · C{c.startCycle}+{c.cycles}</td>
                      <td className={cls.td}><Badge tone={c.status === "ACTIVE" ? "green" : c.status === "PROPOSED" ? "amber" : "gray"}>{c.status.toLowerCase()}</Badge></td>
                      <td className={`${cls.td} text-xs`}>{num(c.delivered, 1)}{c.shortfall ? ` (short ${num(c.shortfall, 1)})` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Latest messages">
          {messages.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="max-h-96 space-y-2 overflow-auto text-sm">
              {messages.map((m) => (
                <li key={m.id} className="rounded-xl bg-white/60 px-3 py-2">
                  <div className="text-xs text-muted">{teamName(m.fromId)} → {m.toId ? teamName(m.toId) : "everyone"} · {m.kind.toLowerCase()} · {fmtDate(m.createdAt)}</div>
                  <div className="whitespace-pre-line break-words text-ink/90">{m.body}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ---------- Configuration ---------- */}
      <Card title="Economy settings" className="mb-6">
        {!setup && <div className="mb-4"><Alert tone="gray">The economy is running. Only the window length, auto-processing and scoring can change now.</Alert></div>}
        <form action={simSaveBasics} className="space-y-4">
          <input type="hidden" name="economyId" value={econ.id} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Industry"><input name="industry" defaultValue={cfg.industry} disabled={!setup} className={cls.input} /></Field>
            <Field label="Cycles"><input name="cycles" type="number" min={1} max={12} defaultValue={cfg.cycles} disabled={!setup} className={cls.input} /></Field>
            <Field label="Decision window (minutes)"><input name="cycleMinutes" type="number" min={1} max={180} defaultValue={cfg.cycleMinutes} className={cls.input} /></Field>
            <Field label="Starting cash (₹)"><input name="startCash" type="number" defaultValue={cfg.startCash} disabled={!setup} className={cls.input} /></Field>
            <Field label="Credit limit (₹)"><input name="creditLimit" type="number" defaultValue={cfg.creditLimit} disabled={!setup} className={cls.input} /></Field>
            <Field label="Interest rate (%/yr)"><input name="interestRate" type="number" step="0.5" defaultValue={cfg.interestRate} disabled={!setup} className={cls.input} /></Field>
            <Field label="Research report cost (₹)"><input name="researchCost" type="number" defaultValue={cfg.researchCost} disabled={!setup} className={cls.input} /></Field>
            <Field label="Contract shortfall penalty (%)"><input name="contractPenaltyPct" type="number" defaultValue={cfg.contractPenaltyPct} disabled={!setup} className={cls.input} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="autoAdvance" defaultChecked={cfg.autoAdvance} /> Process automatically when the window ends</label>
          </div>
          <Field label="Tagline"><input name="tagline" defaultValue={cfg.tagline} disabled={!setup} className={cls.input} /></Field>
          <Field label="Cycle names" hint="One per line"><textarea name="cycleNames" rows={3} defaultValue={cfg.cycleNames.join("\n")} disabled={!setup} className={cls.input} /></Field>
          <div className="rounded-2xl border border-line p-4">
            <div className="mb-3 text-sm font-semibold text-ink">Scoring</div>
            <div className="grid gap-4 md:grid-cols-5">
              <Field label="Max marks"><input name="maxMarks" type="number" defaultValue={cfg.scoring.maxMarks} className={cls.input} /></Field>
              <Field label="Floor (%)" hint="Marks for the last-placed team"><input name="floor" type="number" defaultValue={cfg.scoring.floor} className={cls.input} /></Field>
              <Field label="Weight: ROE"><input name="wEquity" type="number" step="0.05" defaultValue={cfg.scoring.equity} className={cls.input} /></Field>
              <Field label="Weight: brand"><input name="wBrand" type="number" step="0.05" defaultValue={cfg.scoring.brand} className={cls.input} /></Field>
              <Field label="Weight: reliability"><input name="wReliability" type="number" step="0.05" defaultValue={cfg.scoring.reliability} className={cls.input} /></Field>
            </div>
            <p className="mt-2 text-xs text-muted">ROE and brand are normalised across all teams (best = 1, worst = 0), so different businesses compete fairly. Reliability is the share of contracted units actually delivered.</p>
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </form>

        {setup && (
          <div className="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
            <form action={simLoadTemplate} className="space-y-3">
              <input type="hidden" name="economyId" value={econ.id} />
              <div className="text-sm font-semibold text-ink">Load a template</div>
              <select name="template" className={cls.input} defaultValue={econ.template}>
                {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
              <SubmitButton variant="secondary" confirm="Replace the whole configuration and scheduled events with this template?">Load template</SubmitButton>
            </form>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-ink">Advanced: edit the full economy as JSON</summary>
              <form action={simSaveJson} className="mt-3 space-y-3">
                <input type="hidden" name="economyId" value={econ.id} />
                <textarea name="config" rows={18} defaultValue={JSON.stringify(cfg, null, 2)} className={`${cls.input} font-mono text-xs`} />
                <p className="text-xs text-muted">Roles, prices, costs, demand, elasticities, inputs, demand drivers and the event library. Run a dry run after editing.</p>
                <SubmitButton variant="secondary">Save JSON</SubmitButton>
              </form>
            </details>
          </div>
        )}
      </Card>

      {/* ---------- Dry run ---------- */}
      <Card title="Dry run with bot teams" action={<Link href={`/admin/simulation/${round.id}?dry=${econ.ventures.length || cfg.roles.length}`} className={`${cls.btn} ${cls.secondary}`}>{report ? "Run again" : "Run dry run"}</Link>}>
        <p className="text-sm text-muted">
          Bots play every cycle with balanced, aggressive (low price, expansion) and premium (high price, quality) strategies, sign supply contracts at 90% of spot,
          and face the scheduled template events. Use it to catch roles that cannot make money, or that are too easy, before the event.
        </p>
        {report && (
          <div className="mt-4 space-y-4">
            {report.warnings.length ? <Alert tone="amber"><ul className="list-disc pl-5">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert> : <Alert tone="green">No balance warnings.</Alert>}
            <p className="text-sm text-muted">Adoption index by cycle: {report.adoption.map((a) => a.toFixed(2)).join(" → ")}</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{["Bot", "Business", "Strategy", "Profit by cycle", "Lowest cash", "End equity", "ROE", "Marks"].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.label} className="border-t border-line">
                      <td className={cls.td}>{r.label}</td>
                      <td className={cls.td}>{roleOf(cfg, r.roleKey)?.name}</td>
                      <td className={cls.td}>{r.strategy}</td>
                      <td className={`${cls.td} text-xs`}>{r.profitByCycle.map((p) => money(p)).join(" · ")}</td>
                      <td className={cls.td}>{money(r.minCash)} {r.distress ? <Badge tone="red">bailout</Badge> : null}</td>
                      <td className={cls.td}>{money(r.endEquity)}</td>
                      <td className={cls.td}>{num(r.roe * 100, 1)}%</td>
                      <td className={cls.td}>{num(r.marks, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
