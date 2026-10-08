import { useMemo, useState } from "react";
import type { Shot } from "../types";
import { thumbUrl } from "../lib/preview";
import { animalLabel, fmtDay } from "../lib/format";
import { betterShot } from "../lib/ranking";
import { byShootingOrder, useStore } from "./store";
import { Chip, Empty, Sheet, TopBar } from "./ui";

type Species = {
  key: string;
  common: string;
  scientific: string;
  type: string | null;
  firstSeen: string;
  best: Shot;
  recommended: Shot;
  shots: Shot[];
  chosen: boolean;
};

/**
 * One plate per species, numbered in the order you first saw them. The same
 * rules as the desk: a frame you picked by hand wins outright, otherwise the
 * ranking chooses, and you can always overrule it.
 */
export function LifeListScreen(props: { onOpen: (ids: string[], id: string) => void }) {
  const store = useStore();
  const [type, setType] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  const { all, plateNo } = useMemo(() => {
    const map = new Map<string, Species>();
    for (const s of store.shots) {
      const key = (s.scientific_name || s.common_name || "").trim();
      if (!key) continue;
      const day = (s.captured_at || "").slice(0, 10);
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { key, common: s.common_name || key, scientific: s.scientific_name || "", type: s.animal_type,
                       firstSeen: day, best: s, recommended: s, shots: [s], chosen: !!s.life_list_pick });
        continue;
      }
      cur.shots.push(s);
      if (day && (!cur.firstSeen || day < cur.firstSeen)) cur.firstSeen = day;
      if (betterShot(s, cur.recommended)) cur.recommended = s;
      if (s.life_list_pick) { cur.best = s; cur.chosen = true; }
      else if (!cur.chosen && betterShot(s, cur.best)) cur.best = s;
    }
    const list = [...map.values()];
    for (const sp of list) if (!sp.chosen) sp.best = sp.recommended;
    const order = [...list].sort((a, b) => (a.firstSeen || "9999").localeCompare(b.firstSeen || "9999") || a.common.localeCompare(b.common));
    const numbers = new Map(order.map((sp, i) => [sp.key, i + 1]));
    list.sort((a, b) => (numbers.get(b.key) || 0) - (numbers.get(a.key) || 0));      // newest lifer first
    return { all: list, plateNo: numbers };
  }, [store.shots]);

  const types = useMemo(() => [...new Set(all.map((s) => s.type).filter(Boolean))] as string[], [all]);
  const shown = type ? all.filter((s) => s.type === type) : all;
  const current = picking ? all.find((s) => s.key === picking) : undefined;

  if (!all.length) {
    return (
      <div className="m-screen">
        <TopBar title="Life list" />
        <Empty title="No species yet">Name a bird in any frame and it starts a plate here.</Empty>
      </div>
    );
  }

  return (
    <div className="m-screen">
      <TopBar title="Life list" sub={`${all.length} species`} />
      {types.length > 1 ? (
        <div className="flex flex-none gap-2 overflow-x-auto border-b border-bark/50 px-4 py-2.5 [scrollbar-width:none]">
          <Chip active={!type} onClick={() => setType("")}>All</Chip>
          {types.map((t) => <Chip key={t} active={type === t} onClick={() => setType(t)}>{animalLabel(t)}</Chip>)}
        </div>
      ) : null}
      <div className="m-scroll">
        <ul className="grid grid-cols-2 gap-3 p-4">
          {shown.map((sp) => (
            <li key={sp.key} className="min-w-0">
              <button type="button" className="block w-full text-left active:opacity-80" onClick={() => setPicking(sp.key)}>
                <span className="relative block aspect-[4/5] overflow-hidden rounded-lg bg-charcoal">
                  <img src={thumbUrl(sp.best.preview_path, 480)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute left-2 top-2 rounded bg-ink/75 px-1.5 font-serif text-xs text-ochre">No. {plateNo.get(sp.key)}</span>
                  {sp.chosen ? <span className="absolute right-2 top-2 rounded bg-ink/75 px-1.5 text-[10px] text-paper-dim">your pick</span> : null}
                </span>
                <span className="mt-1.5 block truncate font-serif text-[15px] text-paper">{sp.common}</span>
                <span className="block truncate text-xs italic text-paper-dim/70">{sp.scientific || " "}</span>
                <span className="block truncate text-[11px] text-paper-dim/60">
                  {sp.firstSeen ? `First ${fmtDay(sp.firstSeen)}` : "Undated"} · {sp.shots.length} frame{sp.shots.length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Sheet open={!!current} onClose={() => setPicking(null)} title={current?.common} tall>
        {current ? (
          <>
            <p className="-mt-1 text-xs text-paper-dim/75">
              {current.scientific ? <span className="italic">{current.scientific} · </span> : null}
              Plate No. {plateNo.get(current.key)} · {current.shots.length} frames
            </p>
            <p className="mt-3 text-sm leading-relaxed text-paper-dim">
              Tap a frame to make it stand for the species. {current.chosen ? "You chose the current one." : "The current one was chosen by ranking."}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {[...current.shots].sort(byShootingOrder).map((s) => (
                <button key={s.id} type="button"
                        className={`relative aspect-square overflow-hidden rounded-md ${s.id === current.best.id ? "ring-2 ring-ochre" : ""}`}
                        onClick={() => store.setLifeListPick(s.id)} aria-label="Use this frame">
                  <img src={thumbUrl(s.preview_path, 320)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {s.id === current.recommended.id ? <span className="absolute inset-x-0 bottom-0 bg-ink/75 text-center text-[9px] leading-4 text-paper-dim">ranked first</span> : null}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <button type="button" className="m-btn m-btn-block"
                      onClick={() => { const ids = [...current.shots].sort(byShootingOrder).map((s) => s.id); setPicking(null); props.onOpen(ids, current.best.id); }}>
                Look through all {current.shots.length}
              </button>
              {current.chosen ? (
                <button type="button" className="m-btn m-btn-block" onClick={() => store.setLifeListPick(current.best.id, true)}>
                  Go back to the automatic pick
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
