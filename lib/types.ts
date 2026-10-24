export type Mode = "walk" | "bike" | "bus" | "subway" | "rideshare";
export type Priority = "critical" | "high" | "normal" | "flexible";

export interface Place {
  name: string;
  short: string;
  lat: number;
  lng: number;
}

export interface Contact {
  name: string;
  email: string;
}

export interface CalEvent {
  id: string;
  title: string;
  place: Place;
  start: string; // "HH:MM"
  durationMin: number;
  priority: Priority;
  flexible?: boolean;
  deadline?: string; // "HH:MM"
  deadlineLabel?: string;
  overrunMin?: number;
  overrunNote?: string;
  line?: string; // "Red" | "Orange" | "Green-B" | "Silver" ...
  contact?: Contact;
}

export interface Accessibility {
  avoidStairs: boolean;
  wheelchair: boolean;
  maxWalkKm: number;
}

export interface Connections {
  calendar: boolean;
  bank?: { institution: string; mask: string; balance: number };
  uber: boolean;
  bluebikes: "none" | "monthly" | "annual";
}

export interface Persona {
  id: string;
  name: string;
  age: number;
  initials: string;
  tagline: string;
  home: Place;
  dayStart: string; // "HH:MM"
  modes: Mode[];
  mobility: "limited" | "full";
  dailyRideBudget: number;
  costSensitivity: number;
  sustainability: number; // 0..1
  needs: string[];
  accessibility: Accessibility;
  connections: Connections;
  autoNotify: boolean;
  events: CalEvent[];
}

export interface MbtaAlert {
  id: string;
  effect: string;
  header: string;
  severity: number;
  lines: string[];
  simulated?: boolean;
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string;
  severity: string;
  areas: string;
  simulated?: boolean;
}

export interface BikeStation {
  name: string;
  lat: number;
  lng: number;
  bikes: number;
  docks: number;
}

export interface RawConditions {
  fetchedAt: string;
  mbta: { source: "live" | "fallback"; alerts: MbtaAlert[] };
  weather: { source: "live" | "fallback"; alerts: WeatherAlert[] };
  bikes: { source: "live" | "fallback"; stations: BikeStation[] };
}

export interface Conditions {
  alerts: MbtaAlert[];
  weatherAlerts: WeatherAlert[];
  storm: WeatherAlert | null;
  bikeStations: BikeStation[];
}

export interface LegOption {
  mode: Mode;
  line?: string;
  label: string;
  nominalMin: number;
  actualMin: number;
  cost: number;
  co2g: number;
  reliability: number; // 0..1
  feasible: boolean;
  blockers: string[];
  notes: string[];
  score?: number;
}

export interface Leg {
  eventId: string;
  from: Place;
  to: Place;
  option: LegOption;
  alternatives: LegOption[];
  depart: number; // minutes from midnight
  arrive: number; // minutes from midnight
  lateMin: number;
  missedDeadline: boolean;
  reasons: string[];
  path: [number, number][];
}

export interface PlannedEvent {
  event: CalEvent;
  plannedStart: number;
  committedStart: number;
  moved: boolean;
  actualStart: number;
  actualEnd: number;
}

export interface DayPlan {
  strategy: "naive" | "rhythm";
  legs: Leg[];
  events: PlannedEvent[];
  totals: {
    lateMin: number;
    missed: number;
    missedLabels: string[];
    cost: number;
    co2g: number;
    travelMin: number;
  };
  score: number;
}

export interface LateNotice {
  eventId: string;
  to: Contact;
  subject: string;
  body: string;
  reason: "moved" | "late";
}
