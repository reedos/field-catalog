import { useCallback, useMemo, useRef, useState } from "react";
import type { Shot, Verdict } from "../types";
import { api } from "../lib/worker";

/** Fill in the fields the worker may omit so the UI never branches on undefined. */
export function normalizeShot(s: Shot): Shot {
  return {
    ...s,
    field_marks: Array.isArray(s.field_marks) ? s.field_marks : [],
    similar_species: Array.isArray(s.similar_species) ? s.similar_species : [],
    notes: s.notes || "",
    confidence: s.confidence ?? null,
    gps_from_file: !!s.gps_from_file,
    preview_width: s.preview_width ?? null,
    preview_height: s.preview_height ?? null,
  };
}

/**
 * The shot store: the loaded catalog, single-pass patching, and optimistic
 * writes that put the previous values back if the worker rejects them.
 */
export function useShots(onError: (e: unknown) => void) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [catalogFieldMarks, setCatalogFieldMarks] = useState<string[]>([]);

  const shotsById = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const shotsByIdRef = useRef(shotsById);
  shotsByIdRef.current = shotsById;

  // The full list is ~150ms and 5.5MB at 4k shots, and grows linearly. The
  // newest page paints first so the grid is usable immediately; the rest
  // arrives behind it, which keeps filtering and sorting client-side over the
  // whole library rather than paginating the UI.
  const FIRST_PAGE = 400;

  const reload = useCallback(async () => {
    const first = await api.list(FIRST_PAGE);
    setShots((first.shots || []).map(normalizeShot));
    // Suggestion vocabulary is a nice-to-have; never fail a reload over it.
    api.fieldMarks()
      .then((res) => setCatalogFieldMarks(res.marks || []))
      .catch(() => {});
    if (!first.truncated) return;
    const all = await api.list();
    setShots((all.shots || []).map(normalizeShot));
  }, []);

  function patchShot(id: string, partial: Partial<Shot>) {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...partial } : s)));
  }

  /** Apply one patch per id in a single pass, instead of cloning the list per id. */
  function patchShots(patches: Map<string, Partial<Shot>>) {
    if (!patches.size) return;
    setShots((prev) => prev.map((s) => (patches.has(s.id) ? { ...s, ...patches.get(s.id)! } : s)));
  }

  /** Optimistic write that puts the previous values back if the worker rejects it. */
  function optimistic(patches: Map<string, Partial<Shot>>, call: () => Promise<unknown>) {
    const rollback = new Map<string, Partial<Shot>>();
    for (const [id, partial] of patches) {
      const cur = shotsByIdRef.current.get(id);
      if (!cur) continue;
      rollback.set(
        id,
        Object.fromEntries(Object.keys(partial).map((k) => [k, (cur as unknown as Record<string, unknown>)[k]])),
      );
    }
    patchShots(patches);
    return call().catch((e) => {
      patchShots(rollback);
      onError(e);
    });
  }

  // Verdict undo: each entry is one user gesture -- a single cull keystroke,
  // or a whole keep-this/keep-pick group -- restored together by Ctrl+Z.
  const undoStack = useRef<Array<Array<{ id: string; verdict: Verdict }>>>([]);

  function recordVerdictUndo(changes: Array<{ id: string; next: Verdict }>) {
    const entry = changes
      .map(({ id, next }) => {
        const cur = shotsByIdRef.current.get(id);
        return cur && cur.verdict !== next ? { id, verdict: cur.verdict } : null;
      })
      .filter((e): e is { id: string; verdict: Verdict } => e !== null);
    if (!entry.length) return;
    undoStack.current.push(entry);
    if (undoStack.current.length > 50) undoStack.current.shift();
  }

  /** Restore the most recent verdict gesture. Returns how many shots reverted. */
  function undoVerdicts(): number {
    const entry = undoStack.current.pop();
    if (!entry) return 0;
    const patches = new Map(entry.map((e) => [e.id, { verdict: e.verdict }]));
    patchShots(patches);
    for (const e of entry) {
      api.setVerdict(e.id, e.verdict).catch(onError);
    }
    return entry.length;
  }

  return {
    shots,
    setShots,
    shotsById,
    catalogFieldMarks,
    reload,
    patchShot,
    patchShots,
    optimistic,
    recordVerdictUndo,
    undoVerdicts,
  };
}
