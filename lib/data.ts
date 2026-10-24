import type {
  BikeStation,
  MbtaAlert,
  Persona,
  RawConditions,
  WeatherAlert,
} from "./types";

// ---------------------------------------------------------------------------
// Personas (Requirement 1)
// ---------------------------------------------------------------------------

export const ROSA: Persona = {
  id: "rosa",
  name: "Rosa",
  age: 74,
  initials: "R",
  tagline: "Fields Corner, Dorchester",
  home: {
    name: "Home · Fields Corner",
    short: "Home",
    lat: 42.3001,
    lng: -71.0613,
  },
  dayStart: "09:15",
  modes: ["walk", "subway", "bus", "rideshare"],
  mobility: "limited",
  dailyRideBudget: 20,
  costSensitivity: 1.8,
  sustainability: 0.15,
  needs: ["Walks with a cane", "Avoids stairs", "Max walk 1.2 km"],
  accessibility: { avoidStairs: true, wheelchair: false, maxWalkKm: 1.2 },
  connections: {
    calendar: true,
    bank: undefined,
    uber: false,
    bluebikes: "none",
  },
  autoNotify: false,
  events: [
    {
      id: "rosa-cardio",
      title: "Cardiology follow-up",
      place: {
        name: "Boston Medical Center",
        short: "BMC",
        lat: 42.3355,
        lng: -71.073,
      },
      start: "10:00",
      durationMin: 45,
      priority: "high",
      overrunMin: 35,
      overrunNote: "Cardiology follow-ups here usually run 35 min long",
      line: "Red",
    },
    {
      id: "rosa-lunch",
      title: "Lunch with Carmen",
      place: {
        name: "Downtown Crossing",
        short: "Downtown Xing",
        lat: 42.3555,
        lng: -71.0605,
      },
      start: "12:00",
      durationMin: 60,
      priority: "flexible",
      flexible: true,
      line: "Silver",
      contact: { name: "Carmen", email: "carmen@example.com" },
    },
    {
      id: "rosa-cvs",
      title: "Pick up heart medication",
      place: {
        name: "CVS Fields Corner",
        short: "CVS",
        lat: 42.3009,
        lng: -71.0592,
      },
      start: "13:45",
      durationMin: 15,
      priority: "critical",
      deadline: "14:00",
      deadlineLabel: "Pharmacy counter closes 2:00 PM Sat",
      line: "Red",
    },
  ],
};

export const JAY: Persona = {
  id: "jay",
  name: "Jay",
  age: 20,
  initials: "J",
  tagline: "Allston",
  home: { name: "Home · Allston", short: "Home", lat: 42.353, lng: -71.132 },
  dayStart: "08:20",
  modes: ["walk", "bike", "subway", "bus", "rideshare"],
  mobility: "full",
  dailyRideBudget: 12,
  costSensitivity: 1.3,
  sustainability: 0.85,
  needs: ["Full mobility", "Max walk 4 km", "Prefers bikes & transit"],
  accessibility: { avoidStairs: false, wheelchair: false, maxWalkKm: 4 },
  connections: {
    calendar: true,
    bank: undefined,
    uber: false,
    bluebikes: "none",
  },
  autoNotify: false,
  events: [
    {
      id: "jay-cs237",
      title: "CS 237 lecture",
      place: {
        name: "BU Center for Computing & Data Sciences",
        short: "BU CDS",
        lat: 42.35,
        lng: -71.104,
      },
      start: "09:00",
      durationMin: 90,
      priority: "normal",
      line: "Green-B",
    },
    {
      id: "jay-cafe",
      title: "Shift at Kendall Square café",
      place: {
        name: "Kendall Square café",
        short: "Café",
        lat: 42.3626,
        lng: -71.0843,
      },
      start: "12:00",
      durationMin: 240,
      priority: "high",
      overrunMin: 12,
      overrunNote: "Closing side-work usually runs 12 min long",
      line: "Red",
      contact: { name: "Shift manager", email: "manager@example.com" },
    },
    {
      id: "jay-mgh",
      title: "Follow-up appointment",
      place: {
        name: "Mass General Hospital",
        short: "MGH",
        lat: 42.3632,
        lng: -71.0686,
      },
      start: "16:45",
      durationMin: 30,
      priority: "critical",
      deadline: "17:00",
      deadlineLabel: "Slot released if 15+ min late",
      line: "Red",
      contact: { name: "MGH Scheduling", email: "scheduling@example.com" },
    },
  ],
};

export const PERSONAS: Persona[] = [ROSA, JAY];

export function getPersona(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? ROSA;
}

// ---------------------------------------------------------------------------
// Saturday rideshare surge table (Requirement 4.6)
// ---------------------------------------------------------------------------

