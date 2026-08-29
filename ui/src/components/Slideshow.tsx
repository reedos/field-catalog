import { useEffect, useMemo, useRef, useState } from "react";
import type { Shot } from "../types";
import { fmtDate } from "../lib/format";
import { previewUrl } from "../lib/preview";

const INTERVALS = [3, 5, 8, 12] as const;
const CAPTION_KEY = "fieldcatalog.slideshow.caption";
const SCOPE_KEY = "fieldcatalog.slideshow.scope";

const SCOPES = {
  keep: { label: "Keepers", verdicts: ["keep"] },
  "keep+unrated": { label: "Keepers + unrated", verdicts: ["keep", "unrated"] },
  unrated: { label: "Unrated", verdicts: ["unrated"] },
  reject: { label: "Rejected", verdicts: ["reject"] },
  all: { label: "Everything", verdicts: ["keep", "unrated", "reject"] },
} as const;

type Scope = keyof typeof SCOPES;

/**
 * Full-screen review of the keepers in the current view.
 *
 * The caption stays up: in a wildlife catalog the species, place and date are
 * the point of looking, not decoration. Only the controls fade during
 * playback. I hides the caption for a clean frame, and that choice is
 * remembered.
 *
 * Deliberately not a culling surface -- the only write is favorite, the one
 * gesture that belongs in "look at your good photographs".
 */
