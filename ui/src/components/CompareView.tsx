import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Keymap, Shot, Verdict } from "../types";
import { focusScore } from "../lib/format";
import { matches } from "../lib/keys";
import { previewUrl } from "../lib/preview";

/**
 * Survey compare for a burst: every remaining frame on screen at once, pan and
 * 1:1 zoom synced across all of them, and the pool shrinks live as frames are
 * rejected. The fast path: X away the losers until one remains, Enter keeps it.
 *
 * Pan is stored as a fraction of the image, not pixels, so the same subject
 * region lines up across frames — burst frames share framing and dimensions.
 */
export default function CompareView(props: {
  members: Shot[];
  keys: Keymap;
  onVerdict: (id: string, v: Verdict) => void;
  onKeepOnly: (keepId: string) => void;
  onClose: () => void;
}) {
  const visible = useMemo(
    () => props.members.filter((m) => m.verdict !== "reject"),
    [props.members],
  );

  // Same ranking the worker's burst_pick uses; shown as a starting hypothesis.
  const recommendedId = useMemo(() => {
    if (visible.length < 2) return null;
    return [...visible].sort(
      (a, b) =>
        (b.sharpness ?? -1) - (a.sharpness ?? -1) ||
        (b.quality ?? -1) - (a.quality ?? -1) ||
        b.stars - a.stars ||
        Number(b.favorite) - Number(a.favorite),
    )[0]?.id ?? null;
  }, [visible]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = visible.find((m) => m.id === focusedId) ?? visible[0] ?? null;

  const [zoom, setZoom] = useState<"fit" | "1:1">("fit");
  const [pan, setPan] = useState({ fx: 0.5, fy: 0.5 });
  const dragRef = useRef<{ x: number; y: number; fx: number; fy: number; w: number; h: number } | null>(null);

  // Frames rejected from inside this compare session, so U can walk them back.
  const [rejectedStack, setRejectedStack] = useState<string[]>([]);

  function moveFocus(delta: number) {
    if (!visible.length) return;
    const idx = Math.max(0, visible.findIndex((m) => m.id === focused?.id));
    const next = visible[Math.max(0, Math.min(visible.length - 1, idx + delta))];
    if (next) setFocusedId(next.id);
  }

  function rejectFocused() {
    if (!focused) return;
    const idx = visible.findIndex((m) => m.id === focused.id);
    const next = visible[idx + 1] ?? visible[idx - 1] ?? null;
    setRejectedStack((s) => [...s, focused.id]);
    props.onVerdict(focused.id, "reject");
    setFocusedId(next?.id ?? null);
  }

  function restoreLast() {
    const id = rejectedStack[rejectedStack.length - 1];
    if (!id) return;
    setRejectedStack((s) => s.slice(0, -1));
    props.onVerdict(id, "unrated");
    setFocusedId(id);
  }

  // One keyboard authority for the overlay; App's global handler stands down
  // while compare is open. Registered once, latest handler kept in a ref.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (focused) props.onKeepOnly(focused.id);
      return;
    }
    const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (matches(e, props.keys.next) || (bare && (e.key === "ArrowRight" || e.key === "ArrowDown"))) {
      e.preventDefault();
      moveFocus(1);
    } else if (matches(e, props.keys.prev) || (bare && (e.key === "ArrowLeft" || e.key === "ArrowUp"))) {
      e.preventDefault();
      moveFocus(-1);
    } else if (matches(e, props.keys.reject)) {
      e.preventDefault();
      rejectFocused();
    } else if (matches(e, props.keys.keep)) {
      e.preventDefault();
      if (focused) props.onVerdict(focused.id, "keep");
    } else if (matches(e, props.keys.unrated)) {
      e.preventDefault();
      restoreLast();
    } else if (matches(e, props.keys.loupe) || (bare && e.key.toLowerCase() === "z")) {
      e.preventDefault();
      setZoom((z) => (z === "fit" ? "1:1" : "fit"));
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, shot: Shot) {
    if (zoom !== "1:1") return;
    e.preventDefault();
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      fx: pan.fx,
      fy: pan.fy,
      w: shot.preview_width || 1600,
      h: shot.preview_height || 1067,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function drag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    setPan({
      fx: Math.max(0, Math.min(1, d.fx - (e.clientX - d.x) / d.w)),
      fy: Math.max(0, Math.min(1, d.fy - (e.clientY - d.y) / d.h)),
    });
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const cols = visible.length <= 2 ? Math.max(1, visible.length) : visible.length <= 4 ? 2 : 3;
  const rows = Math.ceil(Math.max(1, visible.length) / cols);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink">
      <div className="flex items-center gap-3 border-b border-bark bg-charcoal px-4 py-2">
        <div className="font-serif text-base tracking-wide text-paper">
          Compare <span className="text-ochre">·</span> {visible.length} of {props.members.length} frames
        </div>
        {rejectedStack.length ? (
          <span className="text-xs text-paper-dim">{rejectedStack.length} rejected here · U restores</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => (z === "fit" ? "1:1" : "fit"))}
            className={`fc-btn ${zoom === "1:1" ? "fc-warn" : "fc-ghost"}`}
            title="Toggle 1:1 (L)"
          >
            {zoom === "1:1" ? "1:1 — drag pans all" : "Fit"}
          </button>
          <button
            type="button"
            onClick={() => focused && props.onKeepOnly(focused.id)}
            disabled={!focused}
            className="fc-btn fc-accent"
            title="Enter"
          >
            Keep focused, reject rest
          </button>
          <button type="button" onClick={props.onClose} className="fc-btn fc-ghost" title="Escape">
            Close
          </button>
        </div>
      </div>

      {visible.length ? (
        <div
          className="fc-scroll min-h-0 flex-1 p-2"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: rows <= 2 ? "minmax(0, 1fr)" : "46vh",
            gap: "8px",
            height: "100%",
          }}
        >
          {visible.map((shot) => {
            const src = previewUrl(shot.preview_path);
            const natW = shot.preview_width || 1600;
            const natH = shot.preview_height || 1067;
            const isFocused = shot.id === focused?.id;
            return (
              <div
                key={shot.id}
                className={`flex min-h-0 flex-col overflow-hidden rounded-md bg-charcoal transition-shadow duration-150 ${
                  isFocused ? "ring-2 ring-moss shadow-lg shadow-moss/20" : "ring-1 ring-bark"
                }`}
              >
                <div
                  className={`relative min-h-0 flex-1 overflow-hidden bg-ink ${
                    zoom === "1:1" ? (dragRef.current ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"
                  }`}
                  onClick={() => setFocusedId(shot.id)}
                  onDoubleClick={() => setZoom((z) => (z === "fit" ? "1:1" : "fit"))}
                  onPointerDown={(e) => startDrag(e, shot)}
                  onPointerMove={drag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {src ? (
                    zoom === "fit" ? (
                      <img
                        src={src}
                        alt={shot.display_name || shot.id}
                        draggable={false}
                        className="absolute inset-0 h-full w-full select-none object-contain"
                        style={{ imageOrientation: "from-image" }}
                      />
                    ) : (
                      <img
                        src={src}
                        alt={shot.display_name || shot.id}
                        draggable={false}
                        className="absolute select-none"
                        style={{
                          left: "50%",
                          top: "50%",
                          width: natW,
                          height: natH,
                          maxWidth: "none",
                          transform: `translate(-50%, -50%) translate(${(0.5 - pan.fx) * natW}px, ${(0.5 - pan.fy) * natH}px)`,
                          imageOrientation: "from-image",
                        }}
                      />
                    )
                  ) : null}
                  {shot.verdict === "keep" ? (
                    <span className="absolute left-2 top-2 rounded-sm bg-moss px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper shadow-sm">
                      keep
                    </span>
                  ) : null}
                  {shot.id === recommendedId ? (
                    <span className="absolute right-2 top-2 rounded-sm border border-ochre bg-ink/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ochre">
                      pick
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 border-t border-bark/60 px-2 py-1 text-[11px] text-paper-dim">
                  <span className="truncate text-paper">{shot.display_name || shot.id}</span>
                  <span className="text-ochre">{focusScore(shot)}</span>
                  {shot.favorite ? <span className="text-ochre">★</span> : null}
                  <span className="ml-auto">{shot.shutter || ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 font-serif text-paper-dim">
          <div>Every frame in this burst is rejected.</div>
          {rejectedStack.length ? <div className="text-sm">Press U to bring the last one back.</div> : null}
        </div>
      )}

      <div className="flex items-center gap-4 border-t border-bark bg-charcoal/60 px-4 py-1.5 text-xs text-paper-dim">
        <span><kbd className="fc-kbd">{props.keys.next}</kbd>/<kbd className="fc-kbd">{props.keys.prev}</kbd> focus</span>
        <span><kbd className="fc-kbd">{props.keys.reject}</kbd> reject</span>
        <span><kbd className="fc-kbd">{props.keys.keep}</kbd> keep</span>
        <span><kbd className="fc-kbd">{props.keys.unrated}</kbd> restore</span>
        <span><kbd className="fc-kbd">{props.keys.loupe}</kbd> 1:1</span>
        <span><kbd className="fc-kbd">Enter</kbd> keep focused · reject rest</span>
        <span className="ml-auto"><kbd className="fc-kbd">Esc</kbd> close</span>
      </div>
    </div>
  );
}