export const SURGE_BY_HOUR: Record<number, number> = {
  6: 1.0,
  7: 1.0,
  8: 1.1,
  9: 1.15,
  10: 1.2,
  11: 1.3,
  12: 1.4,
  13: 1.3,
  14: 1.2,
  15: 1.25,
  16: 1.45,
  17: 1.7,
  18: 1.6,
  19: 1.4,
  20: 1.3,
  21: 1.5,
  22: 1.8,
  23: 1.9,
};

export function surgeAt(hour: number): number {
  if (hour <= 6) return SURGE_BY_HOUR[6];
  if (hour >= 23) return SURGE_BY_HOUR[23];
  return SURGE_BY_HOUR[hour] ?? 1.2;
}

// ---------------------------------------------------------------------------
// Learned patterns (Requirement 6.5)
// ---------------------------------------------------------------------------

export const LEARNED_PATTERNS: string[] = [
  "Cardiology follow-ups at BMC usually run ~35 min long — Rhythm pads the schedule.",
  "Red Line south of JFK/UMass sees seasonal shuttle diversions on weekends.",
  "Saturday Uber surge climbs steeply after 4 PM (1.45×) and again late at night.",
  "Closing side-work at the Kendall café adds ~12 min past shift end.",
];

// ---------------------------------------------------------------------------
// Simulated alerts for the stress test (Requirement 3.5)
// ---------------------------------------------------------------------------

export const SIMULATED_ALERTS: MbtaAlert[] = [
  {
    id: "sim-red-shuttle",
    effect: "SHUTTLE",
    header:
      "Red Line: shuttle buses replace trains between Kendall/MIT and JFK/UMass",
    severity: 7,
    lines: ["Red"],
    simulated: true,
  },
];

export const SIMULATED_WEATHER: WeatherAlert[] = [
  {
    id: "sim-storm",
    event: "Severe Thunderstorm Warning",
    headline: "Severe Thunderstorm Warning for Suffolk, Middlesex & Norfolk",
    severity: "Severe",
    areas: "Suffolk; Middlesex; Norfolk",
    simulated: true,
  },
];

// ---------------------------------------------------------------------------
// Mock banks (Requirement 2.4)
// ---------------------------------------------------------------------------

export interface MockBank {
  institution: string;
  mask: string;
  balance: number;
}

export const MOCK_BANKS: MockBank[] = [
  { institution: "Chase", mask: "4821", balance: 412.18 },
  { institution: "Bank of America", mask: "0937", balance: 186.4 },
  { institution: "Santander", mask: "5512", balance: 1240.0 },
  { institution: "Citizens", mask: "7703", balance: 63.25 },
];

export function suggestDailyBudget(balance: number): number {
  const raw = balance * 0.04;
  return Math.round(Math.min(40, Math.max(5, raw)));
}

// ---------------------------------------------------------------------------
// Fallback conditions (Requirement 3.2 / tasks 2.3)
// ---------------------------------------------------------------------------

export const FALLBACK_CONDITIONS: RawConditions = {
  fetchedAt: new Date(0).toISOString(),
  mbta: {
    source: "fallback",
    alerts: [
      {
        id: "fb-red-elevator",
        effect: "ELEVATOR_CLOSURE",
        header: "Elevator at JFK/UMass (Red Line) out of service",
        severity: 5,
        lines: ["Red"],
      },
      {
        id: "fb-green-delay",
        effect: "DELAY",
        header: "Green Line B: minor delays due to signal work",
        severity: 3,
        lines: ["Green-B"],
      },
    ],
  },
  weather: {
    source: "fallback",
    alerts: [],
  },
  bikes: {
    source: "fallback",
    stations: [
      // Near Rosa (Dorchester / Fields Corner)
      { name: "Fields Corner T", lat: 42.3005, lng: -71.0618, bikes: 6, docks: 9 },
      { name: "Downtown Crossing", lat: 42.3557, lng: -71.0603, bikes: 11, docks: 4 },
      { name: "Boston Medical Center", lat: 42.3352, lng: -71.0735, bikes: 8, docks: 7 },
      // Near Jay (Allston / BU / Kendall / MGH)
      { name: "Allston / Harvard Ave", lat: 42.3534, lng: -71.1318, bikes: 5, docks: 12 },
      { name: "BU Central", lat: 42.3498, lng: -71.1045, bikes: 9, docks: 6 },
      { name: "Kendall T", lat: 42.3625, lng: -71.0846, bikes: 1, docks: 15 },
      { name: "MGH / Charles Circle", lat: 42.3618, lng: -71.0702, bikes: 7, docks: 8 },
    ],
  },
};
