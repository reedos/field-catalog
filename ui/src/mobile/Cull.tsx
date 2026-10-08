import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

type Way = "left" | "right" | "up";
type Step = { id: string; kind: "verdict" | "skip"; way: Way };
/** A photo that has been thrown: where the finger let go of it, and how fast it was going. */
type Thrown = { key: number; shot: Shot; way: Way; x: number; y: number; turn: number; vx: number; vy: number };
const SWIPE = 96; // px of travel that commits
const FLICK = 0.55; // px/ms: a quick flick commits from less travel than that
const TAP = 9;
const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The thrown photo, on its own layer. It carries on from where it was let go, in
 * the direction and at the speed it was going, and turns as it leaves. Because it
 * is not the card underneath, that one is already live: nothing waits for this.
 */
function Flying(props: { card: Thrown; onGone: (key: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { card } = props;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth || 390;
    const h = el.clientHeight || 600;
    const from = `translate(${card.x}px, ${card.y}px) rotate(${card.turn}deg)`;
    let to: string;
    let distance: number;
    if (card.way === "up") {
      const endY = -(h * 1.15);
      const endX = card.x + card.vx * 220;
      to = `translate(${endX}px, ${endY}px) rotate(${card.turn * 1.5}deg)`;
      distance = Math.abs(endY - card.y);
    } else {
      const sign = card.way === "right" ? 1 : -1;
      const endX = sign * w * 1.45;
      // Keep the line the finger was drawing; a throw that was level gets a little fall, like a card.
      const slope = Math.abs(card.vx) > 0.15 ? card.vy / Math.abs(card.vx) : 0;
      const endY = card.y + Math.max(-0.6, Math.min(0.6, slope)) * Math.abs(endX - card.x) + h * 0.06;
      to = `translate(${endX}px, ${endY}px) rotate(${sign * Math.max(18, Math.abs(card.turn) + 14)}deg)`;
      distance = Math.abs(endX - card.x);
    }
    const speed = Math.max(Math.hypot(card.vx, card.vy), 1.5); // px/ms; a button press has none of its own
    const duration = calm() ? 120 : Math.max(260, Math.min(480, distance / speed));
    const thrown = Math.hypot(card.vx, card.vy) > 0.3;
    const anim = el.animate(
      [{ transform: from, opacity: 1 }, { transform: to, opacity: 1, offset: 0.8 }, { transform: to, opacity: 0 }],
      // Let go of mid-swipe it keeps its speed; from a button it has to gather some first.
      { duration, easing: thrown ? "cubic-bezier(.25,.6,.45,1)" : "cubic-bezier(.5,0,.8,.55)", fill: "forwards" },
    );
    const gone = () => props.onGone(card.key);
    anim.onfinish = gone;
    anim.oncancel = gone;
    return () => {
      anim.onfinish = anim.oncancel = null;
      anim.cancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 will-change-transform" aria-hidden
         style={{ transform: `translate(${card.x}px, ${card.y}px) rotate(${card.turn}deg)` }}>
      <img src={previewUrl(card.shot.preview_path)} alt="" draggable={false} className="h-full w-full object-contain" />
      {card.way === "right" ? <span className="m-stamp m-stamp-keep">KEEP</span> : null}
      {card.way === "left" ? <span className="m-stamp m-stamp-reject">REJECT</span> : null}
      {card.way === "up" ? <span className="absolute inset-x-0 top-6 text-center font-serif text-lg tracking-widest text-paper-dim">LATER</span> : null}
    </div>
  );
}

const leanOf = (x: number) => Math.max(-1, Math.min(1, x / 160));
/** How much of the card underneath shows, 0..1, for a given drag. */
const showing = (d: { x: number; y: number }) => Math.min(1, (Math.abs(d.x) + Math.max(0, -d.y)) / 200);

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
  const [flying, setFlying] = useState<Thrown[]>([]);
  const [returning, setReturning] = useState(false);
  const history = useRef<Step[]>([]);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const thrownKey = useRef(0);
  const face = useRef<HTMLDivElement>(null);
  // How the card now on top arrives: rising from underneath, or coming back from where it was thrown.
  const arrival = useRef<{ kind: "rise"; from: number } | { kind: "return"; way: Way } | null>(null);

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

  /** Finger speed over the last tenth of a second, px/ms. */
  function velocity() {
    const pts = trail.current;
    const last = pts[pts.length - 1];
    const first = pts.find((p) => last && last.t - p.t <= 100);
    if (!last || !first || last.t === first.t) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / (last.t - first.t), vy: (last.y - first.y) / (last.t - first.t) };
  }

  function advance(kind: Step["kind"], way: Way, v = { vx: 0, vy: 0 }) {
    if (!shot) return;
    history.current.push({ id: shot.id, kind, way });
    const x = drag.x;
    const y = Math.min(0, drag.y);
    thrownKey.current += 1;
    setFlying((f) => [...f.slice(-3), { key: thrownKey.current, shot, way, x, y, turn: leanOf(x) * 9, ...v }]);
    arrival.current = { kind: "rise", from: showing(drag) };
    setDrag({ x: 0, y: 0 });
    setIndex((i) => i + 1);
  }

  function judge(v: Verdict, speed?: { vx: number; vy: number }) {
    if (!shot) return;
    store.setVerdict(shot.id, v);
    if (navigator.vibrate) navigator.vibrate(8);
    advance("verdict", v === "keep" ? "right" : "left", speed);
  }

  function back() {
    const last = history.current.pop();
    if (!last) return;
    if (last.kind === "verdict") store.undo();
    setFlying([]);
    arrival.current = { kind: "return", way: last.way };
    // The card it lands on stays in view until it has landed.
    setReturning(true);
    window.setTimeout(() => setReturning(false), 330);
    setIndex((i) => Math.max(0, i - 1));
  }

  // The card that has just become the top one. Animated on the inner face, so the
  // outer element is free to follow a finger that is already on it.
  useLayoutEffect(() => {
    const how = arrival.current;
    arrival.current = null;
    const el = face.current;
    if (!how || !el || calm()) return;
    if (how.kind === "rise") {
      el.animate(
        [{ opacity: how.from, transform: `scale(${0.93 + 0.07 * how.from})` }, { opacity: 1, transform: "scale(1)" }],
        { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    } else {
      const start = how.way === "up" ? "translate(0, -115%)"
        : how.way === "right" ? "translate(140%, 6%) rotate(20deg)" : "translate(-140%, 6%) rotate(-20deg)";
      el.animate([{ transform: start }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }, [shot?.id]);

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

  const lean = leanOf(drag.x);
  const lift = Math.max(0, Math.min(1, -drag.y / 160));
  const under = returning ? 1 : showing(drag);
  const held = `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${lean * 9}deg)`;
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
               className="absolute inset-0 h-full w-full object-contain"
               style={{ opacity: under, transform: `scale(${0.93 + 0.07 * under})`,
                        transition: origin.current ? "none" : "opacity .18s ease-out, transform .18s ease-out" }} />
        ) : null}
        {/* Keyed by frame: the next photo is a new card that starts in place, not this one
            sliding back from wherever the last was thrown. */}
        <div
          key={shot.id}
          className="absolute inset-0 touch-none will-change-transform"
          // A swipe that did not commit springs back; one that did is handed to <Flying>.
          style={{ transform: held, transition: origin.current ? "none" : "transform .28s cubic-bezier(.2,1.2,.3,1)" }}
          onPointerDown={(e) => {
            origin.current = { x: e.clientX, y: e.clientY };
            trail.current = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!origin.current) return;
            trail.current = [...trail.current.slice(-7), { x: e.clientX, y: e.clientY, t: e.timeStamp }];
            setDrag({ x: e.clientX - origin.current.x, y: e.clientY - origin.current.y });
          }}
          onPointerUp={() => {
            const d = drag;
            const v = velocity();
            origin.current = null;
            const flickX = Math.abs(v.vx) > FLICK && Math.abs(d.x) > 28 && Math.sign(v.vx) === Math.sign(d.x) && Math.abs(v.vx) > Math.abs(v.vy);
            const flickUp = v.vy < -FLICK && d.y < -28 && Math.abs(v.vy) > Math.abs(v.vx);
            if (Math.abs(d.x) < TAP && Math.abs(d.y) < TAP) {
              setDrag({ x: 0, y: 0 });
              props.onLoupe(shot.id);
            } else if (d.x > SWIPE || (flickX && d.x > 0)) judge("keep", v);
            else if (d.x < -SWIPE || (flickX && d.x < 0)) judge("reject", v);
            else if ((d.y < -SWIPE * 1.2 && Math.abs(d.x) < SWIPE) || flickUp) advance("skip", "up", v);
            else setDrag({ x: 0, y: 0 });
          }}
          onPointerCancel={() => {
            origin.current = null;
            setDrag({ x: 0, y: 0 });
          }}
        >
          <div ref={face} className="h-full w-full">
            <img src={previewUrl(shot.preview_path)} alt={shot.common_name || shot.display_name} draggable={false}
                 className="h-full w-full object-contain" />
            <span className="m-stamp m-stamp-keep" style={{ opacity: Math.max(0, lean) }}>KEEP</span>
            <span className="m-stamp m-stamp-reject" style={{ opacity: Math.max(0, -lean) }}>REJECT</span>
            <span className="absolute inset-x-0 top-6 text-center font-serif text-lg tracking-widest text-paper-dim"
                  style={{ opacity: lift }}>LATER</span>
          </div>
        </div>
        {flying.map((card) => (
          <Flying key={card.key} card={card} onGone={(k) => setFlying((f) => f.filter((c) => c.key !== k))} />
        ))}
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
