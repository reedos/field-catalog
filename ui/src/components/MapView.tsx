import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { Shot } from "../types";
import { previewUrl } from "../lib/preview";
import { bestShot, speciesKey } from "../lib/ranking";
import "leaflet/dist/leaflet.css";

/**
 * What a place is worth showing: the species found there, not the shots.
 * Twenty frames of one jay is one line, so a popup lists as many different
 * animals as it can fit rather than the same one over and over.
 */
function speciesAt(shots: Shot[]) {
  const groups = new Map<string, Shot[]>();
  const unidentified: Shot[] = [];
  for (const s of shots) {
    const key = speciesKey(s);
    if (!key) {
      unidentified.push(s);
      continue;
    }
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const rows = [...groups.values()].map((g) => {
    const best = bestShot(g);
    return { key: speciesKey(best), name: best.common_name || speciesKey(best), count: g.length, best };
  });
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (unidentified.length) {
    rows.push({
      key: "__unidentified__",
      name: "Unidentified",
      count: unidentified.length,
      best: bestShot(unidentified),
    });
  }
  return rows;
}

export default function MapView(props: {
  shots: Shot[];
  onOpen: (id: string) => void;
  onLocation: (id: string, label: string) => void;
}) {
  const pins = useMemo(
    () =>
      props.shots.filter(
        (s) => typeof s.lat === "number" && typeof s.lon === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lon),
      ),
    [props.shots],
  );

  const clusters = useMemo(() => {
    const map = new Map<string, {key: string; shots: Shot[]; lat: number; lon: number}>();
    for (const s of pins) {
      const lat = s.lat as number;
      const lon = s.lon as number;
      const key = `${Math.round(lat * 2) / 2}_${Math.round(lon * 2) / 2}`;
      const c = map.get(key);
      if (c) {
        c.shots.push(s);
        // Centre on the cluster, not on whichever shot happened to arrive first.
        c.lat += (lat - c.lat) / c.shots.length;
        c.lon += (lon - c.lon) / c.shots.length;
      } else {
        map.set(key, { key, shots: [s], lat, lon });
      }
    }
    return Array.from(map.values());
  }, [pins]);

  return (
    <div className="h-full relative">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        className="h-full w-full"
        worldCopyJump
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit pins={pins} />
        {clusters.map((c) => {
          const size = Math.min(14 + c.shots.length*0.8, 28);
          return (
            <CircleMarker
              key={c.key}
              center={[c.lat, c.lon]}
              radius={size}
              pathOptions={{ color: "#6a7a52", fillColor: "#c4a36a", fillOpacity: 0.9 }}
            >
              <Popup>
                {c.shots.length === 1 ? (
                  <PinCard shot={c.shots[0]} onOpen={props.onOpen} onLocation={props.onLocation} />
                ) : (
                  <SpeciesList shots={c.shots} onOpen={props.onOpen} />
                )}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="absolute top-3 left-3 bg-paper text-ink text-xs px-2 py-1 font-serif pointer-events-none">
        {pins.length
          ? `${pins.length} file GPS pin${pins.length === 1 ? "" : "s"}`
          : "No file GPS in this library. Place names are labels only."}
      </div>
    </div>
  );
}

/** One row per species found here, best frame first, most-photographed first. */
function SpeciesList(props: { shots: Shot[]; onOpen: (id: string) => void }) {
  const rows = useMemo(() => speciesAt(props.shots), [props.shots]);
  const shown = rows.slice(0, 8);
  return (
    <div className="w-56 font-sans text-ink">
      <div className="mb-2 text-xs">
        {rows.length} species · {props.shots.length} shots here
      </div>
      <div className="flex flex-col gap-1">
        {shown.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => props.onOpen(r.best.id)}
            className="flex items-center gap-2 rounded-sm p-0.5 text-left text-xs hover:bg-black/5"
            title={`Open the best frame of ${r.name}`}
          >
            <img
              src={previewUrl(r.best.preview_path)}
              alt=""
              className="h-8 w-8 shrink-0 rounded-sm object-cover"
            />
            <span className="min-w-0 flex-1 truncate underline">{r.name}</span>
            {r.count > 1 ? <span className="shrink-0 text-neutral-500">{r.count}</span> : null}
          </button>
        ))}
      </div>
      {rows.length > shown.length ? (
        <div className="mt-1.5 text-[11px] text-neutral-600">
          and {rows.length - shown.length} more species
        </div>
      ) : null}
    </div>
  );
}

function Fit(props: { pins: Shot[] }) {
  const map = useMap();
  useEffect(() => {
    if (!props.pins.length) {
      map.setView([20, 0], 2);
      return;
    }
    const bounds = props.pins.map((p) => [p.lat as number, p.lon as number] as [number, number]);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
  }, [map, props.pins]);
  return null;
}

function PinCard(props: {
  shot: Shot;
  onOpen: (id: string) => void;
  onLocation: (id: string, label: string) => void;
}) {
  const [label, setLabel] = useState(props.shot.location || "");
  useEffect(() => setLabel(props.shot.location || ""), [props.shot.id, props.shot.location]);
  const src = previewUrl(props.shot.preview_path);
  return (
    <div className="w-48 font-sans text-ink">
      {src ? (
        <img
          src={src}
          alt={props.shot.common_name || "Shot preview"}
          className="w-full h-24 object-cover mb-2"
        />
      ) : null}
      <input
        className="w-full border px-1 py-0.5 text-xs mb-1"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== (props.shot.location || "")) props.onLocation(props.shot.id, label);
        }}
        placeholder="Place name"
        aria-label="Place name"
      />
      <div className="text-[10px] text-neutral-600 mb-1">
        {(props.shot.lat as number).toFixed(5)}, {(props.shot.lon as number).toFixed(5)} file GPS
      </div>
      <button className="text-xs underline" onClick={() => props.onOpen(props.shot.id)}>
        Open
      </button>
    </div>
  );
}
