import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Shot, Verdict } from "../types";
import { thumbUrl } from "../lib/preview";
import { fmtDay } from "../lib/format";
import { byShootingOrder, useStore, type Outing } from "./store";
import { Chip, Empty, Thumb, TopBar } from "./ui";

/** The library by outing: a day in the field is the unit you remember, so it is the unit you browse. */
export function Outings(props: {
  mode?: "library" | "cull";
  onOpen: (day: string) => void;
  onCull: (day: string | null) => void;
  onAll: () => void;
}) {
  const store = useStore();
  const { shots } = store;
  const culling = props.mode === "cull";
  const outings = culling ? store.outings.filter((o) => o.unrated > 0) : store.outings;
  const unrated = useMemo(() => shots.filter((s) => s.verdict === "unrated").length, [shots]);

  if (!outings.length) {
    return (
      <div className="m-screen">
        <TopBar title={culling ? "Cull" : "Library"} />
        <Empty title={culling ? "All caught up" : "No photographs yet"}>
          {culling ? "Every frame in the library has a verdict." : "Import a card from More, or at the desk. Originals stay where they are."}
        </Empty>
      </div>
    );
  }
  return (
    <div className="m-screen">
      <TopBar
        title={culling ? "Cull" : "Library"}
        sub={culling ? `${unrated.toLocaleString()} frames waiting in ${outings.length} outings` : `${shots.length.toLocaleString()} frames · ${outings.length} outings`}
        right={culling ? undefined : <button type="button" className="m-chip" onClick={props.onAll}>Search all</button>}
      />
      <div className="m-scroll">
        {unrated ? (
          <button type="button" onClick={() => props.onCull(null)}
                  className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-ochre/40 bg-ochre/10 px-4 py-3 text-left active:bg-ochre/20">
            <span className="min-w-0 flex-1">
              <span className="block font-serif text-[17px] text-paper">{unrated.toLocaleString()} frames waiting</span>
              <span className="block text-xs text-paper-dim/80">Cull everything unrated, oldest first</span>
            </span>
            <span className="text-ochre">Start ›</span>
          </button>
        ) : null}
        <ul className="px-4 pb-6 pt-3">
          {outings.map((o) => (
            <OutingRow key={o.day} outing={o} onOpen={() => (culling ? props.onCull(o.day) : props.onOpen(o.day))} onCull={() => props.onCull(o.day)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function OutingRow(props: { outing: Outing; onOpen: () => void; onCull: () => void }) {
  const o = props.outing;
  const done = o.count ? (o.count - o.unrated) / o.count : 1;
  return (
    <li className="flex items-stretch gap-3 border-b border-bark/50 py-3">
      <button type="button" onClick={props.onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-80">
        <img src={thumbUrl(o.cover.preview_path, 320)} alt="" loading="lazy"
             className="h-[4.5rem] w-[4.5rem] flex-none rounded-lg object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[17px] text-paper">{o.day ? fmtDay(o.day) : "Undated"}</span>
          <span className="block truncate text-xs text-paper-dim/80">
            {o.places.length ? o.places.slice(0, 2).join(", ") + (o.places.length > 2 ? ` +${o.places.length - 2}` : "") : "No place yet"}
          </span>
          <span className="mt-1 block text-xs tabular-nums text-paper-dim/70">
            {o.count} frames · <span className="text-moss">{o.keep} kept</span>
            {o.unrated ? <> · <span className="text-ochre">{o.unrated} to go</span></> : null}
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-bark/70">
            <span className="block h-full rounded-full bg-moss/80" style={{ width: `${done * 100}%` }} />
          </span>
        </span>
      </button>
      {o.unrated ? (
        <button type="button" onClick={props.onCull} className="m-btn m-btn-accent self-center !min-h-[2.6rem] !px-3 text-sm">Cull</button>
      ) : null}
    </li>
  );
}

type VerdictFilter = Verdict | "" | "favorite" | "needsid";
const FILTERS: Array<{ key: VerdictFilter; label: string; tone?: "moss" | "ochre" | "reject" }> = [
  { key: "", label: "All" },
  { key: "unrated", label: "Unrated", tone: "ochre" },
  { key: "keep", label: "Kept" },
  { key: "reject", label: "Rejected", tone: "reject" },
  { key: "favorite", label: "Favourites", tone: "ochre" },
  { key: "needsid", label: "Needs a name", tone: "ochre" },
];

/** One outing, or the whole library when `day` is null: a grid you can filter and search. */
export function ShotGrid(props: {
  day: string | null;
  onBack: () => void;
  onOpen: (ids: string[], id: string) => void;
  onCull: (day: string | null) => void;
  onLabelDay?: (day: string) => void;
}) {
  const { shots, burstSizes } = useStore();
  const [filter, setFilter] = useState<VerdictFilter>("");
  const [search, setSearch] = useState("");
  const [stacked, setStacked] = useState(true);
  const query = useDeferredValue(search).trim().toLowerCase();

  const rows = useMemo(() => {
    const list = shots.filter((s) => {
      if (props.day !== null && (s.captured_at || "").slice(0, 10) !== props.day) return false;
      if (filter === "favorite" && !s.favorite) return false;
      if (filter === "needsid" && (s.common_name || s.scientific_name)) return false;
      if ((filter === "keep" || filter === "reject" || filter === "unrated") && s.verdict !== filter) return false;
      if (query) {
        const blob = [s.common_name, s.scientific_name, s.display_name, s.location].filter(Boolean).join(" ").toLowerCase();
        if (!blob.includes(query)) return false;
      }
      return true;
    });
    return list.sort(props.day === null ? (a, b) => -byShootingOrder(a, b) : byShootingOrder);
  }, [shots, props.day, filter, query]);

  // A burst collapses to its sharpest frame with the count on it, as at the desk.
  const cells = useMemo(() => {
    if (!stacked) return rows.map((s) => ({ shot: s, stack: 1 }));
    const out: Array<{ shot: Shot; stack: number }> = [];
    const at = new Map<string, number>();
    for (const s of rows) {
      const key = s.burst_id && (burstSizes.get(s.burst_id) || 0) > 1 ? s.burst_id : "";
      const i = key ? at.get(key) : undefined;
      if (i === undefined) {
        if (key) at.set(key, out.length);
        out.push({ shot: s, stack: 1 });
      } else {
        const cell = out[i];
        cell.stack += 1;
        const better = (s.verdict === "keep" ? 1 : 0) - (cell.shot.verdict === "keep" ? 1 : 0) || (s.sharpness ?? -1) - (cell.shot.sharpness ?? -1);
        if (better > 0) cell.shot = s;
      }
    }
    return out;
  }, [rows, stacked, burstSizes]);

  const COLS = 3;
  const parent = useRef<HTMLDivElement>(null);
  const lines = Math.ceil(cells.length / COLS);
  const virt = useVirtualizer({
    count: lines,
    getScrollElement: () => parent.current,
    estimateSize: () => (parent.current ? parent.current.clientWidth / COLS : 130),
    overscan: 6,
  });

  const ids = useMemo(() => rows.map((s) => s.id), [rows]);
  const unrated = useMemo(() => rows.filter((s) => s.verdict === "unrated").length, [rows]);
  const title = props.day === null ? "All photographs" : props.day ? fmtDay(props.day) : "Undated";

  return (
    <div className="m-screen">
      <TopBar
        title={title}
        sub={`${rows.length.toLocaleString()} frames${unrated ? ` · ${unrated} unrated` : ""}`}
        onBack={props.onBack}
        right={
          props.day !== null && unrated ? (
            <button type="button" className="m-btn m-btn-accent !min-h-[2.4rem] !px-3 text-sm" onClick={() => props.onCull(props.day)}>Cull</button>
          ) : undefined
        }
      />
      <div className="flex-none space-y-2 border-b border-bark/50 px-4 py-2.5">
        <input className="m-input" type="search" inputMode="search" enterKeyHint="search" placeholder="Species, place or file name"
               value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          {FILTERS.map((f) => (
            <Chip key={f.key} active={filter === f.key} tone={f.tone} onClick={() => setFilter(f.key)}>{f.label}</Chip>
          ))}
          <Chip active={stacked} onClick={() => setStacked((v) => !v)}>Stack bursts</Chip>
          {props.day && props.onLabelDay ? <Chip onClick={() => props.onLabelDay!(props.day!)}>Label this day…</Chip> : null}
        </div>
      </div>

      {cells.length ? (
        <div ref={parent} className="m-scroll px-1">
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((line) => (
              <div key={line.key} className="absolute left-0 right-0 grid grid-cols-3 gap-1 pb-1"
                   style={{ transform: `translateY(${line.start}px)`, height: line.size }}>
                {cells.slice(line.index * COLS, line.index * COLS + COLS).map((c) => (
                  <Thumb key={c.shot.id} shot={c.shot} stack={c.stack} onOpen={() => props.onOpen(ids, c.shot.id)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Empty title="Nothing matches">Try another filter, or clear the search.</Empty>
      )}
    </div>
  );
}
