import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db, parseJson } from "@/lib/db";
import { effectiveStatus, entryBlocker, manualSettings, MAX_SUBMISSION_LINKS, submissionSettings, teamStatus, TYPE_LABEL } from "@/lib/rounds";
import { Alert, Badge, Card, Container, PageHeader, cls, fmtDate, statusTone } from "@/components/ui";
import { playerState } from "@/lib/live-quiz";
import { MarkDoneForm, SubmissionForm } from "./submission-form";
import { SimView } from "./sim-view";
import { LivePlayer } from "./live-player";

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== "PARTICIPANT") redirect(user.role === "ADMIN" ? `/admin/rounds/${id}` : "/judge");
  const round = await db.round.findUnique({ where: { id } });
  if (!round || round.status === "DRAFT") notFound();
  const team = user.membership?.team;
  if (!team) redirect("/dashboard");

  const st = effectiveStatus(round);
  const status = teamStatus(team, team.members.length);
  const qualified = !!(await db.qualification.findUnique({ where: { roundId_teamId: { roundId: round.id, teamId: team.id } } }));
  const blocker = entryBlocker({ round, status, qualified });
  const attempt = await db.attempt.findUnique({ where: { roundId_teamId: { roundId: round.id, teamId: team.id } } });

  const header = (
    <PageHeader
      title={round.name}
      subtitle={<>{TYPE_LABEL[round.type]} · {round.startsAt ? `${fmtDate(round.startsAt)} – ${fmtDate(round.endsAt)}` : "Dates TBA"} · <Badge tone={statusTone(st)}>{st.toLowerCase()}</Badge></>}
      actions={<Link href="/dashboard" className={`${cls.btn} ${cls.secondary}`}>Back to dashboard</Link>}
    />
  );
  const brief = (
    <Card title="Instructions" className="mb-6">
      <p className="whitespace-pre-line text-sm text-ink/80">{round.description}</p>
      {round.instructions && <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{round.instructions}</p>}
      {round.briefUrl && <a href={round.briefUrl} target="_blank" rel="noreferrer" className={`${cls.ghost} mt-3 inline-block text-sm`}>Open brief</a>}
    </Card>
  );

  // ---------- Simulation rounds ----------
  if (round.type === "SIMULATION") {
    return (
      <Container className="py-10">
        {header}
        {(round.description || round.instructions || round.briefUrl) && (
          <details className="glass mb-6 rounded-3xl p-5">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Round brief and rules</summary>
            <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{round.description}</p>
            {round.instructions && <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{round.instructions}</p>}
            {round.briefUrl && <a href={round.briefUrl} target="_blank" rel="noreferrer" className={`${cls.ghost} mt-3 inline-block text-sm`}>Open brief</a>}
          </details>
        )}
        {blocker ? <Alert tone="amber">{blocker}</Alert> : <SimView roundId={round.id} teamId={team.id} resultsPublished={round.resultsPublished} />}
      </Container>
    );
  }

  // ---------- Off-platform rounds: mark as done ----------
  if (round.type === "MANUAL") {
    const ms = manualSettings(round);
    const done = !!attempt?.submittedAt;
    const scored = attempt?.manualScore != null;
    const { markedBy, link: doneLink } = parseJson<{ markedBy?: string; link?: string }>(attempt?.answers, {});
    const open = st === "LIVE" || st === "CLOSED";
    return (
      <Container className="py-10">
        {header}
        {brief}
        <Card title="Your team's status">
          {blocker ? <Alert tone="amber">{blocker}</Alert>
            : !open ? <Alert tone="amber">Opens {fmtDate(round.startsAt)}.</Alert>
            : (
              <div className="space-y-4">
                <p className="text-sm text-ink/80">This round happens outside this site; nothing is uploaded here. When your team has finished, mark it done (you can add a link to your work, e.g. your Google Classroom submission). The organisers verify it and enter your marks.</p>
                {ms.link && <a href={ms.link} target="_blank" rel="noreferrer" className={`${cls.btn} ${cls.secondary}`}>{ms.linkLabel}</a>}
                {done ? (
                  <Alert tone="green">Marked done{markedBy ? ` by ${markedBy}` : ""} on {fmtDate(attempt!.submittedAt)}.{scored ? (round.resultsPublished ? ` Marks: ${attempt!.manualScore} / ${ms.maxMarks}.` : " The organisers have entered your marks; they appear once results are published.") : " Waiting for the organisers to verify."}</Alert>
                ) : (
                  <Alert tone="gray">Not marked done yet.</Alert>
                )}
                {done && doneLink && <p className="text-sm">Your link: <a href={doneLink} target="_blank" rel="noreferrer" className={`${cls.ghost} break-all`}>{doneLink}</a></p>}
                {!scored && <MarkDoneForm roundId={round.id} done={done} />}
              </div>
            )}
        </Card>
      </Container>
    );
  }

  // ---------- Submission rounds ----------
  if (round.type === "SUBMISSION") {
    const rules = submissionSettings(round);
    const history = await db.submission.findMany({ where: { roundId: round.id, teamId: team.id }, orderBy: { version: "desc" }, include: { uploadedBy: true } });
    const canSubmit = !blocker && (st === "LIVE" || (st === "CLOSED" && rules.allowLate)) && (rules.allowResubmit || history.length === 0);
    return (
      <Container className="py-10">
        {header}
        {brief}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={history.length ? "Replace your submission" : "Your submission"}>
            {blocker ? <Alert tone="amber">{blocker}</Alert>
              : st === "UPCOMING" ? <Alert tone="amber">Opens {fmtDate(round.startsAt)}.</Alert>
              : canSubmit ? <SubmissionForm roundId={round.id} maxLinks={MAX_SUBMISSION_LINKS} late={st === "CLOSED"} />
              : <Alert tone="gray">Submissions for this round are closed.</Alert>}
          </Card>
          <Card title="Version history">
            {history.length === 0 ? <p className="text-sm text-muted">Nothing submitted yet.</p> : (
              <ul className="space-y-4">
                {history.map((s, i) => (
                  <li key={s.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-ink">v{s.version} · {s.title || "Untitled"}</span>
                      <span className="flex gap-1">{i === 0 && <Badge tone="green">Counts</Badge>}{s.isLate && <Badge tone="red">Late</Badge>}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">By {s.uploadedBy.fullName} · {fmtDate(s.submittedAt)}</div>
                    <ul className="mt-2 space-y-1">
                      {parseJson<string[]>(s.links, []).map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className={`${cls.ghost} break-all text-sm`}>{l}</a></li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Container>
    );
  }

  // ---------- Live quiz (host-led) ----------
  if (round.type === "QUIZ") {
    return (
      <Container className="py-10">
        {header}
        {blocker ? (
          <>{brief}<Alert tone="amber">{blocker}</Alert></>
        ) : (
          <>
            <LivePlayer roundId={round.id} initial={await playerState(round.id, { id: team.id, name: team.name })} />
            {(round.description || round.instructions) && (
              <details className="glass mx-auto mt-6 max-w-2xl rounded-3xl p-5">
                <summary className="cursor-pointer text-sm font-semibold text-ink">How this round works</summary>
                <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{round.description}</p>
                {round.instructions && <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{round.instructions}</p>}
              </details>
            )}
          </>
        )}
      </Container>
    );
  }

  notFound();
}
