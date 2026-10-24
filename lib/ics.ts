import { MODE_META } from "./engine";
import type { DayPlan, Persona } from "./types";

const TZID = "America/New_York";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Build a local date-time stamp (floating, with TZID) for today at `min`. */
function dt(min: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(Math.floor(min / 60) % 24);
  const mm = pad(Math.round(min) % 60);
  return `${y}${mo}${d}T${h}${mm}00`;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function uid(id: string): string {
  return `${id}-${Date.now()}@rhythm.local`;
}

export function buildIcs(persona: Persona, plan: DayPlan): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rhythm//Day Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Rhythm — ${persona.name}'s day`,
  ];

  const stamp = dt(0);

  // Travel block per leg.
  for (const leg of plan.legs) {
    const mode = MODE_META[leg.option.mode].label;
    const title = `${mode}${leg.option.line ? ` · ${leg.option.line}` : ""} → ${leg.to.short}`;
    const desc = [
      `${leg.from.short} → ${leg.to.name}`,
      `Cost: ${leg.option.cost === 0 ? "free" : `$${leg.option.cost.toFixed(2)}`}`,
      ...(leg.reasons.length ? ["", "Why Rhythm chose this:", ...leg.reasons.map((r) => `• ${r}`)] : []),
    ].join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid(`${leg.eventId}-travel`)}`,
      `DTSTAMP:${stamp}Z`,
      `DTSTART;TZID=${TZID}:${dt(leg.depart)}`,
      `DTEND;TZID=${TZID}:${dt(leg.arrive)}`,
      `SUMMARY:🚆 ${escapeText(title)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Time to leave for Rhythm trip",
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT"
    );
  }

  // Each calendar event at its possibly-moved time.
  for (const pe of plan.events) {
    const start = pe.committedStart;
    const end = start + pe.event.durationMin;
    const descParts: string[] = [pe.event.place.name];
    if (pe.moved) {
      descParts.push(`Moved from ${pe.plannedStart} — see Rhythm.`);
    }
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid(pe.event.id)}`,
      `DTSTAMP:${stamp}Z`,
      `DTSTART;TZID=${TZID}:${dt(start)}`,
      `DTEND;TZID=${TZID}:${dt(end)}`,
      `SUMMARY:${escapeText(pe.event.title)}`,
      `LOCATION:${escapeText(pe.event.place.name)}`,
      `DESCRIPTION:${escapeText(descParts.join("\n"))}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  // CRLF line endings per RFC 5545.
  return lines.join("\r\n");
}

export function downloadIcs(persona: Persona, plan: DayPlan): void {
  const ics = buildIcs(persona, plan);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rhythm-${persona.id}-day.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
