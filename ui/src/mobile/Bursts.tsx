import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BurstPick, Shot, Verdict } from "../types";
import { api } from "../lib/worker";
import { previewUrl, thumbUrl } from "../lib/preview";
import { fmtDay } from "../lib/format";
import { byShootingOrder, useStore } from "./store";
import { Chip, Empty, TopBar } from "./ui";

/** The bursts still waiting for a decision. The pick is the worker's: the sharpest frame. */
export function BurstsScreen(props: { onCompare: (burstId: string) => void }) {
  const store = useStore();
  const [bursts, setBursts] = useState<BurstPick[]>([]);
  const [resolved, setResolved] = useState(0);
  const [all, setAll] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.bursts(all);
      setBursts(res.bursts || []);
      setResolved(res.resolved || 0);
    } catch (e) {
      store.fail(e);
    } finally {
      setLoading(false);
    }
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  // Verdicts made anywhere change the queue; a count of them is a cheap thing to watch.
  const judged = useMemo(() => store.shots.reduce((n, s) => n + (s.verdict === "unrated" ? 0 : 1), 0), [store.shots]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, judged]);

  function keepPick(b: BurstPick) {
    const members = b.member_ids?.length ? b.member_ids : [b.keep_id, ...b.reject_ids];
    store.setVerdicts(members.map((id) => ({ id, verdict: (id === b.keep_id ? "keep" : "reject") as Verdict })));
    store.setNotice(`Kept 1, rejected ${members.length - 1} · Undo in Cull or here`);
  }

  return (
    <div className="m-screen">
      <TopBar
        title="Bursts"
        sub={loading ? "Finding bursts…" : `${bursts.length} waiting${resolved ? ` · ${resolved} settled` : ""}`}
        right={<button type="button" className="m-chip" onClick={() => store.undo()}>Undo</button>}
      />
      <div className="flex flex-none gap-2 border-b border-bark/50 px-4 py-2.5">
        <Chip active={!all} tone="ochre" onClick={() => setAll(false)}>Waiting</Chip>
        <Chip active={all} onClick={() => setAll(true)}>All bursts</Chip>
      </div>
      {bursts.length ? (
        <div className="m-scroll">
          <ul className="px-4 pb-6">
            {bursts.map((b) => {
              const pick = store.shotsById.get(b.keep_id);
              if (!pick) return null;
              return (
                <li key={b.burst_id} className="flex gap-3 border-b border-bark/50 py-3">
                  <button type="button" className="relative h-24 w-24 flex-none overflow-hidden rounded-lg bg-charcoal"
                          onClick={() => props.onCompare(b.burst_id)} aria-label="Compare the frames">
                    <img src={thumbUrl(pick.preview_path, 320)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <span className="m-stack">{b.count}</span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate font-serif text-[16px] text-paper">{pick.common_name || "Not identified"}</p>
                    <p className="truncate text-xs text-paper-dim/75">
                      {fmtDay((pick.captured_at || "").slice(0, 10))} · {b.count} frames
                      {b.unrated ? ` · ${b.unrated} unrated` : ""}{b.keep ? ` · ${b.keep} kept` : ""}
                    </p>
                    <div className="mt-auto flex gap-2 pt-2">
                      <button type="button" className="m-btn m-btn-keep !min-h-[2.5rem] flex-1 !px-2 text-sm" onClick={() => keepPick(b)}>Keep the pick</button>
                      <button type="button" className="m-btn !min-h-[2.5rem] flex-1 !px-2 text-sm" onClick={() => props.onCompare(b.burst_id)}>Compare</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : loading ? (
        <Empty title="Finding bursts…" />
      ) : (
        <Empty title="No bursts waiting">Every burst has at least one verdict. "All bursts" shows the settled ones too.</Empty>
      )}
    </div>
  );
}

/**
 * Every frame of one burst. Swipe the big picture or tap the strip to move; the
 * strip shows each frame's verdict and which one measured sharpest. Mark the ones
 * worth having, then reject the rest in a stroke -- or keep just the one you are on.
 */
export function Compare(props: { burstId: string; onClose: () => void; onLoupe: (id: string) => void }) {
  const store = useStore();
  const members = useMemo(
    () => store.shots.filter((s) => s.burst_id === props.burstId).sort(byShootingOrder),
    [store.shots, props.burstId],
  );
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const origin = useRef<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const measure = (s: Shot) => s.subject_sharpness ?? s.sharpness ?? -1;
  const sharpestId = useMemo(
    () => (members.length ? members.reduce((best, s) => (measure(s) > measure(best) ? s : best), members[0]).id : ""),
    [members],
  );
  useEffect(() => {
    const i = members.findIndex((m) => m.id === sharpestId);
    if (i >= 0) setIndex(i);
  }, [props.burstId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  const shot = members[index];
  if (!shot) {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-ink">
        <button type="button" className="m-btn" onClick={props.onClose}>Back</button>
      </div>
    );
  }
  const kept = members.filter((m) => m.verdict === "keep");
  const best = measure(members.find((m) => m.id === sharpestId) || shot);
  const relative = best > 0 && measure(shot) >= 0 ? Math.round((measure(shot) / best) * 100) : null;
  const toggle = (v: Verdict) => store.setVerdict(shot.id, shot.verdict === v ? "unrated" : v);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink m-noselect">
      <TopBar
        title={shot.common_name || "Burst"}
        sub={`Frame ${index + 1} of ${members.length}${relative !== null ? ` · ${relative === 100 ? "sharpest" : `${relative}% of the sharpest`}` : ""}`}
        onBack={props.onClose}
        right={<button type="button" className="m-chip" onClick={() => store.undo()}>Undo</button>}
      />
      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={(e) => { origin.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (origin.current !== null) setDragX(e.clientX - origin.current); }}
        onPointerUp={() => {
          const d = dragX;
          origin.current = null;
          setDragX(0);
          if (Math.abs(d) < 9) props.onLoupe(shot.id);
          else if (d < -60 && index < members.length - 1) setIndex(index + 1);
          else if (d > 60 && index > 0) setIndex(index - 1);
        }}
        onPointerCancel={() => { origin.current = null; setDragX(0); }}
      >
        <img key={shot.id} src={previewUrl(shot.preview_path)} alt="" draggable={false} className="h-full w-full object-contain"
             style={{ transform: `translateX(${dragX}px)`, transition: origin.current === null ? "transform .16s ease-out" : "none" }} />
      </div>

      <div ref={strip} className="flex flex-none gap-1.5 overflow-x-auto bg-[#1b1814] px-3 py-2 [scrollbar-width:none]">
        {members.map((m, i) => (
          <button key={m.id} type="button" onClick={() => setIndex(i)}
                  className={`relative h-16 w-16 flex-none overflow-hidden rounded-md ${i === index ? "ring-2 ring-ochre" : "opacity-75"}`}
                  aria-label={`Frame ${i + 1}`} aria-current={i === index}>
            <img src={thumbUrl(m.preview_path, 320)} alt="" loading="lazy" className="h-full w-full object-cover" />
            {m.verdict !== "unrated" ? (
              <span className={`absolute left-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full text-[9px] ${m.verdict === "keep" ? "bg-moss" : "bg-reject"} text-paper`}>
                {m.verdict === "keep" ? "✓" : "✕"}
              </span>
            ) : null}
            {m.id === sharpestId ? <span className="absolute inset-x-0 bottom-0 bg-ink/75 text-center text-[9px] leading-4 text-ochre">sharpest</span> : null}
          </button>
        ))}
      </div>

      <div className="flex-none bg-[#1b1814] px-5 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] pt-1">
        <div className="flex items-center justify-between">
          <button type="button" className={`m-verdict m-verdict-reject !h-14 !w-14 !text-2xl ${shot.verdict === "reject" ? "m-verdict-on" : ""}`}
                  onClick={() => toggle("reject")} aria-pressed={shot.verdict === "reject"} aria-label="Reject this frame">✕</button>
          <p className="px-3 text-center text-xs leading-snug text-paper-dim/80">
            {kept.length ? `${kept.length} marked to keep` : "Mark the ones worth having"}
            <br />tap the photo for the loupe
          </p>
          <button type="button" className={`m-verdict m-verdict-keep !h-14 !w-14 !text-2xl ${shot.verdict === "keep" ? "m-verdict-on" : ""}`}
                  onClick={() => toggle("keep")} aria-pressed={shot.verdict === "keep"} aria-label="Keep this frame">✓</button>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button type="button" className="m-btn !min-h-[2.75rem] !px-2 text-sm"
                  onClick={() => {
                    store.setVerdicts(members.map((m) => ({ id: m.id, verdict: (m.id === shot.id ? "keep" : "reject") as Verdict })));
                    store.setNotice(`Kept this one, rejected ${members.length - 1}`);
                  }}>
            Keep only this one
          </button>
          <button type="button" className="m-btn m-btn-keep !min-h-[2.75rem] !px-2 text-sm" disabled={!kept.length || kept.length === members.length}
                  onClick={() => {
                    const rest = members.filter((m) => m.verdict !== "keep");
                    store.setVerdicts(rest.map((m) => ({ id: m.id, verdict: "reject" as Verdict })));
                    store.setNotice(`Kept ${kept.length}, rejected ${rest.length}`);
                  }}>
            Reject the other {members.length - kept.length}
          </button>
        </div>
      </div>
    </div>
  );
}
