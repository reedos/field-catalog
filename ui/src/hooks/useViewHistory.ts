import { useEffect, useRef, useState } from "react";
import type { ViewState } from "../types";
import {
  emptyNav,
  historyLabel,
  record as recordNav,
  replaceCurrent,
  type Nav,
} from "../lib/historyCore";

const STORE_ENTRIES = "fc_history";
const STORE_INDEX = "fc_historyIndex";

/**
 * View-state history with sessionStorage persistence.
 *
 * `current` is the composite view state as of this render; `apply` writes a
 * historical state back into the app. Call `record(partial)` at navigation
 * points with the fields that changed -- it merges over the current state, so
 * call sites only name what they touched.
 */
export function useViewHistory(current: ViewState, apply: (s: ViewState) => void) {
  const [nav, setNav] = useState<Nav>(() => {
    try {
      const h = sessionStorage.getItem(STORE_ENTRIES);
      const i = sessionStorage.getItem(STORE_INDEX);
      if (h && i) {
        const entries = JSON.parse(h) as ViewState[];
        const index = parseInt(i, 10);
        if (Array.isArray(entries) && index >= 0 && index < entries.length) {
          return { entries, index };
        }
      }
    } catch {
      // fall through to empty
    }
    return emptyNav();
  });

  const currentRef = useRef(current);
  currentRef.current = current;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Restore the stored position once on mount, or seed with the initial state.
  // Both arms are idempotent, so a StrictMode double-mount is harmless.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (nav.index >= 0) applyRef.current(nav.entries[nav.index]);
    else setNav((n) => recordNav(n, currentRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_ENTRIES, JSON.stringify(nav.entries));
      sessionStorage.setItem(STORE_INDEX, String(nav.index));
    } catch {
      // storage full or unavailable; history still works in memory
    }
  }, [nav]);

  function record(partial?: Partial<ViewState>) {
    setNav((n) => recordNav(n, { ...currentRef.current, ...partial }));
  }

  function jumpTo(idx: number) {
    if (idx < 0 || idx >= nav.entries.length || idx === nav.index) return;
    const committed = replaceCurrent(nav, currentRef.current);
    setNav({ ...committed, index: idx });
    apply(committed.entries[idx]);
  }

  return {
    entries: nav.entries,
    index: nav.index,
    canGoBack: nav.index > 0,
    canGoForward: nav.index >= 0 && nav.index < nav.entries.length - 1,
    backLabel: nav.index > 0 ? historyLabel(nav.entries[nav.index - 1]) : undefined,
    record,
    goBack: () => jumpTo(nav.index - 1),
    goForward: () => jumpTo(nav.index + 1),
    goTo: jumpTo,
  };
}
