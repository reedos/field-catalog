import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Shot, Verdict } from "../types";
import { thumbUrl } from "../lib/preview";

/**
 * The phone's small vocabulary. Everything here is sized for a thumb: nothing a
 * finger has to hit is under 44px, and the things used most sit at the bottom of
 * the screen, where a hand already is.
 */

export type TabKey = "cull" | "library" | "bursts" | "life" | "more";

const TABS: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
  { key: "cull", label: "Cull", icon: <path d="M4 7h16M4 12h10M4 17h6M17 14l2.5 2.5L23 12" /> },
  { key: "library", label: "Library", icon: <path d="M3 5h7v7H3zM14 5h7v7h-7zM3 15h7v5H3zM14 15h7v5h-7z" /> },
  { key: "bursts", label: "Bursts", icon: <path d="M7 4h13v13M4 7h13v13H4z" /> },
  { key: "life", label: "Life list", icon: <path d="M12 3c4 3 6 6 6 9a6 6 0 0 1-12 0c0-3 2-6 6-9zM12 21v-6" /> },
  { key: "more", label: "More", icon: <path d="M5 12h.01M12 12h.01M19 12h.01" /> },
];

export function TabBar(props: { tab: TabKey; onTab: (t: TabKey) => void; badges?: Partial<Record<TabKey, number>> }) {
  return (
    <nav className="m-tabbar" aria-label="Sections">
      {TABS.map((t) => {
        const active = props.tab === t.key;
        const badge = props.badges?.[t.key];
        return (
          <button
            key={t.key}
            type="button"
            className={`m-tab ${active ? "m-tab-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => props.onTab(t.key)}
          >
            <span className="relative">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6}
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {t.icon}
              </svg>
              {badge ? <span className="m-badge">{badge > 99 ? "99+" : badge}</span> : null}
            </span>
            <span className="text-[11px] leading-none">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function TopBar(props: { title: string; sub?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="m-topbar">
      {props.onBack ? (
        <button type="button" className="m-iconbtn -ml-2" onClick={props.onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}
               strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-[19px] leading-tight text-paper">{props.title}</h1>
        {props.sub ? <p className="truncate text-xs text-paper-dim/80">{props.sub}</p> : null}
      </div>
      {props.right}
    </header>
  );
}

/** A sheet that rises from the bottom; drag the handle or tap the scrim to dismiss. */
export function Sheet(props: { open: boolean; onClose: () => void; title?: string; children: ReactNode; tall?: boolean }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!props.open) setDrag(0);
  }, [props.open]);
  if (!props.open) return null;
  return (
    <div className="m-scrim" onClick={props.onClose} role="presentation">
      <section
        className={`m-sheet ${props.tall ? "m-sheet-tall" : ""}`}
        style={{ transform: `translateY(${drag}px)`, transition: start.current === null ? "transform .2s ease-out" : "none" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div
          className="m-sheet-grip"
          onPointerDown={(e) => {
            start.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
          }}
          onPointerUp={() => {
            const far = drag > 110;
            start.current = null;
            if (far) props.onClose();
            else setDrag(0);
          }}
        >
          <span />
        </div>
        {props.title ? <h2 className="px-5 pb-2 font-serif text-lg text-paper">{props.title}</h2> : null}
        <div className="m-sheet-body">{props.children}</div>
      </section>
    </div>
  );
}

export function Chip(props: { active?: boolean; onClick?: () => void; children: ReactNode; tone?: "moss" | "ochre" | "reject" }) {
  const tone = props.tone || "moss";
  return (
    <button type="button" onClick={props.onClick}
            className={`m-chip ${props.active ? `m-chip-on-${tone}` : ""}`}>
      {props.children}
    </button>
  );
}

const VERDICT_STYLE: Record<Verdict, string> = {
  keep: "bg-moss text-paper",
  reject: "bg-reject text-paper",
  unrated: "bg-ink/70 text-paper-dim",
};

export function VerdictDot(props: { verdict: Verdict }) {
  if (props.verdict === "unrated") return null;
  return (
    <span className={`absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold shadow ${VERDICT_STYLE[props.verdict]}`}>
      {props.verdict === "keep" ? "✓" : "✕"}
    </span>
  );
}

/** A grid thumbnail. Asks the server for a small copy: a phone grid of 1600px previews is 4 MB a screen. */
export function Thumb(props: { shot: Shot; onOpen: () => void; stack?: number; selected?: boolean }) {
  const { shot } = props;
  return (
    <button type="button" className={`m-thumb ${props.selected ? "ring-2 ring-ochre" : ""}`} onClick={props.onOpen}
            aria-label={shot.common_name || shot.display_name}>
      <img src={thumbUrl(shot.preview_path, 480)} alt="" loading="lazy" decoding="async" draggable={false} />
      <VerdictDot verdict={shot.verdict} />
      {shot.favorite ? <span className="absolute right-1.5 top-1.5 text-sm text-ochre drop-shadow">♥</span> : null}
      {props.stack && props.stack > 1 ? <span className="m-stack">{props.stack}</span> : null}
      {shot.stars ? <span className="absolute bottom-1 left-1.5 text-[10px] tracking-tighter text-ochre drop-shadow">{"★".repeat(shot.stars)}</span> : null}
    </button>
  );
}

export function Stars(props: { value: number; onChange: (n: number) => void; size?: "lg" | "md" }) {
  const cls = props.size === "lg" ? "h-11 w-11 text-2xl" : "h-10 w-9 text-xl";
  return (
    <div className="flex items-center" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={props.value === n}
                className={`${cls} grid place-items-center ${n <= props.value ? "text-ochre" : "text-bark"}`}
                onClick={() => props.onChange(props.value === n ? 0 : n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}>
          ★
        </button>
      ))}
    </div>
  );
}

export function Empty(props: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center px-8 py-16 text-center">
      <div className="max-w-xs">
        <p className="font-serif text-xl text-paper">{props.title}</p>
        {props.children ? <p className="mt-2 text-sm leading-relaxed text-paper-dim/80">{props.children}</p> : null}
        {props.action ? <div className="mt-5">{props.action}</div> : null}
      </div>
    </div>
  );
}

export function Toast(props: { message: string; tone?: "info" | "error"; onClose: () => void }) {
  useEffect(() => {
    if (!props.message) return;
    const t = setTimeout(props.onClose, props.tone === "error" ? 7000 : 3200);
    return () => clearTimeout(t);
  }, [props.message, props.tone, props.onClose]);
  if (!props.message) return null;
  return (
    <div className={`m-toast ${props.tone === "error" ? "m-toast-error" : ""}`} role="status" onClick={props.onClose}>
      {props.message}
    </div>
  );
}

export function Row(props: { label: string; hint?: string; onClick?: () => void; right?: ReactNode; danger?: boolean }) {
  const Tag = props.onClick ? "button" : "div";
  return (
    <Tag type={props.onClick ? "button" : undefined} onClick={props.onClick} className="m-row">
      <span className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[15px] ${props.danger ? "text-reject" : "text-paper"}`}>{props.label}</span>
        {props.hint ? <span className="mt-0.5 block text-xs leading-snug text-paper-dim/75">{props.hint}</span> : null}
      </span>
      {props.right ?? (props.onClick ? <span className="text-paper-dim/50">›</span> : null)}
    </Tag>
  );
}

export function Meter(props: { value: number | null; label: string }) {
  if (props.value == null) return null;
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <div className="flex items-center gap-2 text-xs text-paper-dim">
      <span className="w-24 shrink-0">{props.label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bark">
        <span className={`block h-full rounded-full ${v >= 0.8 ? "bg-moss" : v >= 0.6 ? "bg-ochre" : "bg-reject"}`} style={{ width: `${v * 100}%` }} />
      </span>
      <span className="w-9 text-right tabular-nums">{Math.round(v * 100)}%</span>
    </div>
  );
}
