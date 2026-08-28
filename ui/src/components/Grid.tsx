import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Shot } from "../types";
import { focusScore, starsLabel } from "../lib/format";
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

type PackedRow = {
  items: { shot: Shot; width: number }[];
  height: number;
};

/** Target row height, blending taller as the row's mean aspect goes portrait. */
function rowTarget(meanAr: number): number {
  if (meanAr >= 1) return TARGET_H;
  if (meanAr <= 0.7) return PORTRAIT_TARGET_H;
  const t = (1 - meanAr) / 0.3;
  return Math.round(TARGET_H + (PORTRAIT_TARGET_H - TARGET_H) * t);
}

function packRows(shots: Shot[], containerWidth: number, aspects: Map<string, number>): PackedRow[] {
  const inner = Math.max(240, containerWidth - 16);
  const rows: PackedRow[] = [];
  let buf: { shot: Shot; ar: number }[] = [];
  let arSum = 0;

  function emit(items: { shot: Shot; ar: number }[], height: number) {
    const mean = items.reduce((a, it) => a + it.ar, 0) / items.length;
    const maxH = mean < 1 ? 760 : 560;
    const h = Math.min(maxH, Math.max(200, height));
    rows.push({
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
    () => packRows(props.shots, width, aspects),
    [props.shots, width, aspects],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.height ?? TARGET_H) + CAPTION_H + GAP,
    overscan: 6,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rows, virtualizer]);

  useEffect(() => {
    if (!props.selectedId) return;
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].items.some((it) => it.shot.id === props.selectedId)) {
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
    <div ref={parentRef} className="fc-scroll h-full">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index];
          if (!row) return null;
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
      className={`flex flex-col overflow-hidden bg-charcoal ${
        props.picked ? "ring-2 ring-ochre" : props.selected ? "ring-2 ring-moss" : "ring-1 ring-bark"
      }`}
      style={{ width: props.imgWidth, height: props.imgHeight + CAPTION_H }}
    >
      <button
        type="button"
        onClick={props.onSelect}
        onDoubleClick={props.onOpen}
        className="relative w-full shrink-0 overflow-hidden bg-charcoal"
        style={{ height: props.imgHeight }}
      >
        {src ? (
          <img
            src={src}
            alt={shot.common_name || shot.display_name || shot.id}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ imageOrientation: "from-image" }}
            onLoad={(e) => {
              const img = e.currentTarget;
              props.onAspect(img.naturalWidth, img.naturalHeight);
            }}
          />
        ) : (
          <div className="h-full w-full bg-bark" />
        )}
        <div className="absolute top-1 left-1 flex gap-1">
          {shot.verdict !== "unrated" ? (
            <span
              className={`text-[10px] px-1 uppercase ${
                shot.verdict === "keep" ? "bg-moss text-paper" : "bg-reject text-paper"
              }`}
            >
              {shot.verdict}
            </span>
          ) : null}
          {shot.favorite ? <span className="text-[10px] px-1 bg-ochre text-ink">★</span> : null}
        </div>
        {shot.color ? (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full" style={{ background: shot.color }} />
        ) : null}
      </button>
      <div className="flex-1 min-h-0 px-2 py-1.5 text-left">
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
      className="text-[9px] tracking-wide px-1 py-0.5 border border-bark text-paper-dim hover:border-moss hover:text-paper"
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}
