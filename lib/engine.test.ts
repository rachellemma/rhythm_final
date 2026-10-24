/**
 * Engine scenario + unit tests. Run with: npm test  (uses tsx)
 * No test framework required — this is a plain assertion script so it runs
 * anywhere Node + tsx is available.
 */
import { FALLBACK_CONDITIONS, JAY, ROSA, surgeAt } from "./data";
import {
  buildConditions,
  fmt,
  legOptions,
  planNaive,
  planRhythm,
  toMin,
} from "./engine";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// --------------------------------------------------------------------------
console.log("\nScenario: stress test ON, fallback data (Requirement 5.8)");
// --------------------------------------------------------------------------
const cond = buildConditions(FALLBACK_CONDITIONS, true);

for (const persona of [ROSA, JAY]) {
  const rhythm = planRhythm(persona, cond);
  const naive = planNaive(persona, cond);
  console.log(`\n  ${persona.name}:`);
  eq(rhythm.totals.missed, 0, `Rhythm misses 0 deadlines for ${persona.name}`);
  eq(naive.totals.missed, 1, `Baseline misses 1 deadline for ${persona.name}`);
}

// Rosa's lunch should be moved earlier.
const rosaRhythm = planRhythm(ROSA, cond);
const lunch = rosaRhythm.events.find((e) => e.event.id === "rosa-lunch")!;
assert(
  lunch.committedStart < lunch.plannedStart,
  `Rosa's lunch is moved earlier (${fmt(lunch.plannedStart)} -> ${fmt(lunch.committedStart)})`
);

// No Rosa subway leg chosen while the Red Line elevator is out.
const rosaSubwayOnRed = rosaRhythm.legs.some(
  (l) => l.option.mode === "subway" && l.option.line === "Red"
);
assert(
  !rosaSubwayOnRed,
  "Rosa takes no Red Line subway leg during the elevator outage"
);

// Baseline misses Rosa's medication specifically.
const rosaNaive = planNaive(ROSA, cond);
assert(
  rosaNaive.totals.missedLabels.some((l) => /medication/i.test(l)),
  "Baseline misses Rosa's medication pickup"
);

// Baseline misses Jay's MGH appointment specifically.
const jayNaive = planNaive(JAY, cond);
assert(
  jayNaive.totals.missedLabels.some((l) => /Follow-up/i.test(l)),
  "Baseline misses Jay's MGH follow-up"
);

// --------------------------------------------------------------------------
console.log("\nUnit tests");
// --------------------------------------------------------------------------

// toMin / fmt round trip
eq(toMin("09:15"), 555, "toMin('09:15') === 555");
eq(fmt(555), "9:15 AM", "fmt(555) === '9:15 AM'");
eq(fmt(toMin("13:45")), "1:45 PM", "fmt round-trips 13:45 -> 1:45 PM");

// surge x storm multiplier (4 PM = 1.45, x1.4 storm)
const s = surgeAt(16) * 1.4;
assert(Math.abs(s - 2.03) < 1e-9, `surge 4PM x storm === ${s.toFixed(2)}`);

// Walk infeasible beyond maxWalkKm (use a far destination for Rosa).
{
  const far = { name: "Far", short: "Far", lat: 42.45, lng: -71.2 };
  const opts = legOptions(
    ROSA.home,
    far,
    ROSA.events[0],
    ROSA,
    cond,
    toMin("09:15")
  );
  const walk = opts.find((o) => o.mode === "walk")!;
  assert(!walk.feasible, "Walk is infeasible beyond Rosa's max walk");
}

// Bike $0 with a pass.
{
  const jayPass = {
    ...JAY,
    connections: { ...JAY.connections, bluebikes: "monthly" as const },
  };
  const opts = legOptions(
    jayPass.home,
    jayPass.events[0].place,
    jayPass.events[0],
    jayPass,
    buildConditions(FALLBACK_CONDITIONS, false), // no storm so bikes are feasible
    toMin("08:20")
  );
  const bike = opts.find((o) => o.mode === "bike")!;
  eq(bike.cost, 0, "Bike costs $0 with a Bluebikes pass");
}

// --------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
