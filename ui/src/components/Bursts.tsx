import { useMemo, useState } from "react";
import type { BurstPick, Shot } from "../types";
import { previewUrl } from "../lib/preview";

export default function Bursts(props: {
  bursts: BurstPick[];
  shotsById: Map<string, Shot>;
  onApply: (keepId: string, rejectIds: string[]) => void;
  onOpen: (id: string) => void;
  onCompare: (burstId: string) => void;
  resolved: number;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
}) {
  const toggle = props.resolved ? (
    <button
      type="button"
      className="fc-btn fc-ghost text-xs"
      onClick={() => props.onShowResolved(!props.showResolved)}
    >
      {props.showResolved
        ? `Hide ${props.resolved} culled`
        : `Show ${props.resolved} already culled`}
    </button>
  ) : null;

  if (!props.bursts.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 font-serif text-paper-dim">
        <div>
          {props.resolved && !props.showResolved
            ? `Every burst is culled — ${props.resolved} decided.`
            : "No bursts of two or more frames."}
        </div>
        {toggle}
      </div>
    );
  }

  return (
    <div className="fc-scroll h-full p-4">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-serif text-lg text-paper">
          {props.bursts.length} burst{props.bursts.length === 1 ? "" : "s"}
          {props.showResolved ? "" : " to decide"}
        </h2>
        {toggle}
      </div>
      <div className="space-y-6">
        {props.bursts.map((b) => (
          <BurstRow
            key={b.burst_id}
            burst={b}
            shotsById={props.shotsById}
            onApply={props.onApply}
            onOpen={props.onOpen}
            onCompare={props.onCompare}
          />
        ))}
      </div>
    </div>
  );
}

function BurstRow(props: {
  burst: BurstPick;
  shotsById: Map<string, Shot>;
  onApply: (keepId: string, rejectIds: string[]) => void;
  onOpen: (id: string) => void;
  onCompare: (burstId: string) => void;
}) {
  const members = useMemo(() => {
    const ids = props.burst.member_ids?.length
      ? props.burst.member_ids
      : [props.burst.keep_id, ...props.burst.reject_ids];
    return ids.map((id) => props.shotsById.get(id)).filter((s): s is Shot => !!s);
  }, [props.burst, props.shotsById]);
  const [keepId, setKeepId] = useState(props.burst.keep_id);
  const keep = members.find((m) => m.id === keepId) || members[0];

  return (
    <section className="border border-bark bg-charcoal/60 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-serif">
          {members.length} frames
          {keep?.sharpness != null ? ` · sharpest ${keep.sharpness.toFixed(0)}` : ""}
          {props.burst.unrated === 0 ? (
            <span className="ml-2 text-xs text-moss">
              culled · {props.burst.keep ?? 0} keep, {props.burst.reject ?? 0} reject
            </span>
          ) : null}
        </h3>
        <div className="flex gap-2">
          <button
            className="fc-btn fc-warn"
            onClick={() => props.onCompare(props.burst.burst_id)}
          >
            Compare
          </button>
          <button
            className="fc-btn border-moss bg-moss text-paper hover:bg-moss-dark hover:border-moss-dark"
            onClick={() =>
              props.onApply(
                keepId,
                members.filter((m) => m.id !== keepId).map((m) => m.id),
              )
            }
          >
            Keep pick, reject rest
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {members.map((shot) => {
          const src = previewUrl(shot.preview_path);
          const chosen = shot.id === keepId;
          return (
            <button
              key={shot.id}
              onClick={() => setKeepId(shot.id)}
              onDoubleClick={() => props.onOpen(shot.id)}
              className={`relative shrink-0 ${chosen ? "ring-2 ring-moss" : "ring-1 ring-bark"}`}
            >
              {src ? (
                <img src={src} alt="" className="h-28 w-40 object-cover" />
              ) : (
                <div className="h-28 w-40 bg-bark" />
              )}
              <span className="absolute bottom-1 left-1 text-[10px] bg-ink/80 px-1">
                {shot.sharpness != null ? shot.sharpness.toFixed(0) : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