export default function Slideshow(props: {
  /** Everything in the current view; the scope selector narrows it here. */
  shots: Shot[];
  startId?: string | null;
  onFavorite: (id: string) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>(() => {
    try {
      const saved = localStorage.getItem(SCOPE_KEY);
      return saved && saved in SCOPES ? (saved as Scope) : "keep";
    } catch {
      return "keep";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_KEY, scope);
    } catch {
      // a remembered preference is a nicety, never a failure
    }
  }, [scope]);

  // Oldest first, so a run reads as the story of the outing.
  const shots = useMemo(() => {
    const allowed = SCOPES[scope].verdicts as readonly string[];
    return props.shots
      .filter((s) => allowed.includes(s.verdict))
      .slice()
      .sort((a, b) => (a.captured_at || "").localeCompare(b.captured_at || ""));
  }, [props.shots, scope]);

  // Position is held as an id, not an index, so changing scope keeps you on
  // the same photograph whenever it survives the new filter.
  const [currentId, setCurrentId] = useState<string | null>(props.startId ?? null);
  const found = currentId ? shots.findIndex((s) => s.id === currentId) : -1;
  const lastIndex = useRef(0);
  const index = found >= 0 ? found : Math.min(lastIndex.current, Math.max(0, shots.length - 1));
  lastIndex.current = index;

  const [playing, setPlaying] = useState(true);
  const [seconds, setSeconds] = useState<number>(5);
  const [captionVisible, setCaptionVisible] = useState(() => {
    try {
      return localStorage.getItem(CAPTION_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CAPTION_KEY, captionVisible ? "on" : "off");
    } catch {
      // a remembered preference is a nicety, never a failure
    }
  }, [captionVisible]);

  const shot = shots[index] ?? null;
  const total = shots.length;

  useEffect(() => {
    // Keep the anchor in step when advancing or when the list shifts underneath.
    if (shot && shot.id !== currentId) setCurrentId(shot.id);
  }, [shot, currentId]);

  function step(delta: number) {
    if (!total) return;
    const next = shots[(index + delta + total) % total]; // wraps, so it can loop
    if (next) setCurrentId(next.id);
  }

  // Auto-advance. Restarting on index change is what makes a manual step also
  // reset the dwell time, rather than cutting the next slide short.
  useEffect(() => {
    if (!playing || total < 2) return;
    const t = window.setTimeout(() => step(1), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [playing, seconds, index, total]);

  // Only the controls hide themselves while playing; the caption stays.
  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      return;
    }
    const t = window.setTimeout(() => setControlsVisible(false), 2500);
    return () => window.clearTimeout(t);
  }, [playing, index]);

  function wake() {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (playing) {
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2500);
    }
  }

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }, []);

  // Decode ahead so an advance never lands on a blank frame.
  useEffect(() => {
    for (const offset of [1, 2]) {
      const next = shots[(index + offset) % Math.max(1, total)];
      const src = next && previewUrl(next.preview_path);
      if (!src) continue;
      const img = new window.Image();
      img.decoding = "async";
      img.src = src;
    }
  }, [index, total, shots]);

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
      case " ":
        e.preventDefault();
        setPlaying((p) => !p);
        break;
      case "ArrowRight":
      case "ArrowDown":
      case "j":
      case "J":
        e.preventDefault();
        step(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "k":
      case "K":
        e.preventDefault();
        step(-1);
        break;
      case "f":
      case "F":
        e.preventDefault();
        if (shot) props.onFavorite(shot.id);
        break;
      case "i":
      case "I":
        e.preventDefault();
        setCaptionVisible((v) => !v);
        break;
      default:
        break;
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!shot) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-ink font-serif text-paper-dim">
        <div>Nothing {SCOPES[scope].label.toLowerCase()} in the current view.</div>
        <div className="flex items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="fc-select"
            aria-label="Which shots to show"
          >
            {(Object.keys(SCOPES) as Scope[]).map((k) => (
              <option key={k} value={k}>
                {SCOPES[k].label}
              </option>
            ))}
          </select>
          <button type="button" className="fc-btn fc-ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const src = previewUrl(shot.preview_path);
  const title = shot.common_name || shot.display_name || "Unidentified";

  return (
    <div
      className="fixed inset-0 z-[70] bg-black"
      onMouseMove={wake}
      style={{ cursor: controlsVisible ? "default" : "none" }}
    >
      {src ? (
        <img
          key={shot.id}
          src={src}
          alt={title}
          className="fc-slide absolute inset-0 h-full w-full object-contain"
          style={{ imageOrientation: "from-image" }}
        />
      ) : null}

      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 transition-opacity duration-500"
        style={{ opacity: captionVisible ? 1 : 0 }}
      >
        <div className="rounded bg-black/45 px-3 py-2 backdrop-blur-sm">
          <div className="font-serif text-xl text-paper">{title}</div>
          <div className="text-xs italic text-paper-dim">
            {shot.scientific_name || ""}
            {shot.scientific_name && shot.location ? " · " : ""}
            <span className="not-italic">{shot.location || ""}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-paper-dim">
            {shot.verdict !== "keep" ? (
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                  shot.verdict === "reject" ? "bg-reject text-paper" : "border border-bark text-paper-dim"
                }`}
              >
                {shot.verdict}
              </span>
            ) : null}
            {fmtDate(shot.captured_at)}
            {shot.animal_type ? ` · ${shot.animal_type}` : ""}
            {shot.stars ? ` · ${"★".repeat(shot.stars)}` : ""}
            {shot.favorite ? " · ★ favorite" : ""}
          </div>
        </div>
        <div className="rounded bg-black/45 px-3 py-2 text-xs tabular-nums text-paper-dim">
          {index + 1} / {total}
        </div>
      </div>

      {/* Faded controls must not still be clickable or focusable. */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-5 transition-opacity duration-500"
        style={{ opacity: controlsVisible ? 1 : 0, pointerEvents: controlsVisible ? "auto" : "none" }}
        aria-hidden={!controlsVisible}
      >
        <button type="button" className="fc-btn fc-ghost" onClick={() => step(-1)} aria-label="Previous">
          ←
        </button>
        <button
          type="button"
          className="fc-btn fc-ghost"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button type="button" className="fc-btn fc-ghost" onClick={() => step(1)} aria-label="Next">
          →
        </button>
        <button
          type="button"
          className={`fc-btn ${shot.favorite ? "fc-warn" : "fc-ghost"}`}
          onClick={() => props.onFavorite(shot.id)}
          aria-pressed={!!shot.favorite}
        >
          {shot.favorite ? "★ Favorite" : "☆ Favorite"}
        </button>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="fc-select"
          aria-label="Which shots to show"
        >
          {(Object.keys(SCOPES) as Scope[]).map((k) => (
            <option key={k} value={k}>
              {SCOPES[k].label}
            </option>
          ))}
        </select>
        <select
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
          className="fc-select"
          aria-label="Seconds per slide"
        >
          {INTERVALS.map((n) => (
            <option key={n} value={n}>
              {n}s
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-paper-dim">
          {SCOPES[scope].label} · Space play/pause · ←/→ step · F favorite · I{" "}
          {captionVisible ? "hide" : "show"} caption · Esc close
        </span>
      </div>

      {playing && total > 1 ? (
        <div
          key={`${shot.id}-bar`}
          className="fc-slide-bar absolute bottom-0 left-0 h-0.5 bg-ochre/70"
          style={{ animationDuration: `${seconds}s` }}
        />
      ) : null}
    </div>
  );
}
