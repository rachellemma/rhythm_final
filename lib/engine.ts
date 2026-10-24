import {
  FALLBACK_CONDITIONS,
  SIMULATED_ALERTS,
  SIMULATED_WEATHER,
  surgeAt,
} from "./data";
import type {
  CalEvent,
  Conditions,
  DayPlan,
  Leg,
  LegOption,
  MbtaAlert,
  Mode,
  Persona,
  Place,
  PlannedEvent,
  Priority,
  RawConditions,
  WeatherAlert,
} from "./types";

// ---------------------------------------------------------------------------
// 3.1 Helpers
// ---------------------------------------------------------------------------

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

export function fmt(min: number): string {
  let m = Math.round(min);
  m = ((m % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${mm.toString().padStart(2, "0")} ${ampm}`;
}

export function money(n: number): string {
  if (n === 0) return "$0";
  return `$${n.toFixed(2)}`;
}

export function haversineKm(a: Place, b: Place): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const LINE_COLORS: Record<string, string> = {
  Red: "#da291c",
  Mattapan: "#da291c",
  Orange: "#ed8b00",
  Blue: "#003da5",
  "Green-B": "#00843d",
  "Green-C": "#00843d",
  "Green-D": "#00843d",
  "Green-E": "#00843d",
  Green: "#00843d",
  Silver: "#7c878e",
};

export const MODE_META: Record<Mode, { label: string; color: string; co2PerKm: number }> = {
  walk: { label: "Walk", color: "#9ca3af", co2PerKm: 0 },
  bike: { label: "Bluebikes", color: "#22d3ee", co2PerKm: 0 },
  bus: { label: "MBTA Bus", color: "#fbbf24", co2PerKm: 68 },
  subway: { label: "MBTA Subway", color: "#5eead4", co2PerKm: 41 },
  rideshare: { label: "Uber", color: "#f472b6", co2PerKm: 192 },
};

export function legColor(opt: LegOption): string {
  if (opt.mode === "subway" && opt.line && LINE_COLORS[opt.line]) {
    return LINE_COLORS[opt.line];
  }
  return MODE_META[opt.mode].color;
}

// ---------------------------------------------------------------------------
// 3.2 Conditions
// ---------------------------------------------------------------------------

const STORM_RE = /storm|thunder|wind|flood|snow|ice|blizzard|hurricane|tornado/i;
const BOSTON_COUNTY_RE = /suffolk|middlesex|norfolk/i;

export function buildConditions(
  raw: RawConditions,
  simulate: boolean
): Conditions {
  let alerts: MbtaAlert[] = [...raw.mbta.alerts];
  let weatherAlerts: WeatherAlert[] = [...raw.weather.alerts];

  if (simulate) {
    alerts = [...SIMULATED_ALERTS, ...alerts];
    weatherAlerts = [...SIMULATED_WEATHER, ...weatherAlerts];
  }

  const storm =
    weatherAlerts.find(
      (w) => STORM_RE.test(w.event) && BOSTON_COUNTY_RE.test(w.areas)
    ) ?? null;

  return {
    alerts,
    weatherAlerts,
    storm,
    bikeStations: raw.bikes.stations,
  };
}

const EFFECT_DELAY: Record<string, number> = {
  SHUTTLE: 22,
  SUSPENSION: 30,
  DETOUR: 10,
  DELAY: 8,
  SERVICE_CHANGE: 6,
};

/** Returns the worst matching alert on the given line. */
export function lineImpact(
  cond: Conditions,
  line: string | undefined
): MbtaAlert | null {
  if (!line) return null;
  const matches = cond.alerts.filter((a) => {
    if (a.lines.includes(line)) return true;
    // A Green-X event also matches a generic "Green" alert.
    if (line.startsWith("Green") && a.lines.includes("Green")) return true;
    return false;
  });
  if (matches.length === 0) return null;
  // Worst = highest known effect delay (elevator closure ranks via severity).
  return matches.slice().sort((a, b) => {
    const da = EFFECT_DELAY[a.effect] ?? 0;
    const db = EFFECT_DELAY[b.effect] ?? 0;
    if (db !== da) return db - da;
    return b.severity - a.severity;
  })[0];
}

function elevatorClosure(
  cond: Conditions,
  line: string | undefined
): MbtaAlert | null {
  if (!line) return null;
  return (
    cond.alerts.find(
      (a) =>
        a.effect === "ELEVATOR_CLOSURE" &&
        (a.lines.includes(line) ||
          (line.startsWith("Green") && a.lines.includes("Green")))
    ) ?? null
  );
}

function nearestStation(cond: Conditions, p: Place) {
  let best: (typeof cond.bikeStations)[number] | null = null;
  let bestD = Infinity;
  for (const s of cond.bikeStations) {
    const d = haversineKm({ ...p }, { name: s.name, short: s.name, lat: s.lat, lng: s.lng });
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 3.3 Leg options (Requirement 4)
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 14,
  high: 7,
  normal: 4,
  flexible: 1.5,
};

export function legOptions(
  from: Place,
  to: Place,
  event: CalEvent,
  persona: Persona,
  cond: Conditions,
  departMin: number
): LegOption[] {
  const straight = haversineKm(from, to);
  const dist = straight * 1.3;
  const storm = !!cond.storm;
  const limited =
    persona.mobility === "limited" || persona.accessibility.wheelchair;
  const options: LegOption[] = [];
  const enabled = new Set(persona.modes);

  // ---- Walk -------------------------------------------------------------
  if (enabled.has("walk")) {
    const nominal = (dist / 4.8) * 60;
    let speed = 4.8;
    if (limited) speed = 3.0;
    let actual = (dist / speed) * 60;
    if (storm) actual *= 1.2;
    const feasible = dist <= persona.accessibility.maxWalkKm;
    const blockers: string[] = [];
    if (!feasible) {
      blockers.push(
        `${dist.toFixed(1)} km is past your ${persona.accessibility.maxWalkKm} km max walk`
      );
    }
    const notes: string[] = [];
    if (storm && feasible) notes.push("Slower in the storm");
    options.push({
      mode: "walk",
      label: "Walk",
      nominalMin: nominal,
      actualMin: actual,
      cost: 0,
      co2g: 0,
      reliability: 0.98,
      feasible,
      blockers,
      notes,
    });
  }

  // ---- Bike -------------------------------------------------------------
  if (enabled.has("bike") && !persona.accessibility.wheelchair) {
    const ride = (dist / 14) * 60;
    const nominal = 4 + ride;
    const actual = nominal; // bikes are not slowed; storm makes them infeasible
    const hasPass = persona.connections.bluebikes !== "none";
    const cost = hasPass ? 0 : 2.95;
    const originDock = nearestStation(cond, from);
    const destDock = nearestStation(cond, to);
    const blockers: string[] = [];
    if (storm) blockers.push("Storm — Bluebikes unsafe");
    if (originDock && originDock.bikes === 0)
      blockers.push(`No bikes at ${originDock.name}`);
    if (destDock && destDock.docks === 0)
      blockers.push(`No open docks at ${destDock.name}`);
    const feasible = blockers.length === 0;
    const notes: string[] = [];
    if (hasPass && feasible) notes.push("Included in your Bluebikes pass");
    options.push({
      mode: "bike",
      label: "Bluebikes",
      nominalMin: nominal,
      actualMin: actual,
      cost,
      co2g: 0,
      reliability: 0.85,
      feasible,
      blockers,
      notes,
    });
  }

  // ---- Subway -----------------------------------------------------------
  if (enabled.has("subway")) {
    const access = limited ? 10 : 6;
    const ride = (dist / 24) * 60;
    const nominal = access + 5 + ride;
    let actual = nominal;
    let reliability = 0.9;
    const notes: string[] = [];
    const blockers: string[] = [];

    const impact = lineImpact(cond, event.line);
    if (impact && EFFECT_DELAY[impact.effect] != null) {
      actual += EFFECT_DELAY[impact.effect];
      reliability = 0.55;
      notes.push(
        `${impact.header} (+${EFFECT_DELAY[impact.effect]} min)`
      );
    }

    let feasible = true;
    if (persona.accessibility.avoidStairs) {
      const closure = elevatorClosure(cond, event.line);
      if (closure) {
        feasible = false;
        blockers.push(`Not step-free today — ${closure.header}`);
      }
    }

    options.push({
      mode: "subway",
      line: event.line,
      label: event.line ? `${event.line} Line` : "Subway",
      nominalMin: nominal,
      actualMin: actual,
      cost: 2.4,
      co2g: dist * MODE_META.subway.co2PerKm,
      reliability,
      feasible,
      blockers,
      notes,
    });
  }

  // ---- Bus --------------------------------------------------------------
  if (enabled.has("bus")) {
    const access = limited ? 6 : 4;
    const ride = (dist / 13) * 60;
    let actual = access + 8 + ride;
    let reliability = 0.8;
    const notes: string[] = [];
    if (storm) {
      actual += 8;
      reliability = 0.7;
      notes.push("Storm slows the bus");
    }
    options.push({
      mode: "bus",
      label: "MBTA Bus",
      nominalMin: access + 8 + ride,
      actualMin: actual,
      cost: 1.7,
      co2g: dist * MODE_META.bus.co2PerKm,
      reliability,
      feasible: true,
      blockers: [],
      notes,
    });
  }

  // ---- Rideshare --------------------------------------------------------
  if (enabled.has("rideshare")) {
    const ride = (dist / 22) * 60;
    let actual = 5 + ride;
    if (storm) actual += 6;
    const hour = Math.floor(departMin / 60);
    let surge = surgeAt(hour);
    if (storm) surge *= 1.4;
    const base = Math.max(9, 3.5 + 1.9 * dist) * surge;
    const notes: string[] = [];
    const label = persona.connections.uber ? "Uber" : "Uber (est.)";
    if (surge > 1.25) notes.push(`${surge.toFixed(2)}× surge`);
    if (persona.accessibility.wheelchair)
      notes.push("Requests a wheelchair-accessible vehicle");
    options.push({
      mode: "rideshare",
      label,
      nominalMin: 5 + ride,
      actualMin: actual,
      cost: Math.round(base * 100) / 100,
      co2g: dist * MODE_META.rideshare.co2PerKm,
      reliability: storm ? 0.82 : 0.9,
      feasible: true,
      blockers: [],
      notes,
    });
  }

  return options;
}

// ---------------------------------------------------------------------------
// 3.4 Scoring, evaluation, planning (Requirement 5)
// ---------------------------------------------------------------------------

export function scoreOption(
  option: LegOption,
  persona: Persona,
  event: CalEvent,
  start: number,
  freeAt: number,
  spent: number
): { score: number; depart: number; arrive: number; late: number } {
  if (!option.feasible) {
    return { score: Infinity, depart: freeAt, arrive: freeAt, late: 0 };
  }

  const buffer = (1 - option.reliability) * 25;
  const idealDepart = start - option.actualMin - buffer;
  const depart = Math.max(freeAt, idealDepart);
  const arrive = depart + option.actualMin;
  const late = Math.max(0, arrive - start);

  const weight = PRIORITY_WEIGHT[event.priority];
  let score =
    option.actualMin +
    late * weight +
    option.cost * persona.costSensitivity +
    (option.co2g / 1000) * persona.sustainability * 25;

  // Hard deadline miss.
  if (event.deadline) {
    const dl = toMin(event.deadline);
    if (arrive > dl) score += 400;
  }

  // Budget penalty on cumulative spend.
  const newSpent = spent + option.cost;
  if (newSpent > persona.dailyRideBudget) {
    const overage = newSpent - persona.dailyRideBudget;
    if (event.priority === "critical") {
      score += 8 + 1.5 * overage;
    } else {
      score += 60 + 3 * overage;
    }
  }

  return { score, depart, arrive, late };
}

// ---------------------------------------------------------------------------
// Baseline option selection (Requirement 5.6)
// ---------------------------------------------------------------------------

function naivePick(options: LegOption[]): LegOption | null {
  const allowed = options.filter((o) => {
    if (o.mode === "walk") return o.nominalMin <= 30;
    return o.mode === "subway" || o.mode === "bus";
  });
  if (allowed.length === 0) return null;
  // Lowest advertised (nominal) time, ignoring feasibility / user needs.
  return allowed.slice().sort((a, b) => a.nominalMin - b.nominalMin)[0];
}

interface EvalResult {
  legs: Leg[];
  events: PlannedEvent[];
  totals: DayPlan["totals"];
  score: number;
}

function buildReasons(
  strategy: "naive" | "rhythm",
  event: CalEvent,
  opt: LegOption,
  alternatives: LegOption[],
  moved: number,
  late: number,
  arrive: number,
  cost: number,
  budget: number,
  cond: Conditions
): string[] {
  const reasons: string[] = [];
  if (strategy === "naive") return reasons;

  if (event.overrunMin && event.overrunNote) {
    reasons.push(`Planned for ${event.title} running long.`);
  }
  if (moved !== 0) {
    const dir = moved < 0 ? "earlier" : "later";
    reasons.push(
      `Moved ${event.title} ${Math.abs(moved)} min ${dir}.`
    );
  }

  // Skipped subway due to an alert?
  const subway = alternatives.find((a) => a.mode === "subway");
  if (subway && opt.mode !== "subway") {
    const impact = lineImpact(cond, event.line);
    if (impact && EFFECT_DELAY[impact.effect] != null) {
      reasons.push(
        `Skipped ${event.line} Line: ${impact.effect.toLowerCase()} (+${EFFECT_DELAY[impact.effect]} min).`
      );
    } else if (subway.blockers.length) {
      reasons.push(`Skipped ${event.line} Line: ${subway.blockers[0]}.`);
    }
  }

  if (opt.cost > 0) {
    if (cost <= budget) {
      reasons.push(`${money(opt.cost)} ride fits your ${money(budget)} budget.`);
    } else {
      reasons.push(
        `${money(opt.cost)} ride — reserved for this critical trip.`
      );
    }
  }

  if (event.deadline && event.deadlineLabel) {
    reasons.push(
      `${event.deadlineLabel} — arriving ${fmt(arrive)}.`
    );
  }

  for (const n of opt.notes) {
    if (!reasons.some((r) => r.includes(n))) reasons.push(n);
  }

  return reasons;
}

export function evaluate(
  persona: Persona,
  cond: Conditions,
  strategy: "naive" | "rhythm",
  offsets: Record<string, number>
): EvalResult {
  const legs: Leg[] = [];
  const plannedEvents: PlannedEvent[] = [];
  let from = persona.home;
  let freeAt = toMin(persona.dayStart);
  let spent = 0;
  let totalScore = 0;

  const sorted = persona.events
    .slice()
    .sort((a, b) => toMin(a.start) - toMin(b.start));

  for (const event of sorted) {
    const offset = offsets[event.id] ?? 0;
    const start = toMin(event.start) + offset;
    const options = legOptions(from, event.place, event, persona, cond, freeAt);

    let chosen: LegOption | null;
    let depart: number;
    let arrive: number;
    let late: number;

    if (strategy === "naive") {
      chosen = naivePick(options);
      if (!chosen) {
        // Nothing a generic map app offers; fall back to the slowest transit.
        chosen = options.find((o) => o.mode === "subway") ?? options[0] ?? null;
      }
      if (chosen) {
        depart = start - chosen.nominalMin; // departs on advertised time
        arrive = depart + chosen.actualMin; // experiences actual time
        late = Math.max(0, arrive - start);
      } else {
        depart = start;
        arrive = start;
        late = 0;
      }
    } else {
      let best: {
        opt: LegOption;
        s: ReturnType<typeof scoreOption>;
      } | null = null;
      for (const o of options) {
        const s = scoreOption(o, persona, event, start, freeAt, spent);
        o.score = s.score;
        if (!best || s.score < best.s.score) best = { opt: o, s };
      }
      chosen = best ? best.opt : null;
      depart = best ? best.s.depart : start;
      arrive = best ? best.s.arrive : start;
      late = best ? best.s.late : 0;
    }

    if (!chosen) continue;

    spent += chosen.cost;

    const missedDeadline = event.deadline
      ? arrive > toMin(event.deadline)
      : false;

    const alternatives = options.filter((o) => o !== chosen);
    const reasons = buildReasons(
      strategy,
      event,
      chosen,
      options,
      offset,
      late,
      arrive,
      spent,
      persona.dailyRideBudget,
      cond
    );

    legs.push({
      eventId: event.id,
      from,
      to: event.place,
      option: chosen,
      alternatives,
      depart,
      arrive,
      lateMin: late,
      missedDeadline,
      reasons,
      path: curvePath(from, event.place, chosen.mode),
    });

    const actualStart = Math.max(arrive, start);
    const actualEnd = actualStart + event.durationMin + (event.overrunMin ?? 0);

    plannedEvents.push({
      event,
      plannedStart: toMin(event.start),
      committedStart: start,
      moved: offset !== 0,
      actualStart,
      actualEnd,
    });

    // Score accrual for the whole-day comparison.
    if (strategy === "rhythm") {
      totalScore += chosen.score ?? 0;
      if (offset !== 0) totalScore += 3 + 0.6 * Math.abs(offset);
    } else {
      const weight = PRIORITY_WEIGHT[event.priority];
      totalScore += chosen.actualMin + late * weight;
      if (missedDeadline) totalScore += 400;
    }

    from = event.place;
    freeAt = actualEnd;
  }

  const totals = {
    lateMin: legs.reduce((s, l) => s + l.lateMin, 0),
    missed: legs.filter((l) => l.missedDeadline).length,
    missedLabels: legs
      .filter((l) => l.missedDeadline)
      .map((l) => sorted.find((e) => e.id === l.eventId)?.title ?? l.eventId),
    cost: legs.reduce((s, l) => s + l.option.cost, 0),
    co2g: legs.reduce((s, l) => s + l.option.co2g, 0),
    travelMin: legs.reduce((s, l) => s + l.option.actualMin, 0),
  };

  return { legs, events: plannedEvents, totals, score: totalScore };
}

export function planNaive(persona: Persona, cond: Conditions): DayPlan {
  const r = evaluate(persona, cond, "naive", {});
  return { strategy: "naive", ...r };
}

export function planRhythm(persona: Persona, cond: Conditions): DayPlan {
  const flexible = persona.events.filter((e) => e.flexible);
  const steps: number[] = [];
  for (let d = -30; d <= 30; d += 5) steps.push(d);

  // Exhaustive search over flexible-event offsets.
  const combos: Record<string, number>[] = [{}];
  for (const ev of flexible) {
    const next: Record<string, number>[] = [];
    for (const base of combos) {
      for (const s of steps) {
        next.push({ ...base, [ev.id]: s });
      }
    }
    combos.length = 0;
    combos.push(...next);
  }

  let best: EvalResult | null = null;
  for (const offsets of combos) {
    const r = evaluate(persona, cond, "rhythm", offsets);
    if (!best || r.score < best.score) best = r;
  }

  const result = best ?? evaluate(persona, cond, "rhythm", {});
  return { strategy: "rhythm", ...result };
}

// ---------------------------------------------------------------------------
// 3.5 Curve path for the map (Requirement 7.2)
// ---------------------------------------------------------------------------

const CURVE_BY_MODE: Record<Mode, number> = {
  walk: 0.08,
  bike: 0.14,
  bus: 0.2,
  subway: 0.26,
  rideshare: 0.17,
};

export function curvePath(a: Place, b: Place, mode: Mode): [number, number][] {
  const N = 33;
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  // Perpendicular offset for the control point.
  const dx = bx - ax;
  const dy = by - ay;
  const curve = CURVE_BY_MODE[mode];
  const cx = mx - dy * curve;
  const cy = my + dx * curve;

  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx;
    const y = u * u * ay + 2 * u * t * cy + t * t * by;
    pts.push([x, y]);
  }
  return pts;
}

// Convenience export used by the client when conditions haven't loaded.
export { FALLBACK_CONDITIONS };
