import { useEffect, useRef, useState } from "react";
import type { Verdict } from "../types";
import { isTauri, loupeUrl, previewUrl } from "../lib/preview";
import { fmtDay } from "../lib/format";
import { useStore } from "./store";

/**
 * One photograph, full screen. Swipe sideways to move through the set you came
 * from, down to leave. Unlike Cull nothing advances on its own here: this is for
 * looking, and changing your mind.
 */
export function Viewer(props: {
  ids: string[];
  startId: string;
  onClose: () => void;
  onInfo: (id: string) => void;
  onLoupe: (id: string) => void;
  onCompare: (burstId: string) => void;
}) {
  const store = useStore();
  const [index, setIndex] = useState(() => Math.max(0, props.ids.indexOf(props.startId)));
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [chrome, setChrome] = useState(true);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const shot = store.shotsById.get(props.ids[index]);

  useEffect(() => {
    for (const off of [1, -1]) {
      const s = store.shotsById.get(props.ids[index + off]);
      if (!s) continue;
      const img = new window.Image();
      img.decoding = "async";
      img.src = previewUrl(s.preview_path);
    }
  }, [index, props.ids, store.shotsById]);

  if (!shot) {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-ink">
        <button type="button" className="m-btn" onClick={props.onClose}>Back</button>
      </div>
    );
  }

  const toggle = (v: Verdict) => store.setVerdict(shot.id, shot.verdict === v ? "unrated" : v);
  const burst = shot.burst_id ? store.burstSizes.get(shot.burst_id) || 0 : 0;
  const horizontal = Math.abs(drag.x) > Math.abs(drag.y);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink m-noselect">
      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={(e) => {
          origin.current = { x: e.clientX, y: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (origin.current) setDrag({ x: e.clientX - origin.current.x, y: e.clientY - origin.current.y });
        }}
        onPointerUp={() => {
          const d = drag;
          origin.current = null;
          setDrag({ x: 0, y: 0 });
          if (Math.abs(d.x) < 9 && Math.abs(d.y) < 9) return setChrome((c) => !c);
          if (Math.abs(d.x) > Math.abs(d.y)) {
            if (d.x < -70 && index < props.ids.length - 1) setIndex(index + 1);
            else if (d.x > 70 && index > 0) setIndex(index - 1);
          } else if (d.y > 110) props.onClose();
        }}
        onPointerCancel={() => {
          origin.current = null;
          setDrag({ x: 0, y: 0 });
        }}
      >
        <img
          key={shot.id}
          src={previewUrl(shot.preview_path)}
          alt={shot.common_name || shot.display_name}
          draggable={false}
          className="h-full w-full object-contain"
          style={{
            transform: horizontal ? `translateX(${drag.x}px)` : `translateY(${Math.max(0, drag.y)}px) scale(${1 - Math.max(0, drag.y) / 1400})`,
            transition: origin.current ? "none" : "transform .18s ease-out",
          }}
        />
      </div>

      {chrome ? (
        <>
          <div className="absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-ink/85 to-transparent px-2 pb-6 pt-[calc(env(safe-area-inset-top)+0.35rem)]">
            <button type="button" className="m-iconbtn" onClick={props.onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className={`truncate font-serif text-[17px] ${shot.common_name ? "text-paper" : "text-paper-dim/70"}`}>{shot.common_name || "Not identified"}</p>
              <p className="truncate text-xs text-paper-dim/75">
                {[fmtDay((shot.captured_at || "").slice(0, 10)), shot.location].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="min-w-[2.75rem] flex-none whitespace-nowrap pr-2 text-right text-xs tabular-nums text-paper-dim/70">{index + 1}/{props.ids.length}</span>
          </div>

          <div className="flex-none bg-[#1b1814] px-5 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] pt-2.5">
            {burst > 1 ? (
              <div className="mb-2 flex justify-center">
                <button type="button" className="m-chip m-chip-on-ochre" onClick={() => props.onCompare(shot.burst_id)}>
                  Burst of {burst} · compare
                </button>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <button type="button" className={`m-verdict m-verdict-reject !h-14 !w-14 !text-2xl ${shot.verdict === "reject" ? "m-verdict-on" : ""}`}
                      onClick={() => toggle("reject")} aria-pressed={shot.verdict === "reject"} aria-label="Reject">✕</button>
              <button type="button" className={`m-round ${shot.favorite ? "!border-ochre !text-ochre" : ""}`}
                      onClick={() => store.toggleFavorite(shot.id)} aria-pressed={shot.favorite} aria-label="Favourite">♥</button>
              {isTauri() ? null : (
                <button type="button" className="m-round" onClick={() => props.onLoupe(shot.id)} aria-label="Loupe">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5M11 8.5v5M8.5 11h5" /></svg>
                </button>
              )}
              <button type="button" className="m-round" onClick={() => props.onInfo(shot.id)} aria-label="Details">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>
              </button>
              <button type="button" className={`m-verdict m-verdict-keep !h-14 !w-14 !text-2xl ${shot.verdict === "keep" ? "m-verdict-on" : ""}`}
                      onClick={() => toggle("keep")} aria-pressed={shot.verdict === "keep"} aria-label="Keep">✓</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The 1:1 loupe. A D850 original is 17 to 34 MB, which is not something to pull
 * over a phone connection to check one eye -- so tap where you want to look and
 * the server cuts that region out of the original, pixel for pixel, and sends
 * only that. Drag to move around inside it; tap "Frame" to choose another spot.
 */
export function Loupe(props: { id: string; onClose: () => void }) {
  const { shotsById } = useStore();
  const shot = shotsById.get(props.id);
  const [at, setAt] = useState<{ cx: number; cy: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const SIZE = 1600;

  if (!shot) return null;
  const gone = shot.original_status !== "present";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink">
      <div className="flex flex-none items-center gap-2 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.35rem)]">
        <button type="button" className="m-iconbtn" onClick={props.onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <p className="min-w-0 flex-1 truncate text-sm text-paper-dim">
          {at ? "1:1 from the original · drag to look around" : gone ? "The original is no longer on disk" : "Tap where you want to check focus"}
        </p>
        {at ? <button type="button" className="m-chip" onClick={() => { setAt(null); setFailed(false); }}>Frame</button> : null}
      </div>

      {at ? (
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
          {loading ? <p className="absolute inset-0 grid place-items-center text-sm text-paper-dim/70">Cutting from the original…</p> : null}
          {failed ? <p className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-reject">Could not read the original for this frame.</p> : null}
          <img
            src={loupeUrl(shot.id, at.cx, at.cy, SIZE)}
            alt=""
            draggable={false}
            className="block max-w-none"
            style={{ width: SIZE / (window.devicePixelRatio || 1), opacity: loading ? 0 : 1 }}
            onLoad={() => {
              setLoading(false);
              const el = scroller.current;
              if (el) el.scrollTo({ left: (el.scrollWidth - el.clientWidth) / 2, top: (el.scrollHeight - el.clientHeight) / 2 });
            }}
            onError={() => { setLoading(false); setFailed(true); }}
          />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <img
            src={previewUrl(shot.preview_path)}
            alt=""
            draggable={false}
            className="h-full w-full object-contain"
            onClick={(e) => {
              if (gone) return;
              const img = e.currentTarget;
              const box = img.getBoundingClientRect();
              // object-contain letterboxes: find the drawn image inside the element
              const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
              const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
              const x = (e.clientX - box.left - (box.width - w) / 2) / w;
              const y = (e.clientY - box.top - (box.height - h) / 2) / h;
              if (x < 0 || x > 1 || y < 0 || y > 1) return;
              setLoading(true);
              setFailed(false);
              setAt({ cx: x, cy: y });
            }}
          />
        </div>
      )}
    </div>
  );
}
