import { fmt } from "./engine";
import type { DayPlan, LateNotice, Persona } from "./types";

/**
 * Draft heads-up notices for events whose contact should be told about a move
 * or a >3 min late arrival (Requirement 8.1).
 */
export function draftLateNotices(
  persona: Persona,
  plan: DayPlan
): LateNotice[] {
  const notices: LateNotice[] = [];

  for (const leg of plan.legs) {
    const event = persona.events.find((e) => e.id === leg.eventId);
    if (!event || !event.contact) continue;

    const planned = plan.events.find((p) => p.event.id === event.id);
    const moved = planned?.moved ?? false;
    const late = leg.lateMin > 3;

    if (!moved && !late) continue;

    const newStart = planned
      ? fmt(planned.committedStart)
      : fmt(leg.arrive);

    let reason: LateNotice["reason"] = late ? "late" : "moved";
    let subject: string;
    let intro: string;

    if (moved) {
      reason = "moved";
      subject = `Quick change to "${event.title}"`;
      intro = `I need to shift our "${event.title}" to ${newStart}.`;
    } else {
      subject = `Running a few minutes behind for "${event.title}"`;
      intro = `Heads-up: I'm running about ${Math.round(leg.lateMin)} min late and should arrive around ${fmt(leg.arrive)}.`;
    }

    const body =
      `Hi ${event.contact.name},\n\n` +
      `${intro}\n\n` +
      `Everything's fine — just keeping you in the loop.\n\n` +
      `Thanks,\n${persona.name}\n\n` +
      `— sent by Rhythm on ${persona.name}'s behalf`;

    notices.push({
      eventId: event.id,
      to: event.contact,
      subject,
      body,
      reason,
    });
  }

  return notices;
}

export function mailtoFor(notice: LateNotice): string {
  const params = new URLSearchParams({
    subject: notice.subject,
    body: notice.body,
  });
  return `mailto:${notice.to.email}?${params.toString()}`;
}
