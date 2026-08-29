import type { Shot } from "../types";

/**
 * Which frame best represents a set of shots — used wherever the app has to
 * show one photograph standing in for several: a life list plate, a species
 * row in a map popup.
 *
 * The order follows how much of it you actually said. An explicit life list
 * pick is a direct instruction. A favourite is a deliberate mark. Stars are a
 * rating. A keep verdict is a decision. Sharpness is the only purely automatic
 * signal, so it breaks ties last — it is a measurement, not an opinion, and a
 * tack-sharp frame of a bird's back beats nothing.
 */
export function scoreShot(s: Shot): number[] {
  return [
    s.life_list_pick ? 1 : 0,
    s.favorite ? 1 : 0,
    s.stars || 0,
    s.verdict === "keep" ? 1 : 0,
    s.sharpness ?? -1,
  ];
}

/** True when `a` should be preferred over `b`. */
export function betterShot(a: Shot, b: Shot): boolean {
  const sa = scoreShot(a);
  const sb = scoreShot(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i];
  }
  return false;
}

/** The best of a non-empty list. */
export function bestShot(shots: Shot[]): Shot {
  return shots.reduce((best, s) => (betterShot(s, best) ? s : best), shots[0]);
}

/** How the app groups shots into species. Scientific name wins when present. */
export function speciesKey(s: Shot): string {
  return (s.scientific_name || s.common_name || "").trim();
}
