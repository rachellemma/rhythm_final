import { NextResponse } from "next/server";
import { FALLBACK_CONDITIONS } from "@/lib/data";
import type {
  BikeStation,
  MbtaAlert,
  RawConditions,
  WeatherAlert,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMEOUT_MS = 4500;

const LINES = [
  "Red",
  "Orange",
  "Blue",
  "Green-B",
  "Green-C",
  "Green-D",
  "Green-E",
  "Mattapan",
];

const EFFECT_MAP: Record<string, string> = {
  SHUTTLE: "SHUTTLE",
  SUSPENSION: "SUSPENSION",
  DETOUR: "DETOUR",
  DELAY: "DELAY",
  SERVICE_CHANGE: "SERVICE_CHANGE",
  STATION_CLOSURE: "SERVICE_CHANGE",
  STOP_CLOSURE: "SERVICE_CHANGE",
  ELEVATOR_CLOSURE: "ELEVATOR_CLOSURE",
  ACCESS_ISSUE: "ELEVATOR_CLOSURE",
};

function signal() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function fetchMbta(): Promise<MbtaAlert[]> {
  const key = process.env.MBTA_API_KEY;
  const url = new URL("https://api-v3.mbta.com/alerts");
  url.searchParams.set("filter[route]", LINES.join(","));
  url.searchParams.set("filter[activity]", "BOARD,EXIT,RIDE,USING_WHEELCHAIR");
  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;

  const res = await fetch(url.toString(), {
    headers,
    cache: "no-store",
    signal: signal(),
  });
  if (!res.ok) throw new Error(`MBTA ${res.status}`);
  const json = await res.json();
  const now = Date.now();

  const alerts: MbtaAlert[] = [];
  for (const d of json.data ?? []) {
    const attr = d.attributes ?? {};
    // Active now?
    const periods = attr.active_period ?? [];
    const activeNow =
      periods.length === 0 ||
      periods.some((p: { start?: string; end?: string }) => {
        const start = p.start ? new Date(p.start).getTime() : -Infinity;
        const end = p.end ? new Date(p.end).getTime() : Infinity;
        return now >= start && now <= end;
      });
    if (!activeNow) continue;

    // Only keep real service disruptions (skip parking notices, etc.).
    const effect = EFFECT_MAP[attr.effect];
    if (!effect) continue;
    const lines = new Set<string>();
    for (const entity of attr.informed_entity ?? []) {
      const r = entity.route;
      if (typeof r === "string") {
        if (r.startsWith("Green-")) lines.add(r);
        else if (r === "Mattapan") lines.add("Mattapan");
        else if (LINES.includes(r)) lines.add(r);
      }
    }
    if (lines.size === 0) continue;

    alerts.push({
      id: d.id,
      effect,
      header: attr.header ?? attr.short_header ?? "MBTA service alert",
      severity: attr.severity ?? 5,
      lines: [...lines],
    });
  }
  return alerts;
}

async function fetchWeather(): Promise<WeatherAlert[]> {
  const res = await fetch("https://api.weather.gov/alerts/active?area=MA", {
    headers: {
      "User-Agent": "Rhythm Day Planner (demo; contact@rhythm.example)",
      Accept: "application/geo+json",
    },
    cache: "no-store",
    signal: signal(),
  });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const json = await res.json();
  const alerts: WeatherAlert[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    alerts.push({
      id: f.id ?? p.id ?? Math.random().toString(36).slice(2),
      event: p.event ?? "Weather alert",
      headline: p.headline ?? p.event ?? "Weather alert",
      severity: p.severity ?? "Unknown",
      areas: p.areaDesc ?? "",
    });
  }
  return alerts;
}

async function fetchBikes(): Promise<BikeStation[]> {
  const base = "https://gbfs.bluebikes.com/gbfs/en";
  const [infoRes, statusRes] = await Promise.all([
    fetch(`${base}/station_information.json`, {
      cache: "no-store",
      signal: signal(),
    }),
    fetch(`${base}/station_status.json`, {
      cache: "no-store",
      signal: signal(),
    }),
  ]);
  if (!infoRes.ok || !statusRes.ok) throw new Error("GBFS failed");
  const info = await infoRes.json();
  const status = await statusRes.json();

  const statusById = new Map<string, { bikes: number; docks: number }>();
  for (const s of status.data?.stations ?? []) {
    statusById.set(s.station_id, {
      bikes: s.num_bikes_available ?? 0,
      docks: s.num_docks_available ?? 0,
    });
  }

  const stations: BikeStation[] = [];
  for (const s of info.data?.stations ?? []) {
    const st = statusById.get(s.station_id);
    if (!st) continue;
    stations.push({
      name: s.name,
      lat: s.lat,
      lng: s.lon,
      bikes: st.bikes,
      docks: st.docks,
    });
  }
  return stations;
}

export async function GET() {
  const [mbta, weather, bikes] = await Promise.allSettled([
    fetchMbta(),
    fetchWeather(),
    fetchBikes(),
  ]);

  const result: RawConditions = {
    fetchedAt: new Date().toISOString(),
    mbta:
      mbta.status === "fulfilled"
        ? { source: "live", alerts: mbta.value }
        : { source: "fallback", alerts: FALLBACK_CONDITIONS.mbta.alerts },
    weather:
      weather.status === "fulfilled"
        ? { source: "live", alerts: weather.value }
        : { source: "fallback", alerts: FALLBACK_CONDITIONS.weather.alerts },
    bikes:
      bikes.status === "fulfilled" && bikes.value.length > 0
        ? { source: "live", stations: bikes.value }
        : { source: "fallback", stations: FALLBACK_CONDITIONS.bikes.stations },
  };

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
