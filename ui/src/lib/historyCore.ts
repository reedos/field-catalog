import type { ViewState } from "../types";

/**
 * Browser-style navigation history: `entries[index]` is always the state the
 * user is looking at. Recording a new state drops any forward tail; going back
 * or forward just moves the index. The old implementation pushed the state
 * being *left* and let the index drift past the end of the array, which is why
 * the Forward button never enabled.
 */
export type Nav = { entries: ViewState[]; index: number };

export const HISTORY_CAP = 16;

export function emptyNav(): Nav {
  return { entries: [], index: -1 };
}

export function sameState(a: ViewState, b: ViewState): boolean {
  return (
    a.view === b.view &&
    a.search === b.search &&
    a.animal === b.animal &&
    a.location === b.location &&
    a.starsMin === b.starsMin &&
    a.verdict === b.verdict &&
    a.needsId === b.needsId &&
    a.sort === b.sort
  );
}

/** Commit `state` as the new current entry, dropping any forward tail. */
export function record(nav: Nav, state: ViewState): Nav {
  const cur = nav.entries[nav.index];
  if (cur && sameState(cur, state)) return nav;
  const entries = [...nav.entries.slice(0, nav.index + 1), state].slice(-HISTORY_CAP);
  return { entries, index: entries.length - 1 };
}

/**
 * Overwrite the current entry with live drift -- state the user changed without
 * a recorded navigation (typing in search, mostly) -- so Forward returns to
 * what they were actually looking at.
 */
export function replaceCurrent(nav: Nav, state: ViewState): Nav {
  if (nav.index < 0) return record(nav, state);
  const entries = [...nav.entries];
  entries[nav.index] = state;
  return { entries, index: nav.index };
}

export function historyLabel(s: ViewState): string {
  const names: Record<string, string> = {
    library: "Library",
    map: "Map",
    bursts: "Bursts",
    life: "Life list",
    settings: "Settings",
  };
  const bits = [names[s.view] || s.view];
  if (s.search) bits.push(s.search);
  else if (s.animal) bits.push(s.animal);
  else if (s.location) bits.push(s.location);
  return bits.join(" · ");
}
