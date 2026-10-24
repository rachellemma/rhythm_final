"use client";

import { useState } from "react";
import { MOCK_BANKS, suggestDailyBudget } from "@/lib/data";
import { legOptions, money, toMin } from "@/lib/engine";
import type { Conditions, Mode, Persona } from "@/lib/types";

interface Props {
  persona: Persona;
  cond: Conditions;
  onClose: () => void;
  onSave: (p: Persona) => void;
}

const STEPS = ["Calendar", "Access", "Money", "Rides", "Values"] as const;
const CONNECT_MS = 1100;

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-xl border border-ink-600 bg-ink-800/60 px-4 py-3 ${
        disabled ? "opacity-50" : "cursor-pointer hover:border-pulse/40"
      }`}
    >
      <span>
        <span className="block text-sm text-slate-100">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="mt-1 h-4 w-4 accent-[#5eead4]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block rounded-xl border border-ink-600 bg-ink-800/60 px-4 py-3">
      <span className="flex items-center justify-between text-sm">
        <span className="text-slate-100">{label}</span>
        <span className="font-mono text-pulse">{display}</span>
      </span>
      <input
        type="range"
        className="mt-2 w-full accent-[#5eead4]"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="spin inline-block h-4 w-4 rounded-full border-2 border-pulse/30 border-t-pulse"
    />
  );
}

export default function Onboarding({ persona, cond, onClose, onSave }: Props) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Persona>(() => structuredClone(persona));
  const [busy, setBusy] = useState<string | null>(null);
  const [calendarShown, setCalendarShown] = useState(false);

  const update = (fn: (p: Persona) => Persona) => setDraft((p) => fn(structuredClone(p)));

  const simulate = (key: string, done: () => void) => {
    setBusy(key);
    setTimeout(() => {
      done();
      setBusy(null);
    }, CONNECT_MS);
  };

  const setMode = (p: Persona, mode: Mode, on: boolean) => {
    const has = p.modes.includes(mode);
    if (on && !has) p.modes.push(mode);
    if (!on && has) p.modes = p.modes.filter((m) => m !== mode);
    return p;
  };

  // First-trip Uber fare estimate.
  const first = draft.events[0];
  const firstFare = first
    ? legOptions(
        draft.home,
        first.place,
        first,
        { ...draft, modes: ["rideshare"], connections: { ...draft.connections, uber: true } },
        cond,
        toMin(draft.dayStart)
      ).find((o) => o.mode === "rideshare")?.cost ?? 0
    : 0;

  const wheelchair = draft.accessibility.wheelchair;
  const last = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-title"
    >
      <div className="glass fade-up flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl">
        <div className="border-b border-ink-600 px-6 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <h2 id="onb-title" className="font-display text-lg font-semibold">
              Connect accounts &amp; needs
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-slate-400 hover:bg-ink-700 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="mt-4 flex gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${i <= step ? "bg-pulse" : "bg-ink-600"}`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Step {step + 1} of {STEPS.length} · <span className="text-slate-200">{STEPS[step]}</span>
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <>
              <p className="text-sm text-slate-300">
                Rhythm reads today&apos;s calendar so it can plan every trip, not just one.
              </p>
              {!calendarShown ? (
                <button
                  onClick={() => simulate("calendar", () => setCalendarShown(true))}
                  disabled={busy === "calendar"}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 text-sm hover:border-pulse/50"
                >
                  {busy === "calendar" ? <Spinner /> : "📅"} Connect Google Calendar
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-pulse">✓ Connected · {draft.events.length} events today</p>
                  {draft.events.map((e) => (
                    <div key={e.id} className="rounded-xl border border-ink-600 bg-ink-800/60 px-4 py-2.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-100">{e.title}</span>
                        <span className="font-mono text-xs text-slate-400">{e.start}</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {e.place.name}
                        {e.contact && <> · with {e.contact.name}</>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Toggle
                label="Avoid stairs (step-free stations only)"
                checked={draft.accessibility.avoidStairs}
                disabled={wheelchair}
                onChange={(v) => update((p) => ((p.accessibility.avoidStairs = v), p))}
              />
              <Toggle
                label="I use a wheelchair"
                hint="Turns on step-free routing and accessible rides"
                checked={wheelchair}
                onChange={(v) =>
                  update((p) => {
                    p.accessibility.wheelchair = v;
                    if (v) {
                      p.accessibility.avoidStairs = true;
                      setMode(p, "bike", false);
                    }
                    return p;
                  })
                }
              />
              <Toggle
                label="I walk slowly or with a cane"
                checked={draft.mobility === "limited"}
                onChange={(v) => update((p) => ((p.mobility = v ? "limited" : "full"), p))}
              />
              <Slider
                label="Max walk"
                min={0.3}
                max={5}
                step={0.1}
                value={draft.accessibility.maxWalkKm}
                display={`${draft.accessibility.maxWalkKm.toFixed(1)} km`}
                onChange={(v) => update((p) => ((p.accessibility.maxWalkKm = v), p))}
              />
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs text-slate-400">🔒 Read-only access. Rhythm can see your balance, never move money.</p>
              <div className="grid grid-cols-2 gap-2">
                {MOCK_BANKS.map((b) => {
                  const connected = draft.connections.bank?.institution === b.institution;
                  return (
                    <button
                      key={b.institution}
                      disabled={!!busy}
                      onClick={() =>
                        simulate(b.institution, () =>
                          update((p) => {
                            p.connections.bank = { ...b };
                            p.dailyRideBudget = suggestDailyBudget(b.balance);
                            return p;
                          })
                        )
                      }
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ${
                        connected ? "border-pulse/60 bg-pulse/10" : "border-ink-600 bg-ink-800/60 hover:border-pulse/40"
                      }`}
                    >
                      <span>
                        <span className="block text-slate-100">{b.institution}</span>
                        <span className="font-mono text-xs text-slate-400">••{b.mask}</span>
                      </span>
                      {busy === b.institution ? <Spinner /> : connected ? <span className="text-pulse">✓</span> : null}
                    </button>
                  );
                })}
              </div>
              {draft.connections.bank && (
                <div className="rounded-xl border border-ink-600 bg-ink-800/60 px-4 py-3 text-sm">
                  Balance{" "}
                  <span className="font-mono text-slate-100">{money(draft.connections.bank.balance)}</span>
                  <span className="block text-xs text-slate-400">
                    Suggested daily ride budget: {money(suggestDailyBudget(draft.connections.bank.balance))} (4% of balance, $5–$40)
                  </span>
                </div>
              )}
              <Slider
                label="Daily ride budget"
                min={0}
                max={60}
                step={1}
                value={draft.dailyRideBudget}
                display={`$${draft.dailyRideBudget}`}
                onChange={(v) => update((p) => ((p.dailyRideBudget = v), p))}
              />
            </>
          )}

          {step === 3 && (
            <>
              {!draft.connections.uber ? (
                <button
                  disabled={busy === "uber"}
                  onClick={() =>
                    simulate("uber", () =>
                      update((p) => {
                        p.connections.uber = true;
                        return setMode(p, "rideshare", true);
                      })
                    )
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 text-sm hover:border-pulse/50"
                >
                  {busy === "uber" ? <Spinner /> : "🚗"} Connect Uber
                </button>
              ) : (
                <div className="rounded-xl border border-pulse/40 bg-pulse/5 px-4 py-3 text-sm">
                  <p className="text-pulse">✓ Uber connected · live fares</p>
                  {first && (
                    <p className="mt-1 text-slate-300">
                      First trip to {first.place.short}: ~{money(firstFare)}.{" "}
                      {firstFare <= draft.dailyRideBudget
                        ? `Fits your $${draft.dailyRideBudget} daily budget.`
                        : `That's over your $${draft.dailyRideBudget} budget, so Rhythm will save Uber for critical trips.`}
                    </p>
                  )}
                </div>
              )}

              <fieldset
                disabled={wheelchair}
                className={`rounded-xl border border-ink-600 bg-ink-800/60 px-4 py-3 ${wheelchair ? "opacity-50" : ""}`}
              >
                <legend className="px-1 text-sm text-slate-100">Bluebikes</legend>
                {wheelchair && <p className="text-xs text-slate-400">Bikes are off for wheelchair routing.</p>}
                <div className="mt-1 flex gap-2">
                  {(
                    [
                      ["none", "Pay per ride"],
                      ["monthly", "Monthly"],
                      ["annual", "Annual"],
                    ] as const
                  ).map(([val, lbl]) => (
                    <button
                      type="button"
                      key={val}
                      onClick={() => update((p) => ((p.connections.bluebikes = val), p))}
                      aria-pressed={draft.connections.bluebikes === val}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${
                        draft.connections.bluebikes === val
                          ? "border-pulse/60 bg-pulse/10 text-pulse"
                          : "border-ink-600 text-slate-300"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="accent-[#5eead4]"
                    checked={draft.modes.includes("bike") && !wheelchair}
                    onChange={(e) => update((p) => setMode(p, "bike", e.target.checked))}
                  />
                  Suggest bikes to me
                </label>
              </fieldset>
            </>
          )}

          {step === 4 && (
            <>
              <Slider
                label="Sustainability"
                min={0}
                max={100}
                step={5}
                value={Math.round(draft.sustainability * 100)}
                display={`${Math.round(draft.sustainability * 100)}%`}
                onChange={(v) => update((p) => ((p.sustainability = v / 100), p))}
              />
              <Slider
                label="Price sensitivity"
                min={0.3}
                max={3}
                step={0.1}
                value={draft.costSensitivity}
                display={`${draft.costSensitivity.toFixed(1)}×`}
                onChange={(v) => update((p) => ((p.costSensitivity = v), p))}
              />
              <Toggle
                label="Email my contacts automatically when I'm running late"
                hint="Off means Rhythm drafts each message and you approve it"
                checked={draft.autoNotify}
                onChange={(v) => update((p) => ((p.autoNotify = v), p))}
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ink-600 px-6 py-4">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-ink-700 disabled:opacity-30"
          >
            Back
          </button>
          <button
            onClick={() => (last ? onSave(draft) : setStep((s) => s + 1))}
            className="rounded-lg bg-pulse px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-110"
          >
            {last ? "Save & replan" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
