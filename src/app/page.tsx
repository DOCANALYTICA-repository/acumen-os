import Link from "next/link";
import { ArrowRight, CalendarDays, Download, GraduationCap, Layers, Mail, Sparkles, Trophy, Users, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";
import { effectiveStatus } from "@/lib/rounds";
import { fileUrl } from "@/lib/files";
import { fmtDate } from "@/components/ui";
import { Countdown } from "@/components/countdown";
import { AmbientBlobs, Reveal, Stagger, StaggerItem } from "@/components/motion";
import { HeroVisual } from "@/components/hero-visual";
import { CountUp } from "@/components/count-up";
import { RoundsJourney } from "@/components/rounds-journey";
import { Faq } from "@/components/faq";
import { BrandLogo } from "@/components/logo";

function SectionHeading({ eyebrow, title, description, center = false }: { eyebrow: string; title: React.ReactNode; description?: string; center?: boolean }) {
  return (
    <Reveal className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-base leading-relaxed text-muted">{description}</p>}
    </Reveal>
  );
}

export default async function Home() {
  const [content, user, rounds, teamCount, participants] = await Promise.all([
    getContent(),
    getCurrentUser(),
    db.round.findMany({ orderBy: { order: "asc" } }),
    db.team.count({ where: { disqualified: false } }),
    db.user.findMany({ where: { role: "PARTICIPANT" }, select: { college: true } }),
  ]);
  const assets = await db.asset.findMany({ where: user ? {} : { visibility: "PUBLIC" }, orderBy: { createdAt: "desc" }, take: 6 });
  const colleges = new Set(participants.map((p) => p.college.trim().toLowerCase()).filter(Boolean)).size;

  const open = registrationOpen(content);
  const ctaHref = user ? (user.role === "ADMIN" ? "/admin" : user.role === "JUDGE" ? "/judge" : "/dashboard") : open ? "/register" : "/login";
  const ctaText = user ? "Go to dashboard" : open ? "Register your team" : "Log in";

  const journey = rounds.map((r) => ({
    id: r.id,
    order: r.order,
    title: r.name.replace(/^Round \d+ — /, ""),
    type: r.type,
    description: r.description,
    status: effectiveStatus(r),
    window: r.startsAt ? `${fmtDate(r.startsAt, false)} – ${fmtDate(r.endsAt, false)}` : "Dates to be announced",
  }));

  const timeline = [
    ...(content.registrationDeadline ? [{ label: "Registrations close", at: new Date(content.registrationDeadline) }] : []),
    ...rounds.filter((r) => r.startsAt && r.status !== "DRAFT").map((r) => ({ label: `${r.name.replace(/ — .*/, "")} opens`, at: r.startsAt! })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const stats = [
    { label: "Rounds", value: rounds.length, icon: Layers, tint: "text-sky-600" },
    { label: "Teams registered", value: teamCount, icon: Users, tint: "text-violet-600" },
    { label: "Students", value: participants.length, icon: GraduationCap, tint: "text-emerald-600" },
    { label: "Colleges", value: colleges, icon: Trophy, tint: "text-amber-500" },
  ];

  return (
    <>
      {/* ============== HERO ============== */}
      <section className="relative">
        <AmbientBlobs />
        <div className="container-page grid min-h-[calc(100vh-8rem)] items-center gap-10 py-8 lg:grid-cols-[1.05fr_0.95fr]">
          <Stagger onLoad>
            <StaggerItem>
              <span className="eyebrow"><Sparkles className="h-3.5 w-3.5" /> {content.eventDates}</span>
            </StaggerItem>
            <StaggerItem>
              <h1 className="text-shimmer mt-5 pb-2 text-6xl font-black tracking-tight sm:text-7xl xl:text-8xl">{content.eventName}</h1>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-2 text-2xl font-semibold leading-snug text-ink sm:text-[28px]">{content.tagline}</p>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">{content.heroBlurb}</p>
            </StaggerItem>
            <StaggerItem className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={ctaHref} className="btn-primary group">
                <UserPlus className="h-4 w-4" /> {ctaText}
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
              <Link href="#rounds" className="btn-secondary">See the rounds</Link>
            </StaggerItem>
            <StaggerItem>
              {open && content.registrationDeadline && <Countdown to={content.registrationDeadline} label="Registrations close in" />}
            </StaggerItem>
          </Stagger>

          <HeroVisual className="order-first mx-auto w-full max-w-md lg:order-last lg:max-w-none" />
        </div>
      </section>

      {/* ============== LIVE NUMBERS ============== */}
      <section className="container-page mt-6">
        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <StaggerItem key={s.label} variant="scaleIn" lift className="glass rounded-3xl p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/80 shadow-soft ${s.tint}`}>
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="text-3xl font-bold tracking-tight text-ink sm:text-4xl"><CountUp value={s.value} /></span>
              </div>
              <p className="mt-3 text-sm font-medium text-muted">{s.label}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* ============== ROUNDS ============== */}
      <section id="rounds" className="container-page mt-28 scroll-mt-28">
        <SectionHeading eyebrow="The journey" title={<>Five rounds. <span className="text-gradient">Only the sharpest advance.</span></>} description="Two rounds are played live on this site, three are case submissions judged by a panel. Top teams move on after each cut-off." center />
        <div className="mt-12"><RoundsJourney rounds={journey} /></div>
      </section>

      {/* ============== ABOUT + PRIZES ============== */}
      <section className="container-page mt-28">
        <div className="rounded-5xl border border-white/50 bg-white/35 p-6 shadow-soft backdrop-blur-md sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
            <Reveal>
              <span className="eyebrow">About</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-[34px]">What is {content.eventName}?</h2>
              <p className="mt-4 whitespace-pre-line leading-relaxed text-muted">{content.about}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["College students only", `Teams of ${content.teamMin}–${content.teamMax}`, `Fee: ${content.fee}`].map((t) => (
                  <span key={t} className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-ink shadow-soft">{t}</span>
                ))}
              </div>
            </Reveal>
            <Reveal delay={0.1} className="relative overflow-hidden rounded-4xl bg-gradient-to-br from-sky-600 via-sky-500 to-sky-400 p-7 text-white shadow-glass-lg">
              <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-white/15 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-16 left-1/4 h-48 w-48 rounded-full bg-amber-300/30 blur-3xl" />
              <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur-sm animate-float"><Trophy className="h-7 w-7" /></span>
              <h3 className="relative mt-5 text-xl font-bold">Prizes</h3>
              <p className="relative mt-2 whitespace-pre-line text-sm text-sky-50/90">{content.prizes}</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============== SCHEDULE + RESOURCES ============== */}
      <section className="container-page mt-28">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Schedule" title="Key dates" />
            {timeline.length === 0 ? (
              <p className="mt-6 text-muted">Dates will be announced soon.</p>
            ) : (
              <Stagger className="relative mt-8 space-y-4 border-l-2 border-sky-100 pl-6">
                {timeline.map((t, i) => (
                  <StaggerItem key={i} className="relative">
                    <span className="absolute -left-[33px] top-3 h-4 w-4 rounded-full border-4 border-white bg-sky-500 shadow-soft" />
                    <div className="glass rounded-2xl px-4 py-3">
                      <div className="text-sm font-semibold text-ink">{t.label}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><CalendarDays className="h-3.5 w-3.5" /> {fmtDate(t.at)}</div>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </div>
          <div id="assets" className="scroll-mt-28">
            <SectionHeading eyebrow="Resources" title="Rulebook & downloads" />
            {assets.length === 0 ? (
              <p className="mt-6 text-muted">The rulebook, brochure and templates will be posted here.</p>
            ) : (
              <Stagger className="mt-8 grid gap-3 sm:grid-cols-2">
                {assets.map((a) => (
                  <StaggerItem key={a.id} lift>
                    <a href={fileUrl(a.filePath)} className="glass group flex items-center gap-3 rounded-2xl p-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-600 transition-transform duration-300 group-hover:-translate-y-0.5"><Download className="h-4 w-4" /></span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{a.title}</span>
                        <span className="block text-xs text-muted">{a.category}{a.visibility === "PARTICIPANTS" ? " · participants" : ""}</span>
                      </span>
                    </a>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </div>
        </div>
      </section>

      {/* ============== FAQ ============== */}
      <section id="faq" className="container-page mt-28 scroll-mt-28">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeading eyebrow="FAQ" title="Questions, answered." description={`Still stuck? Write to ${content.contactEmail}.`} />
          <Reveal delay={0.1}><Faq items={content.faq} /></Reveal>
        </div>
      </section>

      {/* ============== CTA ============== */}
      {!user && open && (
        <section className="container-page mt-28">
          <Reveal className="relative overflow-hidden rounded-4xl bg-gradient-to-r from-sky-600 via-sky-500 to-sky-400 px-7 py-10 shadow-glass-lg sm:px-12">
            <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-amber-300/30 blur-3xl" />
            <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="max-w-xl text-2xl font-bold leading-snug text-white sm:text-3xl">Ready to prove your {content.eventName.toLowerCase()}?</h2>
                <p className="mt-2 text-sm text-sky-50/90">Register, build your team of {content.teamMin}–{content.teamMax}, and take on Round 1.</p>
              </div>
              <Link href="/register" className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-sky-700 shadow-soft transition-all duration-300 hover:shadow-glass-lg">
                Register now <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </Reveal>
        </section>
      )}

      {/* ============== FOOTER ============== */}
      <footer className="container-page pb-10 pt-24">
        <div className="glass grid gap-8 rounded-4xl p-8 sm:p-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <BrandLogo name={content.eventName} />
            <p className="mt-4 text-sm text-muted">{content.tagline}</p>
          </div>
          <div className="grid content-start gap-2.5 text-sm">
            <p className="font-semibold text-ink">Quick links</p>
            <Link href="#rounds" className="text-muted hover:text-sky-600">Rounds</Link>
            <Link href="#faq" className="text-muted hover:text-sky-600">FAQ</Link>
            <Link href={user ? ctaHref : "/register"} className="text-muted hover:text-sky-600">{user ? "Dashboard" : "Register"}</Link>
          </div>
          <div className="grid content-start gap-2.5 text-sm">
            <p className="font-semibold text-ink">Contact</p>
            {content.contactEmail && <a href={`mailto:${content.contactEmail}`} className="flex items-center gap-2 text-muted hover:text-sky-600"><Mail className="h-4 w-4" /> {content.contactEmail}</a>}
            {content.contactPhone && <span className="text-muted">{content.contactPhone}</span>}
            {content.instagram && <a href={content.instagram} className="text-muted hover:text-sky-600">Instagram</a>}
            {content.community && <a href={content.community} className="text-muted hover:text-sky-600">Community</a>}
            <p className="mt-4 text-xs text-muted">© {new Date().getFullYear()} {content.eventName}</p>
          </div>
        </div>
      </footer>
    </>
  );
}
