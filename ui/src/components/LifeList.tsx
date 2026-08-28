import { useMemo } from "react";
import type { Shot } from "../types";
import { fmtDay } from "../lib/format";
import { previewUrl } from "../lib/preview";

type Species = {
  key: string;
  common: string;
  scientific: string;
  type: string | null;
  count: number;
  firstSeen: string; // capture day, YYYY-MM-DD ("" when unknown)
  best: Shot;
};

/**
 * The life list as the reward for the culling work: one plate per species,
 * showing the best frame you have of it, when you first saw it, and how many
 * times since. Plate numbers run in first-seen order -- the order the list
 * was earned. The plate styling borrows the Museum Plate direction from the
 * design canvas, kept inside the app's dark field-journal theme.
 */
export default function LifeList(props: {
  shots: Shot[];
  onOpenSpecies: (name: string) => void;
}) {
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
        });
        continue;
      }
      cur.count += 1;
      if (day && (!cur.firstSeen || day < cur.firstSeen)) cur.firstSeen = day;
      if (better(s, cur.best)) cur.best = s;
    }
    const all = [...map.values()];
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
            <span key={t}> · {n} {t}</span>
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
          return (
            <button
              type="button"
              key={sp.key}
              onClick={() => props.onOpenSpecies(sp.common)}
              className="group flex flex-col gap-2.5 text-left"
              title={`Open ${sp.common} in the library`}
            >
              <div className="border border-bark bg-charcoal p-1.5 transition-colors duration-150 group-hover:border-ochre/70">
                <div className="aspect-[3/2] overflow-hidden bg-ink">
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
                </div>
              </div>
              <div className="flex flex-col items-center gap-0.5 text-center">
                <div className="text-[10px] uppercase tracking-[0.24em] text-ochre/80">
                  Pl.&nbsp;{species.plateNo.get(sp.key)}
                  {sp.firstSeen ? <span className="text-paper-dim/70"> · first seen {fmtDay(sp.firstSeen)}</span> : null}
                </div>
                <div className="font-serif text-lg text-paper">{sp.common}</div>
                <div className="text-xs italic text-paper-dim">
                  {sp.scientific || " "}
                  <span className="not-italic"> · {sp.count} shot{sp.count === 1 ? "" : "s"}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The frame that represents a species: keeps first, then stars, then sharpness. */
function better(a: Shot, b: Shot): boolean {
  const keepA = a.verdict === "keep" ? 1 : 0;
  const keepB = b.verdict === "keep" ? 1 : 0;
  if (keepA !== keepB) return keepA > keepB;
  if ((a.stars || 0) !== (b.stars || 0)) return (a.stars || 0) > (b.stars || 0);
  return (a.sharpness ?? -1) > (b.sharpness ?? -1);
}
