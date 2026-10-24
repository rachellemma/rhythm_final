"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fmt, legColor } from "@/lib/engine";
import type { DayPlan, Persona } from "@/lib/types";

const DARK_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const PLAIN_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#06080c" } },
  ],
};

interface Props {
  persona: Persona;
  rhythm: DayPlan;
  naive: DayPlan;
  showBaseline: boolean;
  activeLeg: number | null;
  onSelectLeg: (i: number | null) => void;
}

type LngLat = [number, number];

function lineFeatures(plan: DayPlan): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: plan.legs.map((leg, i) => ({
      type: "Feature",
      properties: { color: legColor(leg.option), index: i },
      geometry: { type: "LineString", coordinates: leg.path },
    })),
  };
}

function pointFC(p: LngLat | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: p
      ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }]
      : [],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

const PADDING_WIDE = { top: 90, bottom: 90, left: 470, right: 340 };
const PADDING_NARROW = { top: 40, bottom: 40, left: 40, right: 40 };

function padding(map: maplibregl.Map) {
  return map.getContainer().clientWidth >= 1024 ? PADDING_WIDE : PADDING_NARROW;
}

export default function MapView(props: Props) {
  const { persona, rhythm, naive, showBaseline, activeLeg } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const rafRef = useRef<number | null>(null);
  const trackRef = useRef<LngLat[]>([]);
  // Always-current props, so map event handlers never read stale values.
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(0);

  // ---- Init once --------------------------------------------------------
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    const p = propsRef.current.persona;
    let styleLoaded = false;

    const map = new maplibregl.Map({
      container: wrapRef.current,
      style: DARK_STYLE,
      center: [p.home.lng, p.home.lat],
      zoom: 12.4,
      pitch: 42,
      bearing: -12,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    // Basemap fallback: plain dark background after 5 s so routes still render.
    const fallback = setTimeout(() => {
      if (!styleLoaded) map.setStyle(PLAIN_STYLE);
    }, 5000);

    map.on("style.load", () => {
      styleLoaded = true;
      addLayers(map);
      setReady((n) => n + 1);
    });

    map.on("click", "rhythm-hit", (e) => {
      const idx = e.features?.[0]?.properties?.index;
      if (typeof idx === "number") propsRef.current.onSelectLeg(idx);
    });
    map.on("mouseenter", "rhythm-hit", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "rhythm-hit", () => (map.getCanvas().style.cursor = ""));

    // Animation loop: dash flow + moving dot.
    let last = performance.now();
    let dash = 0;
    let pos = 0;
    const tick = (now: number) => {
      const dt = Math.max(0, now - last); // guard negative rAF deltas
      last = now;
      if (map.getLayer("rhythm-flow")) {
        dash = (dash + dt * 0.004) % 4;
        map.setPaintProperty("rhythm-flow", "line-dasharray", [dash, 2, 4 - dash]);
      }
      const track = trackRef.current;
      const src = map.getSource("dot") as maplibregl.GeoJSONSource | undefined;
      if (src && track.length > 1) {
        pos = (pos + dt * 0.006) % (track.length - 1);
        const i = Math.floor(pos);
        const f = pos - i;
        const a = track[i];
        const b = track[i + 1];
        src.setData(pointFC([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      clearTimeout(fallback);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- Data: plans, markers, fit ---------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("rhythm")) return;
    (map.getSource("rhythm") as maplibregl.GeoJSONSource).setData(lineFeatures(rhythm));
    (map.getSource("naive") as maplibregl.GeoJSONSource).setData(lineFeatures(naive));
    trackRef.current = rhythm.legs.flatMap((l) => l.path);
    rebuildMarkers(map, persona, rhythm);
  }, [ready, persona, rhythm, naive]);

  // Refit only when the persona changes (or the map first becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts: LngLat[] = [
      [persona.home.lng, persona.home.lat],
      ...persona.events.map((e) => [e.place.lng, e.place.lat] as LngLat),
    ];
    const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    map.fitBounds(bounds, { padding: padding(map), pitch: 42, bearing: -12, duration: 900, maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, persona.id]);

  // ---- Baseline toggle --------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("naive-line")) return;
    map.setLayoutProperty("naive-line", "visibility", showBaseline ? "visible" : "none");
  }, [ready, showBaseline]);

  // ---- Active leg highlight + zoom -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("rhythm-line")) return;
    const sel = activeLeg ?? -1;
    map.setPaintProperty("rhythm-line", "line-width", ["case", ["==", ["get", "index"], sel], 7, 4]);
    map.setPaintProperty("rhythm-line", "line-opacity", [
      "case",
      ["any", ["==", sel, -1], ["==", ["get", "index"], sel]],
      0.95,
      0.35,
    ]);
    const leg = activeLeg != null ? propsRef.current.rhythm.legs[activeLeg] : undefined;
    if (leg) {
      const b = leg.path.reduce(
        (acc, p) => acc.extend(p as LngLat),
        new maplibregl.LngLatBounds(leg.path[0] as LngLat, leg.path[0] as LngLat)
      );
      map.fitBounds(b, { padding: padding(map), duration: 700, maxZoom: 15, pitch: 48 });
    }
  }, [ready, activeLeg]);

  return (
    // Wrapper div: MapLibre sets position:relative on its container.
    <div className="absolute inset-0">
      <div ref={wrapRef} className="h-full w-full" />
    </div>
  );

  // ---- helpers (hoisted) -------------------------------------------------
  function addLayers(map: maplibregl.Map) {
    const { rhythm: r, naive: n, showBaseline: sb } = propsRef.current;
    map.addSource("naive", { type: "geojson", data: lineFeatures(n) });
    map.addSource("rhythm", { type: "geojson", data: lineFeatures(r) });
    map.addSource("dot", { type: "geojson", data: pointFC(null) });
    trackRef.current = r.legs.flatMap((l) => l.path);

    map.addLayer({
      id: "naive-line",
      type: "line",
      source: "naive",
      layout: { "line-cap": "round", "line-join": "round", visibility: sb ? "visible" : "none" },
      paint: { "line-color": "#94a3b8", "line-width": 2.5, "line-dasharray": [2, 2], "line-opacity": 0.6 },
    });
    map.addLayer({
      id: "rhythm-glow",
      type: "line",
      source: "rhythm",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 14, "line-blur": 10, "line-opacity": 0.45 },
    });
    map.addLayer({
      id: "rhythm-line",
      type: "line",
      source: "rhythm",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.95 },
    });
    map.addLayer({
      id: "rhythm-flow",
      type: "line",
      source: "rhythm",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 1.5, "line-opacity": 0.55, "line-dasharray": [0, 2, 4] },
    });
    // Wide invisible line for easier clicking.
    map.addLayer({
      id: "rhythm-hit",
      type: "line",
      source: "rhythm",
      paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0 },
    });
    map.addLayer({
      id: "dot-halo",
      type: "circle",
      source: "dot",
      paint: { "circle-radius": 12, "circle-color": "#5eead4", "circle-opacity": 0.22, "circle-blur": 0.6 },
    });
    map.addLayer({
      id: "dot-core",
      type: "circle",
      source: "dot",
      paint: {
        "circle-radius": 5,
        "circle-color": "#5eead4",
        "circle-stroke-color": "#06080c",
        "circle-stroke-width": 2,
      },
    });
  }

  function rebuildMarkers(map: maplibregl.Map, p: Persona, plan: DayPlan) {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const homeEl = document.createElement("div");
    homeEl.className = "pulse-ring";
    homeEl.title = p.home.name;
    const dot = document.createElement("div");
    dot.className = "home-dot";
    homeEl.appendChild(dot);
    markersRef.current.push(
      new maplibregl.Marker({ element: homeEl }).setLngLat([p.home.lng, p.home.lat]).addTo(map)
    );

    plan.events.forEach((pe, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "rhythm-marker";
      el.style.position = "relative";
      el.style.background = "none";
      el.style.border = "0";
      el.style.padding = "0";
      el.setAttribute("aria-label", `${pe.event.title}, ${fmt(pe.committedStart)}`);
      el.innerHTML =
        `<div class="rhythm-pin${pe.event.priority === "critical" ? " critical" : ""}">${i + 1}</div>` +
        `<div class="rhythm-label"><b>${escapeHtml(pe.event.title)}</b><br/>` +
        `<span class="t">${fmt(pe.committedStart)}</span> · ${escapeHtml(pe.event.place.short)}</div>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        propsRef.current.onSelectLeg(i);
      });
      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([pe.event.place.lng, pe.event.place.lat]).addTo(map)
      );
    });
  }
}
