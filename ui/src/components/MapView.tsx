import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { Shot } from "../types";
import { previewUrl } from "../lib/preview";
import "leaflet/dist/leaflet.css";

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
    const map = new Map<string, {shots: any[]; lat: number; lon: number}>();
    for (const s of pins) {
      const lat = s.lat as number;
      const lon = s.lon as number;
      const key = `${Math.round(lat * 2) / 2}_${Math.round(lon * 2) / 2}`;
      if (!map.has(key)) {
        map.set(key, { shots: [s], lat, lon });
      } else {
        const c = map.get(key)!;
        c.shots.push(s);
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
        {clusters.map((c, i) => {
          const size = Math.min(14 + c.shots.length*0.8, 28);
          return (
            <CircleMarker
              key={i}
              center={[c.lat, c.lon]}
              radius={size}
              pathOptions={{ color: "#6a7a52", fillColor: "#c4a36a", fillOpacity: 0.9 }}
            >
              <Popup>
                <div className="w-48">
                  <div className="text-xs mb-2">{c.shots.length} shots in area</div>
                  {c.shots.slice(0,6).map(s => (
                    <div key={s.id} className="text-xs flex gap-2 items-center">
                      <img src={previewUrl(s.preview_path)} className="w-8 h-8 object-cover" />
                      <button className="underline" onClick={() => props.onOpen(s.id)}>{s.common_name || "Needs ID"}</button>
                    </div>
                  ))}
                </div>
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

function Fit(props: { pins: Shot[] }) {
  const map = useMap();
  const key = props.pins.map((p) => p.id).join(",");
  useEffect(() => {
    if (!props.pins.length) {
      map.setView([20, 0], 2);
      return;
    }
    const bounds = props.pins.map((p) => [p.lat as number, p.lon as number] as [number, number]);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
  }, [map, key, props.pins]);
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
      {src ? <img src={src} alt="" className="w-full h-24 object-cover mb-2" /> : null}
      <input
        className="w-full border px-1 py-0.5 text-xs mb-1"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== (props.shot.location || "")) props.onLocation(props.shot.id, label);
        }}
        placeholder="Place name"
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
