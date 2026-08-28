import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Shot } from "../types";
import { captureDay, fmtDay, focusScore, starsLabel } from "../lib/format";
import { previewUrl } from "../lib/preview";

const GAP = 8;
const TARGET_H = 420;
// A 2:3 portrait at the landscape target height gets ~280px of width -- half a
// landscape neighbour's area. Rows that lean portrait pack to a taller target
// so both orientations read at comparable size.
const PORTRAIT_TARGET_H = 560;
const CAPTION_H = 92;
// 3:2 landscape -- the D850's native ratio, so the first paint is close for
// most frames and rows barely move once real dimensions arrive.
const DEFAULT_AR = 1.5;

export interface BurstMeta {
  count: number;
  keepId: string;
  memberIds: string[];
}

type PhotoRow = {
  kind: "photos";
  items: { shot: Shot; width: number }[];
  height: number;
};

type HeaderRow = {
  kind: "header";
  day: string;
  count: number;
  unrated: number;
  location: string;
  height: number;
};

type PackedRow = PhotoRow | HeaderRow;

const HEADER_H = 44;

/** Consecutive same-day runs; the default sort is capture date, so runs = outings. */
function sections(shots: Shot[]): { day: string; shots: Shot[] }[] {
  const out: { day: string; shots: Shot[] }[] = [];
  for (const shot of shots) {
    const day = captureDay(shot.captured_at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.shots.push(shot);
    else out.push({ day, shots: [shot] });
  }
  return out;
}

function commonLocation(shots: Shot[]): string {
  const counts = new Map<string, number>();
  for (const s of shots) {
    if (s.location) counts.set(s.location, (counts.get(s.location) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [loc, n] of counts) {
    if (n > bestN) {
      best = loc;
      bestN = n;
    }
  }
  return best;
}

/** Target row height, blending taller as the row's mean aspect goes portrait. */
function rowTarget(meanAr: number): number {
  if (meanAr >= 1) return TARGET_H;
  if (meanAr <= 0.7) return PORTRAIT_TARGET_H;
  const t = (1 - meanAr) / 0.3;
  return Math.round(TARGET_H + (PORTRAIT_TARGET_H - TARGET_H) * t);
}

function packRows(
  shots: Shot[],
  containerWidth: number,
  aspects: Map<string, number>,
  grouped: boolean,
): PackedRow[] {
  const inner = Math.max(240, containerWidth - 16);
  if (grouped) {
    return sections(shots).flatMap((sec) => [
      {
        kind: "header" as const,
        day: sec.day,
        count: sec.shots.length,
        unrated: sec.shots.filter((s) => s.verdict === "unrated").length,
        location: commonLocation(sec.shots),
        height: HEADER_H,
      },
      ...packPhotoRows(sec.shots, inner, aspects),
    ]);
  }
  return packPhotoRows(shots, inner, aspects);
}

function packPhotoRows(shots: Shot[], inner: number, aspects: Map<string, number>): PhotoRow[] {
  const rows: PhotoRow[] = [];
  let buf: { shot: Shot; ar: number }[] = [];
  let arSum = 0;

  function emit(items: { shot: Shot; ar: number }[], height: number) {
    const mean = items.reduce((a, it) => a + it.ar, 0) / items.length;
    const maxH = mean < 1 ? 760 : 560;
    const h = Math.min(maxH, Math.max(200, height));
    rows.push({
      kind: "photos",
      height: h,
      items: items.map((it) => ({ shot: it.shot, width: it.ar * h })),
    });
  }

  for (const shot of shots) {
    const ar = aspects.get(shot.id) ?? DEFAULT_AR;
    const nextGaps = GAP * buf.length;
    const meanIfAdded = (arSum + ar) / (buf.length + 1);
    const widthIfAdded = (arSum + ar) * rowTarget(meanIfAdded) + nextGaps;
    if (buf.length && widthIfAdded > inner) {
      const gaps = GAP * (buf.length - 1);
      emit(buf, (inner - gaps) / arSum);
      buf = [];
      arSum = 0;
    }
    buf.push({ shot, ar });
    arSum += ar;
  }
  if (buf.length) {
    const gaps = GAP * (buf.length - 1);
    const filled = (inner - gaps) / arSum;
    const mean = arSum / buf.length;
    emit(buf, Math.min(rowTarget(mean), filled));
  }
  return rows;
}

export default function Grid(props: {
  shots: Shot[];
  selectedId: string | null;
  pickedIds: Set<string>;
  bursts: Map<string, BurstMeta>;
  onSelect: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onKeepThis: (id: string) => void;
  onKeepPick: (burstId: string) => void;
  onCompare: (id: string) => void;
  grouped?: boolean;
  onCullDay?: (day: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  // Aspect ratios learned from decoded images. The catalog already knows the
  // preview dimensions for anything imported since they started being stored,
  // so this only fills gaps for older rows.
  const [learned, setLearned] = useState<Map<string, number>>(() => new Map());

  const aspects = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of props.shots) {
      if (s.preview_width && s.preview_height) {
        map.set(s.id, s.preview_width / s.preview_height);
      }
    }
    for (const [id, ar] of learned) map.set(id, ar);
    return map;
  }, [props.shots, learned]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(
    () => packRows(props.shots, width, aspects, !!props.grouped),
    [props.shots, width, aspects, props.grouped],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const row = rows[i];
      if (!row) return TARGET_H + CAPTION_H + GAP;
      return row.kind === "header" ? row.height + GAP : row.height + CAPTION_H + GAP;
    },
    overscan: 6,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rows, virtualizer]);

  // Scroll to the selection only when the selection itself changes. Keying this
  // on `rows` made every repack (each newly learned aspect ratio) yank the
  // viewport back to the selected row -- the "scrollbar fights me" bug.
  const lastScrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!props.selectedId || props.selectedId === lastScrolledTo.current) return;
    lastScrolledTo.current = props.selectedId;
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.kind === "photos" && row.items.some((it) => it.shot.id === props.selectedId)) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
  }, [props.selectedId, rows, virtualizer]);

  // Images decode independently, so aspects arrive in a burst. Collecting them
  // and flushing once per frame turns N repacks of the whole shot list into one.
  const pendingAspects = useRef<Map<string, number>>(new Map());
  const flushHandle = useRef<number | null>(null);

  useEffect(() => () => {
    if (flushHandle.current !== null) cancelAnimationFrame(flushHandle.current);
  }, []);

  function rememberAspect(id: string, w: number, h: number) {
    if (!w || !h) return;
    const ar = w / h;
    if (Math.abs((aspects.get(id) ?? -1) - ar) < 0.01) return;
    pendingAspects.current.set(id, ar);
    if (flushHandle.current !== null) return;
    flushHandle.current = requestAnimationFrame(() => {
      flushHandle.current = null;
      const batch = pendingAspects.current;
      if (!batch.size) return;
      pendingAspects.current = new Map();
      setLearned((prev) => {
        const next = new Map(prev);
        for (const [k, v] of batch) next.set(k, v);
        return next;
      });
    });
  }

  return (
    <div ref={parentRef} className="fc-scroll h-full" role="listbox" aria-label="Photo library">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index];
          if (!row) return null;
          if (row.kind === "header") {
            return (
              <div
                key={vRow.key}
                className="absolute left-0 flex items-baseline gap-3 px-4"
                style={{ transform: `translateY(${vRow.start}px)`, height: row.height, width: "100%" }}
              >
                <div className="font-serif text-base tracking-wide text-paper">{fmtDay(row.day)}</div>
                <div className="text-xs text-paper-dim">
                  {row.count} shot{row.count === 1 ? "" : "s"}
                  {row.unrated ? ` · ${row.unrated} unrated` : " · culled"}
                  {row.location ? ` · ${row.location}` : ""}
                </div>
                {row.unrated && props.onCullDay ? (
                  <button
                    type="button"
                    className="text-xs text-moss transition-colors hover:text-paper"
                    onClick={() => props.onCullDay?.(row.day)}
                  >
                    Cull this outing →
                  </button>
                ) : null}
                <div className="mb-1 flex-1 self-end border-b border-bark/60" />
              </div>
            );
          }
          return (
            <div
              key={vRow.key}
              className="absolute left-0 px-2"
              style={{
                transform: `translateY(${vRow.start}px)`,
                height: row.height + CAPTION_H,
                width: "100%",
              }}
            >
              <div className="flex" style={{ gap: GAP, height: row.height + CAPTION_H }}>
                {row.items.map((it) => (
                  <Cell
                    key={it.shot.id}
                    shot={it.shot}
                    imgWidth={it.width}
                    imgHeight={row.height}
                    burst={it.shot.burst_id ? props.bursts.get(it.shot.burst_id) : undefined}
                    selected={it.shot.id === props.selectedId}
                    picked={props.pickedIds.has(it.shot.id)}
                    onSelect={(e) => props.onSelect(it.shot.id, e)}
                    onOpen={() => props.onOpen(it.shot.id)}
                    onKeepThis={() => props.onKeepThis(it.shot.id)}
                    onKeepPick={() => it.shot.burst_id && props.onKeepPick(it.shot.burst_id)}
                    onCompare={() => props.onCompare(it.shot.id)}
                    onAspect={(w, h) => rememberAspect(it.shot.id, w, h)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Cell(props: {
  shot: Shot;
  imgWidth: number;
  imgHeight: number;
  burst?: BurstMeta;
  selected: boolean;
  picked: boolean;
  onSelect: (e: MouseEvent) => void;
  onOpen: () => void;
  onKeepThis: () => void;
  onKeepPick: () => void;
  onCompare: () => void;
  onAspect: (w: number, h: number) => void;
}) {
  const { shot, burst } = props;
  const src = previewUrl(shot.preview_path);
  const stacked = (burst?.count || 0) > 1;
  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-md bg-charcoal transition-shadow duration-150 ${
        props.picked
          ? "ring-2 ring-ochre shadow-lg shadow-ochre/10"
          : props.selected
            ? "ring-2 ring-moss shadow-lg shadow-moss/20"
            : "ring-1 ring-bark hover:ring-moss/50 hover:shadow-md hover:shadow-black/40"
      }`}
      style={{ width: props.imgWidth, height: props.imgHeight + CAPTION_H }}
    >
      <button
        type="button"
        role="option"
        aria-selected={props.selected}
        aria-label={`${shot.common_name || shot.display_name || "Unidentified"}${
          shot.verdict !== "unrated" ? `, ${shot.verdict}` : ""
        }`}
        onClick={props.onSelect}
        onDoubleClick={props.onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onOpen();
          }
        }}
        className="relative w-full shrink-0 overflow-hidden bg-charcoal"
        style={{ height: props.imgHeight }}
      >
        {src ? (
          <img
            src={src}
            alt={shot.common_name || shot.display_name || shot.id}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            style={{ imageOrientation: "from-image" }}
            onLoad={(e) => {
              const img = e.currentTarget;
              props.onAspect(img.naturalWidth, img.naturalHeight);
            }}
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-bark/70" />
        )}
        <div className="absolute top-1 left-1 flex gap-1">
          {shot.verdict !== "unrated" ? (
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shadow-sm ${
                shot.verdict === "keep" ? "bg-moss text-paper" : "bg-reject text-paper"
              }`}
            >
              {shot.verdict}
            </span>
          ) : null}
          {shot.favorite ? <span className="rounded-sm bg-ochre px-1 py-0.5 text-[9px] text-ink shadow-sm">★</span> : null}
        </div>
        {shot.color ? (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full" style={{ background: shot.color }} />
        ) : null}
      </button>
      <div className="flex-1 min-h-0 border-t border-bark/60 px-2 py-1.5 text-left">
        <div className="text-[13px] leading-tight truncate text-paper">{shot.common_name || "Needs ID"}</div>
        <div className="text-[11px] italic text-paper-dim truncate">{shot.scientific_name || " "}</div>
        <div className="text-[10px] text-paper-dim truncate mt-0.5">
          {shot.animal_type || "—"} · {shot.location || "—"}
        </div>
        <div className="text-[10px] text-ochre mt-0.5">
          {starsLabel(shot.stars)} · {focusScore(shot)}
        </div>
        {stacked ? (
          <div className="flex flex-wrap gap-1 mt-1">
            <Mini onClick={props.onKeepThis}>KEEP THIS {burst?.count}</Mini>
            <Mini onClick={props.onKeepPick}>KEEP PICK</Mini>
            <Mini onClick={props.onCompare}>COMPARE</Mini>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Mini(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="rounded border border-bark px-1.5 py-0.5 text-[9px] tracking-wide text-paper-dim transition-colors duration-150 hover:border-moss hover:text-moss"
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}
