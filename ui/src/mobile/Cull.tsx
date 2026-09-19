import { useEffect, useMemo, useRef, useState } from "react";
import type { Shot, Verdict } from "../types";
import { previewUrl } from "../lib/preview";
import { fmtDay } from "../lib/format";
import { byShootingOrder, useStore } from "./store";
import { Empty, Stars, TopBar } from "./ui";

/**
 * Culling with one thumb. Swipe right to keep, left to reject, up to leave it for
 * later; or use the two big buttons, which are the same thing for a hand that is
 * also holding a coffee. The queue is fixed when the session starts -- a frame you
 * have judged does not slide out from under your finger -- and Undo walks back
 * through it, taking the verdict back with it.
 */

type Step = { id: string; kind: "verdict" | "skip" };
const SWIPE = 96; // px of travel that commits
const TAP = 9;

export function Cull(props: {
  day: string | null;
  onExit: () => void;
  onInfo: (id: string) => void;
  onLoupe: (id: string) => void;
  onCompare: (burstId: string) => void;
}) {
  const store = useStore();
  const { shots, shotsById, burstSizes } = store;

  // Fixed at the start of the session; see the note above.
  const queue = useMemo(
    () =>
      shots
        .filter((s) => s.verdict === "unrated" && (!props.day || (s.captured_at || "").slice(0, 10) === props.day))
        .sort(byShootingOrder)
        .map((s) => s.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.day, store.ready],
  );

  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [fly, setFly] = useState<null | "left" | "right" | "up">(null);
  const history = useRef<Step[]>([]);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const shot: Shot | undefined = shotsById.get(queue[index]);
  const next: Shot | undefined = shotsById.get(queue[index + 1]);

  // Decode the frame after next while this one is being judged.
  useEffect(() => {
    const after = shotsById.get(queue[index + 2]);
    if (!after) return;
    const img = new window.Image();
    img.decoding = "async";
    img.src = previewUrl(after.preview_path);
  }, [index, queue, shotsById]);

  function advance(kind: Step["kind"], direction: "left" | "right" | "up") {
    if (!shot || fly) return;
    history.current.push({ id: shot.id, kind });
    setFly(direction);
    window.setTimeout(() => {
      setFly(null);
      setDrag({ x: 0, y: 0 });
      setIndex((i) => i + 1);
    }, 170);
  }

  function judge(v: Verdict) {
    if (!shot) return;
    store.setVerdict(shot.id, v);
    if (navigator.vibrate) navigator.vibrate(8);
    advance("verdict", v === "keep" ? "right" : "left");
  }

  function back() {
    const last = history.current.pop();
    if (!last) return;
    if (last.kind === "verdict") store.undo();
    setIndex((i) => Math.max(0, i - 1));
  }

  const title = props.day ? fmtDay(props.day) : "Everything unrated";

  if (!queue.length) {
    return (
      <div className="m-screen">
        <TopBar title={title} onBack={props.onExit} />
        <Empty title="Nothing left to cull here">Every frame in this set has a verdict.</Empty>
      </div>
    );
  }

  if (!shot) {
    const judged = history.current.filter((h) => h.kind === "verdict").length;
    return (
      <div className="m-screen">
        <TopBar title={title} onBack={props.onExit} />
        <Empty
          title="That's the set"
          action={
            <div className="flex justify-center gap-3">
              <button type="button" className="m-btn" onClick={back}>Step back</button>
              <button type="button" className="m-btn m-btn-accent" onClick={props.onExit}>Done</button>
            </div>
          }
        >
          {judged} judged, {queue.length - judged} left for later.
        </Empty>
      </div>
    );
  }

  const lean = Math.max(-1, Math.min(1, drag.x / 160));
  const lift = Math.max(0, Math.min(1, -drag.y / 160));
  const flyTo =
    fly === "left" ? "translate(-130%, 6%) rotate(-16deg)"
    : fly === "right" ? "translate(130%, 6%) rotate(16deg)"
    : fly === "up" ? "translate(0, -120%)"
    : `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${lean * 9}deg)`;
  const burst = shot.burst_id ? burstSizes.get(shot.burst_id) || 0 : 0;
  const time = (shot.captured_at || "").slice(11, 16);

  return (
    <div className="m-screen m-noselect">
      <TopBar
        title={title}
        sub={`${index + 1} of ${queue.length} unrated`}
        onBack={props.onExit}
        right={
          <button type="button" className="m-iconbtn" onClick={() => props.onInfo(shot.id)} aria-label="Details">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" />
            </svg>
          </button>
        }
      />
      <div className="m-progress"><span style={{ width: `${(index / queue.length) * 100}%` }} /></div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* The next frame waits underneath, but only shows once this one starts to leave:
            behind a portrait, a landscape frame would otherwise stick out either side. */}
        {next ? (
          <img src={previewUrl(next.preview_path)} alt="" draggable={false}
               className="absolute inset-0 h-full w-full object-contain transition-opacity duration-150"
               style={{ opacity: fly ? 1 : Math.min(0.85, (Math.abs(drag.x) + Math.max(0, -drag.y)) / 220) }} />
        ) : null}
        <div
          className="absolute inset-0 touch-none"
          style={{ transform: flyTo, transition: fly || !origin.current ? "transform .17s ease-out" : "none" }}
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
            if (Math.abs(d.x) < TAP && Math.abs(d.y) < TAP) {
              setDrag({ x: 0, y: 0 });
              props.onLoupe(shot.id);
            } else if (d.x > SWIPE) judge("keep");
            else if (d.x < -SWIPE) judge("reject");
            else if (d.y < -SWIPE * 1.2 && Math.abs(d.x) < SWIPE) advance("skip", "up");
            else setDrag({ x: 0, y: 0 });
          }}
          onPointerCancel={() => {
            origin.current = null;
            setDrag({ x: 0, y: 0 });
          }}
        >
          <img src={previewUrl(shot.preview_path)} alt={shot.common_name || shot.display_name} draggable={false}
               className="h-full w-full object-contain" />
          <span className="m-stamp m-stamp-keep" style={{ opacity: Math.max(0, lean) }}>KEEP</span>
          <span className="m-stamp m-stamp-reject" style={{ opacity: Math.max(0, -lean) }}>REJECT</span>
          <span className="absolute inset-x-0 top-6 text-center font-serif text-lg tracking-widest text-paper-dim"
                style={{ opacity: lift }}>LATER</span>
        </div>
      </div>

      <div className="flex-none border-t border-bark/60 bg-[#1b1814] px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className={`truncate font-serif text-[17px] leading-tight ${shot.common_name ? "text-paper" : "text-paper-dim/70"}`}>
              {shot.common_name || "Not identified"}
            </p>
            <p className="truncate text-xs text-paper-dim/70">
              {[time, shot.location, shot.display_name].filter(Boolean).join(" · ")}
            </p>
          </div>
          {burst > 1 ? (
            <button type="button" className="m-chip m-chip-on-ochre" onClick={() => props.onCompare(shot.burst_id)}>
              Burst of {burst}
            </button>
          ) : null}
        </div>

        <div className="mt-1 flex items-center justify-between">
          <Stars value={shot.stars || 0} onChange={(n) => store.setStars(shot.id, n)} />
          <button type="button" className={`m-round ${shot.favorite ? "!border-ochre !text-ochre" : ""}`}
                  onClick={() => store.toggleFavorite(shot.id)} aria-pressed={shot.favorite} aria-label="Favourite">♥</button>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button type="button" className="m-verdict m-verdict-reject" onClick={() => judge("reject")} aria-label="Reject">✕</button>
          <button type="button" className="m-round" onClick={back} disabled={!history.current.length} aria-label="Undo">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6L4 11l5 5" /><path d="M4 11h9.5a5.5 5.5 0 0 1 0 11H11" /></svg>
          </button>
          <button type="button" className="m-round" onClick={() => advance("skip", "up")} aria-label="Leave for later">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20V8M6.5 13.5L12 8l5.5 5.5M6 4h12" /></svg>
          </button>
          <button type="button" className="m-verdict m-verdict-keep" onClick={() => judge("keep")} aria-label="Keep">✓</button>
        </div>
      </div>
    </div>
  );
}
