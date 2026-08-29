import { useMemo, useState } from "react";
import type { Shot } from "../types";
import { animalLabel, fmtDay } from "../lib/format";
import { previewUrl } from "../lib/preview";

type Species = {
  key: string;
  common: string;
  scientific: string;
  type: string | null;
  count: number;
  firstSeen: string; // capture day, YYYY-MM-DD ("" when unknown)
  best: Shot;
  shots: Shot[];
  chosen: boolean; // the plate was picked by hand rather than ranked
};

/**
 * The life list as the reward for the culling work: one plate per species,
 * showing the best frame you have of it, when you first saw it, and how many
 * times since. Plate numbers run in first-seen order -- the order the list
 * was earned.
 *
 * The automatic ranking is a starting point, not a verdict. Sharpness is a
 * weak proxy for a good photograph, so every plate can be overruled: choose
 * the frame, correct the name, or drop the species off the list entirely.
 */
export default function LifeList(props: {
  shots: Shot[];
  onOpenSpecies: (name: string) => void;
  onOpenShot: (id: string) => void;
  onPick: (id: string, clear?: boolean) => void;
  onClearSpecies: (key: string, common: string) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);

  const species = useMemo(() => {
    const map = new Map<string, Species>();
    for (const s of props.shots) {
      const key = (s.scientific_name || s.common_name || "").trim();
      if (!key) continue;
      const day = (s.captured_at || "").slice(0, 10);
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          key,
          common: s.common_name || key,
          scientific: s.scientific_name || "",
          type: s.animal_type,
          count: 1,
          firstSeen: day,
          best: s,
          shots: [s],
          chosen: !!s.life_list_pick,
        });
        continue;
      }
      cur.count += 1;
      cur.shots.push(s);
      if (day && (!cur.firstSeen || day < cur.firstSeen)) cur.firstSeen = day;
      // An explicit pick wins outright; otherwise fall back to the ranking.
      if (s.life_list_pick) {
        cur.best = s;
        cur.chosen = true;
      } else if (!cur.chosen && better(s, cur.best)) {
        cur.best = s;
      }
    }
    const all = [...map.values()];
    for (const sp of all) {
      sp.shots.sort((a, b) => (a.captured_at || "").localeCompare(b.captured_at || ""));
    }
    // Plate numbers are earned in first-seen order; display stays alphabetical.
    const plateOrder = [...all].sort(
      (a, b) => (a.firstSeen || "9999").localeCompare(b.firstSeen || "9999") || a.common.localeCompare(b.common),
    );
    const plateNo = new Map(plateOrder.map((sp, i) => [sp.key, i + 1]));
    all.sort((a, b) => a.common.localeCompare(b.common));
    return { all, plateNo };
  }, [props.shots]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sp of species.all) {
      const t = sp.type || "other";
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [species]);

  if (!species.all.length) {
    return (
      <div className="p-8 font-serif text-paper-dim">
        No identified species yet. Identify a shot and it starts your life list.
      </div>
    );
  }

  const identified = species.all.reduce((a, sp) => a + sp.count, 0);

  return (
    <div className="fc-scroll h-full p-8">
      <div className="mb-6 flex items-baseline gap-4 border-b border-bark pb-3">
        <h2 className="font-serif text-2xl text-paper">
          Life list <span className="text-ochre">·</span> {species.all.length} species
        </h2>
        <div className="text-xs text-paper-dim">
          {identified} identified shots
          {typeCounts.map(([t, n]) => (
            <span key={t}> · {n} {animalLabel(t)}</span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "28px",
        }}
      >
        {species.all.map((sp) => {
          const src = previewUrl(sp.best.preview_path);
          const open = picking === sp.key;
          return (
            <div key={sp.key} className="group flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => props.onOpenSpecies(sp.common)}
                className="border border-bark bg-charcoal p-1.5 text-left transition-colors duration-150 group-hover:border-ochre/70"
                title={`Open ${sp.common} in the library`}
              >
                <div className="relative aspect-[3/2] overflow-hidden bg-ink">
                  {src ? (
                    <img
                      src={src}
                      alt={sp.common}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      style={{ imageOrientation: "from-image" }}
                    />
                  ) : null}
                  {sp.chosen ? (
                    <span
                      className="absolute right-1.5 top-1.5 rounded-sm bg-ochre px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink"
                      title="You chose this frame"
                    >
                      chosen
                    </span>
                  ) : null}
                </div>
              </button>

              <div className="flex flex-col items-center gap-0.5 text-center">
                <div className="text-[10px] uppercase tracking-[0.24em] text-ochre/80">
                  Pl.&nbsp;{species.plateNo.get(sp.key)}
                  {sp.firstSeen ? <span className="text-paper-dim/70"> · first seen {fmtDay(sp.firstSeen)}</span> : null}
                </div>
                <div className="font-serif text-lg text-paper">{sp.common}</div>
                <div className="text-xs italic text-paper-dim">
                  {sp.scientific || " "}
                  <span className="not-italic">
                    {" "}· {sp.count} shot{sp.count === 1 ? "" : "s"}
                    {sp.type ? ` · ${animalLabel(sp.type)}` : ""}
                  </span>
                </div>
              </div>

              {/* Curation, quiet until the plate is hovered or the picker is open. */}
              <div
                className={`flex justify-center gap-2 text-[11px] transition-opacity duration-150 ${
                  open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                }`}
              >
                <button
                  type="button"
                  className="text-paper-dim transition-colors hover:text-moss"
                  onClick={() => setPicking(open ? null : sp.key)}
                >
                  {open ? "Done" : "Change photo"}
                </button>
                <span className="text-bark">·</span>
                <button
                  type="button"
                  className="text-paper-dim transition-colors hover:text-moss"
                  onClick={() => props.onOpenShot(sp.best.id)}
                  title="Open this frame to correct its name"
                >
                  Fix name
                </button>
                <span className="text-bark">·</span>
                <button
                  type="button"
                  className="text-paper-dim transition-colors hover:text-reject"
                  onClick={() => props.onClearSpecies(sp.key, sp.common)}
                  title="Clear this identification and drop it off the life list"
                >
                  Remove
                </button>
              </div>

              {open ? (
                <div className="rounded-md border border-bark bg-charcoal/60 p-2">
                  <div className="mb-1.5 text-[11px] text-paper-dim">
                    {sp.count === 1
                      ? "Only one frame of this species."
                      : "Choose the frame for this plate:"}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sp.shots.map((shot) => {
                      const thumb = previewUrl(shot.preview_path);
                      const isBest = shot.id === sp.best.id;
                      return (
                        <button
                          type="button"
                          key={shot.id}
                          onClick={() => {
                            props.onPick(shot.id);
                            setPicking(null);
                          }}
                          className={`h-14 w-20 overflow-hidden rounded-sm transition-shadow ${
                            isBest ? "ring-2 ring-ochre" : "ring-1 ring-bark hover:ring-moss"
                          }`}
                          title={shot.display_name || shot.id}
                        >
                          {thumb ? (
                            <img src={thumb} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="block h-full w-full bg-bark" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {sp.chosen ? (
                    <button
                      type="button"
                      className="mt-2 text-[11px] text-paper-dim transition-colors hover:text-paper"
                      onClick={() => {
                        props.onPick(sp.best.id, true);
                        setPicking(null);
                      }}
                    >
                      Back to automatic
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The frame that represents a species when you have not chosen one. */
function better(a: Shot, b: Shot): boolean {
  const keepA = a.verdict === "keep" ? 1 : 0;
  const keepB = b.verdict === "keep" ? 1 : 0;
  if (keepA !== keepB) return keepA > keepB;
  if ((a.stars || 0) !== (b.stars || 0)) return (a.stars || 0) > (b.stars || 0);
  return (a.sharpness ?? -1) > (b.sharpness ?? -1);
}
