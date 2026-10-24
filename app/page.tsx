"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Onboarding from "@/components/Onboarding";
import {
  FALLBACK_CONDITIONS,
  LEARNED_PATTERNS,
  PERSONAS,
  getPersona,
} from "@/lib/data";
import {
  MODE_META,
  buildConditions,
  fmt,
  haversineKm,
  legColor,
  money,
  planNaive,
  planRhythm,
  toMin,
} from "@/lib/engine";
import { downloadIcs } from "@/lib/ics";
import { draftLateNotices, mailtoFor } from "@/lib/notify";
import type {
  DayPlan,
  Leg,
  LateNotice,
  Persona,
  PlannedEvent,
  RawConditions,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-ink-950" />,
});

type SendState = "sending" | "sent" | "opened" | "failed";

const noticeKey = (personaId: string, n: LateNotice) =>
  `${personaId}|${n.eventId}|${n.subject}|${n.body}`;

// ---------------------------------------------------------------------------
// Small UI atoms
// ---------------------------------------------------------------------------

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "pulse" | "red" | "amber" | "green";
}) {
  const tones = {
    slate: "border-ink-600 bg-ink-700/60 text-slate-300",
    pulse: "border-pulse/40 bg-pulse/10 text-pulse",
    red: "border-rose-400/40 bg-rose-500/10 text-rose-300",
    amber: "border-amber-400/40 bg-amber-500/10 text-amber-300",
    green: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function SourceBadge({ source }: { source?: "live" | "fallback" }) {
  if (!source) return <span className="font-mono text-[10px] text-slate-500">…</span>;
  return source === "live" ? (
    <span className="font-mono text-[10px] font-semibold text-emerald-400">● LIVE</span>
  ) : (
    <span className="font-mono text-[10px] font-semibold text-amber-400">◌ CACHED</span>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="fade-up border-t border-ink-600/70 px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function modeIcon(mode: string) {
  return { walk: "🚶", bike: "🚲", bus: "🚌", subway: "🚇", rideshare: "🚗" }[mode] ?? "•";
}

function optionName(leg: Leg) {
  const o = leg.option;
  if (o.mode === "subway") return o.line ? `${o.line} Line` : "Subway";
  return o.label;
}

// ---------------------------------------------------------------------------
// Chips (Requirement 2.8)
// ---------------------------------------------------------------------------

function personaChips(p: Persona): string[] {
  const c: string[] = [];
  if (p.connections.calendar) c.push("📅 Google Calendar");
  if (p.accessibility.wheelchair) c.push("♿ Wheelchair");
  if (p.accessibility.avoidStairs) c.push("♿ Step-free routes");
  if (p.mobility === "limited") c.push("🦯 Walks slowly");
  c.push(`🚶 Max walk ${p.accessibility.maxWalkKm.toFixed(1)} km`);
  if (p.connections.bank) {
    const b = p.connections.bank;
    c.push(`🏦 ${b.institution} ••${b.mask} · ${money(b.balance)}`);
  }
  c.push(`💵 ${money(p.dailyRideBudget)}/day rides`);
  if (p.connections.uber) c.push("🚗 Uber live fares");
  if (p.connections.bluebikes !== "none") c.push(`🚲 Bluebikes ${p.connections.bluebikes}`);
  if (p.sustainability >= 0.6) c.push("🌱 Low-carbon first");
  if (p.autoNotify) c.push("✉️ Auto heads-ups");
  return c;
}

// ---------------------------------------------------------------------------
// Briefing (Requirement 6.4)
// ---------------------------------------------------------------------------

function briefingFacts(persona: Persona, plan: DayPlan): string[] {
  const facts: string[] = [];
  for (const pe of plan.events) {
    if (pe.moved) {
      facts.push(`Moved ${pe.event.title} from ${fmt(pe.plannedStart)} to ${fmt(pe.committedStart)}.`);
    }
  }
  plan.legs.forEach((leg) => {
    const ev = persona.events.find((e) => e.id === leg.eventId);
    if (!ev) return;
    facts.push(
      `Take the ${optionName(leg)} at ${fmt(leg.depart)} to ${ev.title} at ${leg.to.short}, arriving ${fmt(leg.arrive)}${
        leg.lateMin > 0.5 ? ` (${Math.round(leg.lateMin)} min late)` : ""
      }${leg.option.cost > 0 ? `, ${money(leg.option.cost)}` : ""}.`
    );
    if (ev.deadline) {
      facts.push(
        `${ev.title} has a hard deadline at ${fmt(toMin(ev.deadline))}; ${leg.missedDeadline ? "it is missed" : "it is made"}.`
      );
    }
  });
  return facts;
}

function templateBriefing(persona: Persona, plan: DayPlan): string {
  const parts: string[] = [];
  const moved = plan.events.find((e) => e.moved);
  if (moved) {
    parts.push(`I moved ${moved.event.title} to ${fmt(moved.committedStart)} so the rest of your day fits.`);
  }
  const notable = plan.legs.filter((l) => l.option.mode !== "walk").slice(0, 2);
  const legText = (notable.length ? notable : plan.legs.slice(0, 1))
    .map((l) => `take the ${optionName(l)} at ${fmt(l.depart)}`)
    .join(", then ");
  if (legText) parts.push(`${legText.charAt(0).toUpperCase()}${legText.slice(1)}.`);
  const dl = plan.legs.find((l) => persona.events.find((e) => e.id === l.eventId)?.deadline);
  if (dl) {
    const ev = persona.events.find((e) => e.id === dl.eventId)!;
    parts.push(
      dl.missedDeadline
        ? `Heads-up: ${ev.title} is at risk today.`
        : `You'll make ${ev.title.toLowerCase()} with time to spare, arriving ${fmt(dl.arrive)}.`
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [overrides, setOverrides] = useState<Record<string, Persona>>({});
  const [stress, setStress] = useState(false);
  const [raw, setRaw] = useState<RawConditions | null>(null);
  const [showBaseline, setShowBaseline] = useState(true);
  const [activeLeg, setActiveLeg] = useState<number | null>(null);
  const [briefing, setBriefing] = useState<{ text: string; ai: boolean } | null>(null);
  const [sent, setSent] = useState<Record<string, SendState>>({});
  const [replanning, setReplanning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const autoSentRef = useRef<Set<string>>(new Set());

  const persona = overrides[personaId] ?? getPersona(personaId);

  // Live conditions on mount.
  useEffect(() => {
    let alive = true;
    fetch("/api/conditions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: RawConditions) => alive && setRaw(d))
      .catch(() => alive && setRaw(FALLBACK_CONDITIONS));
    return () => {
      alive = false;
    };
  }, []);

  const cond = useMemo(() => buildConditions(raw ?? FALLBACK_CONDITIONS, stress), [raw, stress]);
  const naive = useMemo(() => planNaive(persona, cond), [persona, cond]);
  const rhythm = useMemo(() => planRhythm(persona, cond), [persona, cond]);
  const notices = useMemo(() => draftLateNotices(persona, rhythm), [persona, rhythm]);

  const flashReplan = useCallback(() => {
    setReplanning(true);
    setTimeout(() => setReplanning(false), 900);
  }, []);

  const switchPersona = (id: string) => {
    if (id === personaId) return;
    setPersonaId(id);
    setActiveLeg(null);
    flashReplan();
  };

  const toggleStress = () => {
    setStress((s) => !s);
    setActiveLeg(null);
    flashReplan();
  };

  // ---- Briefing (LLM if configured, else template) ----------------------
  const facts = useMemo(() => briefingFacts(persona, rhythm), [persona, rhythm]);
  const factsKey = facts.join("\n");
  useEffect(() => {
    const template = templateBriefing(persona, rhythm);
    setBriefing({ text: template, ai: false });
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: persona.name, facts }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((d: { text: string | null }) => {
          if (d.text) setBriefing({ text: d.text, ai: true });
        })
        .catch(() => {});
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // factsKey captures every input that changes the briefing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey]);

  // ---- Notices --------------------------------------------------------------
  const sendNotice = useCallback(
    async (n: LateNotice, auto: boolean) => {
      const key = noticeKey(persona.id, n);
      setSent((s) => ({ ...s, [key]: "sending" }));
      try {
        const r = await fetch("/api/notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: n.to.email, subject: n.subject, body: n.body }),
        });
        const d: { sent: boolean } = await r.json();
        if (d.sent) {
          setSent((s) => ({ ...s, [key]: "sent" }));
          return;
        }
      } catch {
        /* fall through to mailto */
      }
      if (auto) {
        // No email key: don't pop windows unprompted. Leave it for the user.
        setSent((s) => ({ ...s, [key]: "failed" }));
      } else {
        window.location.href = mailtoFor(n);
        setSent((s) => ({ ...s, [key]: "opened" }));
      }
    },
    [persona.id]
  );

  // Auto-send each new draft exactly once when opted in.
  useEffect(() => {
    if (!persona.autoNotify) return;
    for (const n of notices) {
      const key = noticeKey(persona.id, n);
      if (autoSentRef.current.has(key)) continue;
      autoSentRef.current.add(key);
      void sendNotice(n, true);
    }
  }, [notices, persona.autoNotify, persona.id, sendNotice]);

  // ---- Derived figures -------------------------------------------------------
  const homeDock = useMemo(() => {
    let best: { name: string; bikes: number; d: number } | null = null;
    for (const s of cond.bikeStations) {
      const d = haversineKm(persona.home, { name: s.name, short: s.name, lat: s.lat, lng: s.lng });
      if (!best || d < best.d) best = { name: s.name, bikes: s.bikes, d };
    }
    return best;
  }, [cond.bikeStations, persona.home]);

  const lateAvoided = Math.max(0, Math.round(naive.totals.lateMin - rhythm.totals.lateMin));
  const costDiff = rhythm.totals.cost - naive.totals.cost;
  const co2Diff = rhythm.totals.co2g - naive.totals.co2g;
  const disruptions = cond.alerts.length;

  return (
    <main className="relative min-h-screen bg-ink-950 lg:h-screen lg:overflow-hidden">
      {/* Map */}
      <div className="relative h-[42vh] lg:absolute lg:inset-0 lg:h-auto">
        <MapView
          persona={persona}
          rhythm={rhythm}
          naive={naive}
          showBaseline={showBaseline}
          activeLeg={activeLeg}
          onSelectLeg={setActiveLeg}
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[560px] bg-gradient-to-r from-ink-950/90 via-ink-950/40 to-transparent lg:block" />
      </div>

      {/* Left panel */}
      <aside
        className="glass relative z-10 lg:absolute lg:bottom-4 lg:left-4 lg:top-4 lg:w-[440px] lg:overflow-y-auto lg:rounded-2xl"
        aria-label="Rhythm day plan"
      >
        {/* Replanning overlay */}
        {replanning && (
          <div className="shimmer pointer-events-none absolute inset-x-0 top-0 z-20 h-1" aria-live="polite">
            <span className="sr-only">Replanning your day</span>
          </div>
        )}

        {/* 1. Brand */}
        <header className="px-5 pb-3 pt-5">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              rhythm<span className="text-pulse">.</span>
            </h1>
            <span className="text-sm text-slate-400">Your day, not just your route.</span>
          </div>
        </header>

        {/* 2. Persona switcher */}
        <div className="grid grid-cols-2 gap-2 px-5 pb-4" role="tablist" aria-label="Persona">
          {PERSONAS.map((p) => {
            const eff = overrides[p.id] ?? p;
            const on = p.id === personaId;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={on}
                onClick={() => switchPersona(p.id)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  on ? "border-pulse/50 bg-pulse/10" : "border-ink-600 bg-ink-800/60 hover:border-ink-600/0 hover:bg-ink-700"
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display font-bold ${
                    on ? "bg-pulse text-ink-950" : "bg-ink-600 text-slate-200"
                  }`}
                >
                  {p.initials}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {p.name}, {p.age}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {p.tagline} · from {fmt(toMin(eff.dayStart))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 3. Chips + onboarding */}
        <div className="px-5 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {personaChips(persona).map((c) => (
              <span key={c} className="rounded-full border border-ink-600 bg-ink-800/80 px-2.5 py-1 text-[11px] text-slate-300">
                {c}
              </span>
            ))}
          </div>
          <button
            onClick={() => setOnboarding(true)}
            className="mt-3 w-full rounded-xl border border-pulse/40 bg-pulse/10 px-4 py-2 text-sm font-medium text-pulse hover:bg-pulse/20"
          >
            Connect accounts &amp; needs
          </button>
        </div>

        {/* 4. Conditions */}
        <Section
          title="Boston right now"
          right={
            <button onClick={() => setShowDetails((v) => !v)} className="text-xs text-slate-400 hover:text-white" aria-expanded={showDetails}>
              {showDetails ? "Hide details" : "Details"}
            </button>
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-ink-600 bg-ink-800/60 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                MBTA <SourceBadge source={raw?.mbta.source} />
              </div>
              <div className={`mt-1 font-display text-xl font-semibold ${disruptions ? "text-amber-300" : "text-slate-100"}`}>
                {disruptions}
              </div>
              <div className="text-[11px] text-slate-400">disruption{disruptions === 1 ? "" : "s"}</div>
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800/60 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                Weather <SourceBadge source={raw?.weather.source} />
              </div>
              <div className={`mt-1 font-display text-xl font-semibold ${cond.storm ? "text-rose-300" : "text-slate-100"}`}>
                {cond.storm ? "⛈ Storm" : "Clear"}
              </div>
              <div className="truncate text-[11px] text-slate-400">
                {cond.storm ? cond.storm.event : `${cond.weatherAlerts.length} MA alerts`}
              </div>
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800/60 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                Bikes <SourceBadge source={raw?.bikes.source} />
              </div>
              <div className="mt-1 font-display text-xl font-semibold text-slate-100">{homeDock?.bikes ?? "–"}</div>
              <div className="truncate text-[11px] text-slate-400" title={homeDock?.name}>
                {homeDock ? `at ${homeDock.name}` : "no dock"}
              </div>
            </div>
          </div>

          {showDetails && (
            <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
              {cond.alerts.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="font-mono text-[10px] text-amber-300">{a.effect}</span>
                  <span>
                    {a.header}
                    {a.simulated && <span className="text-slate-500"> (simulated)</span>}
                  </span>
                </li>
              ))}
              {cond.weatherAlerts.slice(0, 6).map((w) => (
                <li key={w.id} className="flex gap-2">
                  <span className="font-mono text-[10px] text-rose-300">NWS</span>
                  <span>
                    {w.headline}
                    {w.simulated && <span className="text-slate-500"> (simulated)</span>}
                  </span>
                </li>
              ))}
              {cond.alerts.length + cond.weatherAlerts.length === 0 && <li className="text-slate-500">No active alerts.</li>}
            </ul>
          )}

          <button
            onClick={toggleStress}
            role="switch"
            aria-checked={stress}
            className={`mt-3 flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-sm transition ${
              stress ? "border-rose-400/50 bg-rose-500/10 text-rose-200" : "border-ink-600 bg-ink-800/60 text-slate-300 hover:border-rose-400/40"
            }`}
          >
            <span>⚡ Stress test: storm + Red Line shuttle</span>
            <span className={`h-5 w-9 rounded-full p-0.5 transition ${stress ? "bg-rose-400" : "bg-ink-600"}`}>
              <span className={`block h-4 w-4 rounded-full bg-white transition ${stress ? "translate-x-4" : ""}`} />
            </span>
          </button>
        </Section>

        {/* 5. Briefing */}
        <Section title="Your day" right={briefing?.ai ? <Badge tone="pulse">AI</Badge> : null}>
          <p className={`text-sm leading-relaxed text-slate-200 ${replanning ? "opacity-40" : ""}`}>
            {replanning ? "Replanning your day…" : briefing?.text}
          </p>
        </Section>

        {/* 6. Heads-up messages */}
        {notices.length > 0 && (
          <Section title="Heads-up messages" right={<Badge>{persona.autoNotify ? "Auto-send on" : "Needs your OK"}</Badge>}>
            <div className="space-y-2">
              {notices.map((n) => {
                const key = noticeKey(persona.id, n);
                const st = sent[key];
                return (
                  <div key={key} className="rounded-xl border border-ink-600 bg-ink-800/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">To {n.to.name}</div>
                        <div className="truncate text-sm font-medium text-slate-100">{n.subject}</div>
                      </div>
                      {st === "sent" ? (
                        <Badge tone="green">✓ Sent</Badge>
                      ) : st === "opened" ? (
                        <Badge tone="pulse">Draft opened</Badge>
                      ) : (
                        <button
                          onClick={() => sendNotice(n, false)}
                          disabled={st === "sending"}
                          className="shrink-0 rounded-lg bg-pulse px-3 py-1 text-xs font-semibold text-ink-950 hover:brightness-110 disabled:opacity-50"
                        >
                          {st === "sending" ? "Sending…" : st === "failed" ? "Open draft" : "Send"}
                        </button>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-line text-xs text-slate-400">{n.body.split("\n\n").slice(1, 2).join("")}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* 7. Timeline */}
        <Section title="Timeline" right={<span className="font-mono text-[11px] text-slate-500">leave {fmt(rhythm.legs[0]?.depart ?? toMin(persona.dayStart))}</span>}>
          <ol className={`space-y-3 transition-opacity ${replanning ? "opacity-40" : ""}`}>
            {rhythm.legs.map((leg, i) => (
              <li key={`${leg.eventId}-${i}`} className="space-y-2">
                <LegCard
                  leg={leg}
                  baseline={naive.legs.find((l) => l.eventId === leg.eventId)}
                  selected={activeLeg === i}
                  onSelect={() => setActiveLeg(activeLeg === i ? null : i)}
                />
                {rhythm.events[i] && <EventRow pe={rhythm.events[i]} leg={leg} index={i} />}
              </li>
            ))}
          </ol>
        </Section>

        {/* 8. Learned */}
        <Section title="What Rhythm has learned">
          <ul className="space-y-1.5 text-xs text-slate-300">
            {LEARNED_PATTERNS.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="text-pulse">◆</span>
                {p}
              </li>
            ))}
          </ul>
        </Section>

        {/* 9. Export */}
        <div className="border-t border-ink-600/70 px-5 py-4">
          <button
            onClick={() => downloadIcs(persona, rhythm)}
            className="w-full rounded-xl bg-pulse px-4 py-2.5 text-sm font-semibold text-ink-950 hover:brightness-110"
          >
            ⬇ Export day to calendar (.ics)
          </button>
        </div>

        {/* 10. Footnote */}
        <p className="px-5 pb-5 text-[11px] leading-relaxed text-slate-500">
          Live: MBTA V3 alerts, NWS alerts, Bluebikes GBFS (CACHED when unavailable). Simulated: calendar, bank balances, Uber
          fares. Routes are drawn as curves, not turn-by-turn directions.
        </p>
      </aside>

      {/* Impact card (top-right) */}
      <ImpactCard naive={naive} rhythm={rhythm} lateAvoided={lateAvoided} costDiff={costDiff} co2Diff={co2Diff} replanning={replanning} />

      {/* Legend (bottom-right) */}
      <div className="glass z-10 m-4 rounded-2xl p-3 text-xs lg:absolute lg:bottom-4 lg:right-14 lg:m-0 lg:w-[220px]">
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Legend</div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
          {(Object.keys(MODE_META) as (keyof typeof MODE_META)[]).map((m) => (
            <li key={m} className="flex items-center gap-1.5 text-slate-300">
              <span className="h-1.5 w-4 rounded-full" style={{ background: MODE_META[m].color }} />
              {MODE_META[m].label.replace("MBTA ", "")}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-slate-300">
            <span className="h-1.5 w-4 rounded-full" style={{ background: "#da291c" }} />
            Red Line
          </li>
        </ul>
        <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-ink-600 pt-2 text-slate-300">
          <input type="checkbox" className="accent-[#5eead4]" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
          <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
          Google Maps baseline
        </label>
      </div>

      {onboarding && (
        <Onboarding
          persona={persona}
          cond={cond}
          onClose={() => setOnboarding(false)}
          onSave={(p) => {
            setOverrides((o) => ({ ...o, [p.id]: p }));
            setOnboarding(false);
            setActiveLeg(null);
            flashReplan();
          }}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Impact card (Requirement 6.1)
// ---------------------------------------------------------------------------

function ImpactCard({
  naive,
  rhythm,
  lateAvoided,
  costDiff,
  co2Diff,
  replanning,
}: {
  naive: DayPlan;
  rhythm: DayPlan;
  lateAvoided: number;
  costDiff: number;
  co2Diff: number;
  replanning: boolean;
}) {
  return (
    <div className="glass z-10 m-4 rounded-2xl p-4 lg:absolute lg:right-4 lg:top-4 lg:m-0 lg:w-[300px]">
      <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Rhythm vs. Google Maps</div>
      <div className={`mt-2 flex items-baseline gap-2 transition-opacity ${replanning ? "opacity-30" : ""}`}>
        <span className="font-display text-5xl font-bold text-pulse">{lateAvoided}</span>
        <span className="text-sm text-slate-300">min of lateness avoided</span>
      </div>
      {naive.totals.missed > 0 ? (
        <div className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          Google&apos;s plan misses: <span className="font-semibold">{naive.totals.missedLabels.join(", ")}</span>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-ink-600 bg-ink-800/60 px-3 py-2 text-xs text-slate-400">
          Both plans make every deadline today.
        </div>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-ink-800/60 p-2">
          <dt className="text-[10px] text-slate-400">Baseline late</dt>
          <dd className="font-mono text-sm text-slate-100">{Math.round(naive.totals.lateMin)}m</dd>
        </div>
        <div className="rounded-lg bg-ink-800/60 p-2">
          <dt className="text-[10px] text-slate-400">Cost</dt>
          <dd className={`font-mono text-sm ${costDiff > 0 ? "text-amber-300" : "text-emerald-300"}`}>
            {costDiff >= 0 ? "+" : "−"}
            {money(Math.abs(costDiff))}
          </dd>
        </div>
        <div className="rounded-lg bg-ink-800/60 p-2">
          <dt className="text-[10px] text-slate-400">CO₂</dt>
          <dd className={`font-mono text-sm ${co2Diff > 0 ? "text-amber-300" : "text-emerald-300"}`}>
            {co2Diff >= 0 ? "+" : "−"}
            {Math.abs(Math.round(co2Diff))}g
          </dd>
        </div>
      </dl>
      <div className="mt-2 text-[11px] text-slate-500">
        Rhythm: {Math.round(rhythm.totals.lateMin)} min late · {money(rhythm.totals.cost)} · {rhythm.totals.missed} missed
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leg card (Requirement 6.2)
// ---------------------------------------------------------------------------

function LegCard({
  leg,
  baseline,
  selected,
  onSelect,
}: {
  leg: Leg;
  baseline?: Leg;
  selected: boolean;
  onSelect: () => void;
}) {
  const o = leg.option;
  const differs = baseline && (baseline.option.mode !== o.mode || baseline.option.line !== o.line);
  const reasons = selected ? leg.reasons : leg.reasons.slice(0, 3);
  const color = legColor(o);

  return (
    <div
      className={`rounded-xl border bg-ink-800/60 p-3 transition ${selected ? "border-pulse/60" : "border-ink-600 hover:border-ink-600/0 hover:bg-ink-700/60"}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <button onClick={onSelect} className="w-full text-left" aria-expanded={selected}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span aria-hidden>{modeIcon(o.mode)}</span>
            <span className="text-sm font-semibold text-slate-100">{optionName(leg)}</span>
            {differs && <Badge tone="pulse">Rhythm pick</Badge>}
          </div>
          <span className="font-mono text-xs text-slate-300">{o.cost === 0 ? "free" : money(o.cost)}</span>
        </div>
        <div className="mt-1 font-mono text-xs text-slate-400">
          {fmt(leg.depart)} → {fmt(leg.arrive)} · {Math.round(o.actualMin)} min
        </div>
      </button>

      {reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-300">
          {reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="text-pulse">›</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      {leg.alternatives.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {leg.alternatives.map((a) => (
            <span
              key={a.mode}
              title={a.feasible ? `${Math.round(a.actualMin)} min · ${money(a.cost)}${a.notes.length ? " · " + a.notes.join("; ") : ""}` : a.blockers.join("; ")}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                a.feasible ? "border-ink-600 text-slate-400" : "border-ink-600/60 text-slate-600 line-through"
              }`}
            >
              {modeIcon(a.mode)} {a.mode === "subway" && a.line ? a.line : a.label} {a.feasible ? `${Math.round(a.actualMin)}m` : ""}
            </span>
          ))}
        </div>
      )}

      {baseline && (
        <p className="mt-2 border-t border-ink-600/70 pt-2 text-[11px] text-slate-500">
          Google Maps: {optionName(baseline)}, says {Math.round(baseline.option.nominalMin)} min → really{" "}
          {Math.round(baseline.option.actualMin)}.
          {baseline.missedDeadline ? (
            <span className="text-rose-300"> Misses the cutoff.</span>
          ) : baseline.lateMin > 0.5 ? (
            <span className="text-amber-300"> {Math.round(baseline.lateMin)} min late.</span>
          ) : null}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event row (Requirement 6.3)
// ---------------------------------------------------------------------------

function EventRow({ pe, leg, index }: { pe: PlannedEvent; leg: Leg; index: number }) {
  const ev = pe.event;
  const late = Math.round(leg.lateMin);
  return (
    <div className="ml-3 border-l border-dashed border-ink-600 pl-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold text-ink-950 ${
            ev.priority === "critical" ? "bg-rose-400" : "bg-pulse"
          }`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-100">{ev.title}</span>
            <span className="shrink-0 font-mono text-xs text-slate-400">{fmt(pe.committedStart)}</span>
          </div>
          <div className="text-xs text-slate-400">
            {ev.place.name} · {ev.durationMin} min
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {ev.priority === "critical" && <Badge tone="red">Critical</Badge>}
            {ev.flexible && <Badge>Flexible</Badge>}
            {pe.moved && (
              <Badge tone="pulse">
                Moved {fmt(pe.plannedStart)} → {fmt(pe.committedStart)}
              </Badge>
            )}
            {ev.deadlineLabel && <Badge tone="amber">{ev.deadlineLabel}</Badge>}
            {ev.overrunMin ? <Badge>Usually runs +{ev.overrunMin} min</Badge> : null}
            {late > 0 ? <Badge tone="amber">{late} min late</Badge> : <Badge tone="green">On time</Badge>}
          </div>
        </div>
      </div>
    </div>
  );
}
