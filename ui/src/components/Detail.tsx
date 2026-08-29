import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ANIMAL_TYPES, type AnimalType, type Shot } from "../types";
import { animalLabel, fmtBytes, fmtDate, fileName, sharpnessMeter } from "../lib/format";
import { previewUrl } from "../lib/preview";

function useFieldMarksSuggestions(all: string[]) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const filtered = useMemo(() => {
    if (!debounced) return all.slice(0, 8);
    return all.filter((s) => s.toLowerCase().includes(debounced)).slice(0, 8);
  }, [all, debounced]);
  return { suggestions: filtered, setQuery };
}

function Meter(props: { label: string; value: number | null }) {
  const pct = props.value == null ? null : Math.round(Math.max(0, Math.min(1, props.value)) * 100);
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[11px] uppercase tracking-wide text-paper-dim">
        <span>{props.label}</span>
        <span>{pct == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-2 bg-bark">
        <div className="h-full bg-moss" style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export default function Detail(props: {
  shot: Shot;
  loupe: boolean;
  identifying?: boolean;
  burstPos?: { index: number; count: number } | null;
  onClose: () => void;
  onStars: (n: number) => void;
  onFavorite: () => void;
  onColor: () => void;
  onVerdict: (v: "keep" | "reject" | "unrated") => void;
  onLocation: (label: string) => void;
  onAnimalType: (t: AnimalType) => void;
  onSaveIdentity: (common: string, scientific: string) => void;
  onSaveFieldMarks?: (marks: string[]) => void;
  onRunIdentify: () => void;
  fieldMarkOptions?: string[];
}) {
  const { suggestions, setQuery } = useFieldMarksSuggestions(props.fieldMarkOptions || []);
  const { shot } = props;
  const [localVerdict, setLocalVerdict] = useState<"keep" | "reject" | "unrated">(shot.verdict || "unrated");
  const src = previewUrl(shot.preview_path);
  const [common, setCommon] = useState(shot.common_name || "");
  const [scientific, setScientific] = useState(shot.scientific_name || "");
  const [place, setPlace] = useState(shot.location || "");
  const [fieldMarks, setFieldMarks] = useState(shot.field_marks?.join(", ") || "");

  // Loupe: 1:1 view with drag-to-pan. Pan resets when the loupe closes or the
  // shot changes, so a new frame always opens centred.
  const loupeBoxRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setPanning(false);
  }, [props.loupe, shot.id]);

  function onLoupeDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!props.loupe) return;
    e.preventDefault();
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onLoupeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!props.loupe || !panning) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }

  function onLoupeUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!panning) return;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  /** Replace the mark currently being typed with a chosen suggestion. */
  function addFieldMark(mark: string) {
    const parts = fieldMarks.split(",");
    parts[parts.length - 1] = ` ${mark}`;
    const next = parts.join(",").replace(/^\s+/, "");
    setFieldMarks(next);
    setQuery("");
    props.onSaveFieldMarks?.(next.split(",").map((s) => s.trim()).filter(Boolean));
  }

  const currentMarks = useMemo(
    () => new Set(fieldMarks.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    [fieldMarks],
  );
  const unusedSuggestions = suggestions.filter((s) => !currentMarks.has(s.toLowerCase()));

  useEffect(() => {
    setCommon(shot.common_name || "");
    setScientific(shot.scientific_name || "");
    setPlace(shot.location || "");
    setFieldMarks(shot.field_marks?.join(", ") || "");
    setLocalVerdict((shot.verdict as "keep" | "reject" | "unrated") || "unrated");
  }, [shot.id, shot.verdict, shot.common_name, shot.scientific_name, shot.location, shot.field_marks]);

  const hasFileGps = shot.gps_from_file && typeof shot.lat === "number" && typeof shot.lon === "number";
  const hasAnyGps = typeof shot.lat === "number" && typeof shot.lon === "number";
  const identified = !!(shot.common_name || shot.scientific_name);
  const focus = sharpnessMeter(shot);
  const conf = shot.confidence == null ? null : shot.confidence > 1 ? shot.confidence / 100 : shot.confidence;
  const marks = shot.field_marks || [];

  return (
    <aside className="relative h-full w-[min(780px,56vw)] shrink-0 z-20 bg-ink border-l border-bark flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bark shrink-0">
        <div className="text-xs text-paper-dim truncate pr-2">
          {props.burstPos ? `Burst ${props.burstPos.index + 1}/${props.burstPos.count}` : fileName(shot.original_path)}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="px-3 py-1 text-sm border border-bark text-paper hover:bg-bark"
        >
          Close
        </button>
      </div>

      <div
        ref={loupeBoxRef}
        onPointerDown={onLoupeDown}
        onPointerMove={onLoupeMove}
        onPointerUp={onLoupeUp}
        onPointerCancel={onLoupeUp}
        className={`bg-charcoal flex-1 min-h-[240px] flex items-center justify-center overflow-hidden relative ${
          props.loupe ? (panning ? "cursor-grabbing" : "cursor-grab") : ""
        }`}
      >
        {src ? (
          <img
            src={src}
            alt={shot.common_name || fileName(shot.original_path)}
            draggable={false}
            className={props.loupe ? "max-w-none select-none" : "max-h-full max-w-full object-contain"}
            style={{
              imageOrientation: "from-image",
              ...(props.loupe
                ? { transform: `translate(${pan.x}px, ${pan.y}px)`, willChange: "transform" }
                : null),
            }}
          />
        ) : null}
        {props.loupe ? (
          <div className="absolute top-2 left-2 bg-ink/80 text-paper-dim text-[11px] px-2 py-0.5 border border-bark pointer-events-none">
            1:1 — drag to pan, L to exit
          </div>
        ) : null}
      </div>

      <div className="fc-scroll border-t border-bark shrink-0 max-h-[42%]">
        <div className="sticky top-0 z-20 bg-ink border-b border-bark p-3 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setLocalVerdict("keep");
                props.onVerdict("keep");
              }}
              className={`px-2 py-1 text-xs border ${localVerdict === "keep" ? "border-moss bg-moss/20" : "border-bark"}`}
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalVerdict("reject");
                props.onVerdict("reject");
              }}
              className={`px-2 py-1 text-xs border ${localVerdict === "reject" ? "border-reject bg-reject/20" : "border-bark"}`}
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalVerdict("unrated");
                props.onVerdict("unrated");
              }}
              className={`px-2 py-1 text-xs border ${localVerdict === "unrated" ? "border-ochre bg-ochre/10" : "border-bark"}`}
            >
              Unrated
            </button>
          </div>
          <div className="flex items-center gap-2" role="group" aria-label="Star rating">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => props.onStars(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                aria-pressed={shot.stars >= n}
                className={`text-sm ${shot.stars >= n ? "text-ochre" : "text-paper-dim"}`}
              >
                ★
              </button>
            ))}
            <button
              type="button"
              onClick={props.onFavorite}
              aria-pressed={!!shot.favorite}
              className="ml-2 text-xs border border-bark px-2 py-0.5"
            >
              {shot.favorite ? "Unfav" : "Fav"}
            </button>
            <button type="button" onClick={props.onColor} className="text-xs border border-bark px-2 py-0.5">
              Color
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <Meter label="ID confidence" value={conf} />
          <Meter label="Focus / sharpness" value={focus} />
          {shot.sharpness != null ? (
            <p className="text-[11px] text-paper-dim -mt-2">Sharpness score {shot.sharpness.toFixed(0)}</p>
          ) : null}

          <h3 className="text-xs uppercase tracking-wide text-paper-dim">Identity</h3>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={common}
              onChange={(e) => setCommon(e.target.value)}
              onBlur={() => props.onSaveIdentity(common, scientific)}
              placeholder="Common name"
              className="bg-charcoal border border-bark px-2 py-1 text-sm"
            />
            <input
              value={scientific}
              onChange={(e) => setScientific(e.target.value)}
              onBlur={() => props.onSaveIdentity(common, scientific)}
              placeholder="Scientific name"
              className="bg-charcoal border border-bark px-2 py-1 text-sm italic"
            />
          </div>
          <select
            value={shot.animal_type || ""}
            onChange={(e) => props.onAnimalType(e.target.value as AnimalType)}
            className="w-full bg-charcoal border border-bark px-2 py-1 text-sm"
          >
            <option value="">Animal type</option>
            {ANIMAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {animalLabel(t)}
              </option>
            ))}
          </select>
          <input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onBlur={() => props.onLocation(place)}
            placeholder="Location label"
            className="w-full bg-charcoal border border-bark px-2 py-1 text-sm"
          />

          {shot.notes ? <p className="text-sm text-paper whitespace-pre-wrap leading-relaxed">{shot.notes}</p> : null}

          {marks.length ? (
            <ul className="list-disc pl-5 text-sm text-paper space-y-1">
              {marks.map((m) => (
                <li key={m} className="break-words">
                  {m}
                </li>
              ))}
            </ul>
          ) : null}

          <textarea
            value={fieldMarks}
            onChange={(e) => {
              setFieldMarks(e.target.value);
              // Suggest against the mark being typed, not the whole field.
              setQuery(e.target.value.split(",").pop() || "");
            }}
            placeholder="Field marks, comma separated"
            rows={3}
            wrap="soft"
            spellCheck={false}
            lang="zxx"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full bg-charcoal border border-bark px-2 py-1 text-sm resize-y whitespace-pre-wrap break-words"
          />
          {/* A textarea cannot use a datalist, so suggestions are chips. */}
          {unusedSuggestions.length ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {unusedSuggestions.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => addFieldMark(m)}
                  className="px-2 py-0.5 text-[11px] border border-bark text-paper-dim hover:border-moss hover:text-moss"
                >
                  + {m}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const v = fieldMarks.trim();
                if (!v) return;
                const next = v.split(",").map((s) => s.trim()).filter(Boolean);
                if (props.onSaveFieldMarks) props.onSaveFieldMarks(next);
              }}
              className="px-3 py-1 border border-moss text-moss text-sm"
            >
              Save field marks
            </button>
            <button
              type="button"
              onClick={props.onRunIdentify}
              disabled={!!props.identifying}
              className="px-3 py-1 border border-moss text-moss text-sm disabled:opacity-50"
            >
              {props.identifying ? "Identifying…" : identified ? "Re-identify" : "Identify"}
            </button>
          </div>

          <h3 className="text-xs uppercase tracking-wide text-paper-dim pt-2">Metadata</h3>
          <div className="text-xs text-paper-dim space-y-1">
            <div>File: {fileName(shot.original_path)}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>Camera: {shot.camera || "—"}</div>
              <div>Lens: {shot.lens || "—"}</div>
              <div>ISO: {shot.iso ?? "—"}</div>
              <div>Shutter: {shot.shutter || "—"}</div>
              <div>Aperture: {shot.aperture || "—"}</div>
              <div>Focal: {shot.focal_length || "—"}</div>
            </div>
            <div>
              Size: {fmtBytes(shot.bytes_original)} · {fmtDate(shot.captured_at)}
            </div>
            {hasFileGps ? (
              <div>
                GPS: {shot.lat?.toFixed(5)}, {shot.lon?.toFixed(5)} (file)
              </div>
            ) : null}
            {hasAnyGps && !hasFileGps ? (
              <div>
                GPS: {shot.lat?.toFixed(5)}, {shot.lon?.toFixed(5)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
