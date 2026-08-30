import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Keymap, Shot, Verdict } from "../types";
import { focusScore } from "../lib/format";
import { keyLabel, matches } from "../lib/keys";
import { previewUrl } from "../lib/preview";

/**
 * Survey compare for a burst: every remaining frame on screen at once, pan and
 * 1:1 zoom synced across all of them.
 *
 * There is no one way people cull a burst, so this does not insist on one.
 * Mark frames keep or reject one at a time and the focus walks on; or mark the
 * two or three worth having and reject the rest in a stroke; or flag only the
 * duds and keep the rest. The fast path still works: X away the losers until
 * one remains, Enter keeps it.
 *
 * Rejected frames leave the wall so the survivors get bigger, but they are not
 * gone — the header counts them and brings them back, and a reject comes off
 * the same way it went on.
 *
 * Pan is stored as a fraction of the image, not pixels, so the same subject
 * region lines up across frames — burst frames share framing and dimensions.
 */
export default function CompareView(props: {
  members: Shot[];
  keys: Keymap;
  onVerdict: (id: string, v: Verdict) => void;
  onResolve: (pairs: Array<{ id: string; verdict: Verdict }>) => void;
  onKeepOnly: (keepId: string) => void;
  onClose: () => void;
}) {
  const [showRejected, setShowRejected] = useState(false);

  const { live, rejected, kept, undecided } = useMemo(() => {
    const live: Shot[] = [], rejected: Shot[] = [], kept: Shot[] = [], undecided: Shot[] = [];
    for (const m of props.members) {
      if (m.verdict === "reject") rejected.push(m);
      else {
        live.push(m);
        (m.verdict === "keep" ? kept : undecided).push(m);
      }
    }
    return { live, rejected, kept, undecided };
  }, [props.members]);

  const shown = showRejected ? props.members : live;

  // Same ranking the worker's burst_pick uses; shown as a starting hypothesis.
  const recommendedId = useMemo(() => {
    if (live.length < 2) return null;
    return [...live].sort(
      (a, b) =>
        (b.sharpness ?? -1) - (a.sharpness ?? -1) ||
        (b.quality ?? -1) - (a.quality ?? -1) ||
        b.stars - a.stars ||
        Number(b.favorite) - Number(a.favorite),
    )[0]?.id ?? null;
  }, [live]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = shown.find((m) => m.id === focusedId) ?? shown[0] ?? null;

  const [zoom, setZoom] = useState<"fit" | "1:1">("fit");
  const [pan, setPan] = useState({ fx: 0.5, fy: 0.5 });
  const dragRef = useRef<{ x: number; y: number; fx: number; fy: number; w: number; h: number } | null>(null);

  // Frames rejected from inside this compare session, so U can walk them back.
  const [rejectedStack, setRejectedStack] = useState<string[]>([]);

  function moveFocus(delta: number) {
    if (!shown.length) return;
    const idx = Math.max(0, shown.findIndex((m) => m.id === focused?.id));
    const next = shown[Math.max(0, Math.min(shown.length - 1, idx + delta))];
    if (next) setFocusedId(next.id);
  }

  /**
   * Put a verdict on one frame, or take it back off if that is the verdict it
   * already carries. `advance` is for the keyboard: marking a burst frame by
   * frame is one pass, not a series of returns to the same photograph.
   */
  function mark(shot: Shot, v: Verdict, advance: boolean) {
    const next: Verdict = shot.verdict === v ? "unrated" : v;
    if (next === "reject") setRejectedStack((s) => [...s, shot.id]);
    else setRejectedStack((s) => s.filter((id) => id !== shot.id));
    props.onVerdict(shot.id, next);
    if (!advance) return;
    // A rejected frame leaves the wall unless rejects are on show, so aim past
    // it rather than at it.
    const idx = shown.findIndex((m) => m.id === shot.id);
    const rest = shown.slice(idx + 1).filter((m) => m.id !== shot.id);
    const back = shown.slice(0, idx);
    const leaving = next === "reject" && !showRejected;
    const after = rest[0] ?? (leaving ? back[back.length - 1] : shown[idx]) ?? null;
    setFocusedId(after?.id ?? null);
  }

  function restoreLast() {
    const id = rejectedStack[rejectedStack.length - 1];
    if (!id) return;
    setRejectedStack((s) => s.slice(0, -1));
    props.onVerdict(id, "unrated");
    setFocusedId(id);
  }

  /** Everything still undecided becomes a reject; what you marked keep stands. */
  function rejectTheRest() {
    props.onResolve(undecided.map((m) => ({ id: m.id, verdict: "reject" as Verdict })));
  }

  /** Everything still undecided becomes a keep; what you marked reject stands. */
  function keepTheRest() {
    props.onResolve(undecided.map((m) => ({ id: m.id, verdict: "keep" as Verdict })));
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
      // Once you have marked keepers, Enter finishes what you started rather
      // than overruling it with the one frame that happens to be focused.
      if (kept.length) {
        if (undecided.length) rejectTheRest();
      } else if (focused) {
        props.onKeepOnly(focused.id);
      }
      return;
    }
    const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (matches(e, props.keys.next) || (bare && (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j"))) {
      e.preventDefault();
      moveFocus(1);
    } else if (matches(e, props.keys.prev) || (bare && (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k"))) {
      e.preventDefault();
      moveFocus(-1);
    } else if (matches(e, props.keys.reject)) {
      e.preventDefault();
      if (focused) mark(focused, "reject", true);
    } else if (matches(e, props.keys.keep)) {
      e.preventDefault();
      if (focused) mark(focused, "keep", true);
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

  const cols = shown.length <= 2 ? Math.max(1, shown.length) : shown.length <= 4 ? 2 : 3;
  const rows = Math.ceil(Math.max(1, shown.length) / cols);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink">
      <div className="flex items-center gap-3 border-b border-bark bg-charcoal px-4 py-2">
        <div className="font-serif text-base tracking-wide text-paper">
          Compare <span className="text-ochre">·</span> {props.members.length} frame
          {props.members.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {kept.length ? <span className="text-moss">{kept.length} keep</span> : null}
          {rejected.length ? <span className="text-reject">{rejected.length} reject</span> : null}
          {undecided.length ? <span className="text-paper-dim">{undecided.length} undecided</span> : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {rejected.length ? (
            <button
              type="button"
              onClick={() => setShowRejected((v) => !v)}
              className={`fc-btn ${showRejected ? "fc-warn" : "fc-ghost"}`}
              title="Bring the rejected frames back on screen to take a reject off one"
            >
              {showRejected ? "Hide rejected" : `Rejected (${rejected.length})`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setZoom((z) => (z === "fit" ? "1:1" : "fit"))}
            className={`fc-btn ${zoom === "1:1" ? "fc-warn" : "fc-ghost"}`}
            title={`Toggle 1:1 (${keyLabel(props.keys.loupe)})`}
          >
            {zoom === "1:1" ? "1:1 — drag pans all" : "Fit"}
          </button>
          {undecided.length && rejected.length ? (
            <button
              type="button"
              onClick={keepTheRest}
              className="fc-btn fc-ghost"
              title={`Keep the ${undecided.length} frame${undecided.length === 1 ? "" : "s"} you did not reject`}
            >
              Keep the rest ({undecided.length})
            </button>
          ) : null}
          {kept.length ? (
            <button
              type="button"
              onClick={rejectTheRest}
              disabled={!undecided.length}
              className="fc-btn fc-accent"
              title={
                undecided.length
                  ? `Reject the ${undecided.length} frame${undecided.length === 1 ? "" : "s"} you did not mark keep (Enter)`
                  : "Nothing left undecided"
              }
            >
              Reject the rest ({undecided.length})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => focused && props.onKeepOnly(focused.id)}
              disabled={!focused}
              className="fc-btn fc-accent"
              title="Enter"
            >
              Keep focused, reject rest
            </button>
          )}
          <button type="button" onClick={props.onClose} className="fc-btn fc-ghost" title="Escape">
            Close
          </button>
        </div>
      </div>

      {shown.length ? (
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
          {shown.map((shot) => {
            const src = previewUrl(shot.preview_path);
            const natW = shot.preview_width || 1600;
            const natH = shot.preview_height || 1067;
            const isFocused = shot.id === focused?.id;
            const isReject = shot.verdict === "reject";
            const isKeep = shot.verdict === "keep";
            return (
              <div
                key={shot.id}
                className={`flex min-h-0 flex-col overflow-hidden rounded-md bg-charcoal transition-shadow duration-150 ${
                  isFocused
                    ? "ring-2 ring-moss shadow-lg shadow-moss/20"
                    : isKeep
                      ? "ring-1 ring-moss/60"
                      : isReject
                        ? "ring-1 ring-reject/50"
                        : "ring-1 ring-bark"
                }`}
              >
                <div
                  className={`relative min-h-0 flex-1 overflow-hidden bg-ink ${isReject ? "opacity-40" : ""} ${
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
                  {isKeep ? (
                    <span className="absolute left-2 top-2 rounded-sm bg-moss px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper shadow-sm">
                      keep
                    </span>
                  ) : null}
                  {isReject ? (
                    <span className="absolute left-2 top-2 rounded-sm bg-reject px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper shadow-sm">
                      reject
                    </span>
                  ) : null}
                  {shot.id === recommendedId ? (
                    <span className="absolute right-2 top-2 rounded-sm border border-ochre bg-ink/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ochre">
                      pick
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 border-t border-bark/60 px-2 py-1 text-[11px] text-paper-dim">
                  <span className="truncate text-paper">{shot.display_name || shot.id}</span>
                  <span className="text-ochre">{focusScore(shot)}</span>
                  {shot.favorite ? <span className="text-ochre">★</span> : null}
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => mark(shot, "keep", false)}
                      className={`transition-colors ${isKeep ? "text-moss" : "hover:text-moss"}`}
                      title={isKeep ? "Take the keep back off" : `Mark this frame keep (${keyLabel(props.keys.keep)})`}
                    >
                      Keep
                    </button>
                    <span className="text-bark">·</span>
                    <button
                      type="button"
                      onClick={() => mark(shot, "reject", false)}
                      className={`transition-colors ${isReject ? "text-reject" : "hover:text-reject"}`}
                      title={isReject ? "Take the reject back off" : `Mark this frame reject (${keyLabel(props.keys.reject)})`}
                    >
                      {isReject ? "Restore" : "Reject"}
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 font-serif text-paper-dim">
          <div>Every frame in this burst is rejected.</div>
          <button type="button" onClick={() => setShowRejected(true)} className="fc-btn fc-ghost">
            Show them
          </button>
        </div>
      )}

      <div className="flex items-center gap-4 border-t border-bark bg-charcoal/60 px-4 py-1.5 text-xs text-paper-dim">
        <span><kbd className="fc-kbd">{keyLabel(props.keys.next)}</kbd>/<kbd className="fc-kbd">{keyLabel(props.keys.prev)}</kbd> focus</span>
        <span><kbd className="fc-kbd">{keyLabel(props.keys.reject)}</kbd> reject &amp; on</span>
        <span><kbd className="fc-kbd">{keyLabel(props.keys.keep)}</kbd> keep &amp; on</span>
        <span><kbd className="fc-kbd">{keyLabel(props.keys.unrated)}</kbd> undo reject</span>
        <span><kbd className="fc-kbd">{keyLabel(props.keys.loupe)}</kbd> 1:1</span>
        <span>
          <kbd className="fc-kbd">Enter</kbd>{" "}
          {kept.length ? "reject the rest" : "keep focused · reject rest"}
        </span>
        <span className="ml-auto"><kbd className="fc-kbd">Esc</kbd> close</span>
      </div>
    </div>
  );
}
