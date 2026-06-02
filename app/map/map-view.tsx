"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap } from "maplibre-gl";

export interface MapPointF {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  medianPpm2: number | null;
  n: number;
}

// Free, keyless basemap. Swap via NEXT_PUBLIC_MAP_STYLE (e.g. a MapTiler/Mapbox style).
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";

export function MapView({ points }: { points: MapPointF[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el || mapRef.current) return;

    (async () => {
      // Client-only: maplibre touches window, so import it inside the effect.
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !el) return;

      const priced = points.map((p) => p.medianPpm2).filter((v): v is number => v != null);
      const min = priced.length ? Math.min(...priced) : 0;
      const max = priced.length ? Math.max(...priced) : 1;
      const norm = (v: number | null) => (v == null || max === min ? 0.5 : (v - min) / (max - min));

      const features = points.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { name: p.name ?? "(unnamed)", ppm2: p.medianPpm2, n: p.n, w: norm(p.medianPpm2) },
      }));

      const first = points[0];
      const map = new maplibregl.Map({
        container: el,
        style: STYLE,
        center: first ? [first.lng, first.lat] : [106.7, 10.78], // default: HCMC
        zoom: 10,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      map.on("load", () => {
        map.addSource("props", { type: "geojson", data: { type: "FeatureCollection", features } });
        // Density heat — fades out as you zoom into individual markers.
        map.addLayer({
          id: "heat",
          type: "heatmap",
          source: "props",
          maxzoom: 16,
          paint: {
            "heatmap-weight": ["get", "w"],
            "heatmap-radius": 38,
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.55, 16, 0],
          },
        } as Parameters<MlMap["addLayer"]>[0]);
        // Markers — color = median price/m² (blue→amber→red), size = #observations.
        map.addLayer({
          id: "pts",
          type: "circle",
          source: "props",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "n"], 0, 7, 8, 16],
            "circle-color": ["interpolate", ["linear"], ["get", "w"], 0, "#2c7bb6", 0.5, "#fdae61", 1, "#d7191c"],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fff",
            "circle-opacity": 0.92,
          },
        } as Parameters<MlMap["addLayer"]>[0]);

        if (points.length > 1 && first) {
          const b = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
          points.forEach((p) => b.extend([p.lng, p.lat]));
          map.fitBounds(b, { padding: 60, maxZoom: 14 });
        }

        map.on("click", "pts", (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const pr = f.properties as { name: string; ppm2: number | null; n: number };
          const html = `<strong>${pr.name}</strong><br/>${
            pr.ppm2 ? `${(pr.ppm2 / 1e6).toFixed(1)}M/m² · median (n=${pr.n})` : "no price yet"
          }`;
          new maplibregl.Popup().setLngLat(f.geometry.coordinates as [number, number]).setHTML(html).addTo(map);
        });
        map.on("mouseenter", "pts", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "pts", () => { map.getCanvas().style.cursor = ""; });
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points]);

  return <div ref={ref} className="card" style={{ width: "100%", height: 540, padding: 0, overflow: "hidden" }} />;
}
