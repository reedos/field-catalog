import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnimalType, Shot, Verdict } from "../types";
import { COLOR_CYCLE } from "../types";
import { api } from "../lib/worker";
import { normalizeShot, useShots } from "../hooks/useShots";
import { useIdentify } from "../hooks/useIdentify";
import { captureDay } from "../lib/format";

/**
 * Everything the phone screens share. It is the desktop's own shot store and
 * identify hook underneath -- the same optimistic writes, the same undo stack --
 * so a verdict made on the phone behaves exactly like one made at the desk.
 */

export interface Outing {
  day: string;
  count: number;
  unrated: number;
  keep: number;
  reject: number;
  /** frames from this day with no place at all */
  unplaced: number;
  places: string[];
  cover: Shot;
}

/** Shooting order: EXIF time is whole seconds, so the filename sequence breaks ties within a burst. */
export function byShootingOrder(a: Shot, b: Shot): number {
  return (
    (a.captured_at || "").localeCompare(b.captured_at || "") ||
    (a.display_name || "").localeCompare(b.display_name || "", undefined, { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

function useStoreValue() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setErrorText] = useState("");
  const [notice, setNotice] = useState("");
  const [library, setLibrary] = useState("");

  const setError = useCallback((s: string) => setErrorText(s), []);
  const fail = useCallback((e: unknown) => setErrorText(e instanceof Error ? e.message : String(e)), []);

  const store = useShots(fail);
  const { shots, shotsById, reload, patchShot, optimistic, recordVerdictUndo, undoVerdicts } = store;

  const identify = useIdentify({ patchShot, setSelectedId: () => {}, setBusy, setError });

  useEffect(() => {
    (async () => {
      try {
        setBusy("Opening library…");
        const paths = await api.paths();
        setLibrary(paths.library);
        await api.init();
        await identify.loadKeyStatus();
        await reload();
        setReady(true);
      } catch (e) {
        fail(e);
      } finally {
        setBusy("");
      }
    })();
    // once, at start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outings = useMemo<Outing[]>(() => {
    const byDay = new Map<string, Shot[]>();
    for (const s of shots) {
      const d = captureDay(s.captured_at) || "";
      const arr = byDay.get(d);
      if (arr) arr.push(s);
      else byDay.set(d, [s]);
    }
    return [...byDay.entries()]
      .map(([day, list]) => {
        const places = [...new Set(list.map((s) => s.location).filter(Boolean))];
        const keepers = list.filter((s) => s.verdict === "keep");
        const pool = keepers.length ? keepers : list;
        const cover = pool.reduce((best, s) => ((s.sharpness ?? -1) > (best.sharpness ?? -1) ? s : best), pool[0]);
        return {
          day,
          count: list.length,
          unrated: list.filter((s) => s.verdict === "unrated").length,
          keep: keepers.length,
          reject: list.filter((s) => s.verdict === "reject").length,
          unplaced: list.filter((s) => !s.location).length,
          places,
          cover,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [shots]);

  const locations = useMemo(() => [...new Set(shots.map((s) => s.location).filter(Boolean))].sort(), [shots]);

  const burstSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const s of shots) if (s.burst_id) sizes.set(s.burst_id, (sizes.get(s.burst_id) || 0) + 1);
    return sizes;
  }, [shots]);

  const fieldMarkOptions = useMemo(() => {
    const set = new Set<string>(store.catalogFieldMarks);
    for (const s of shots) for (const m of s.field_marks || []) if (m) set.add(m);
    return [...set].sort();
  }, [shots, store.catalogFieldMarks]);

  // --- writes: the desktop's own, one for one ---

  function setVerdict(id: string, v: Verdict) {
    recordVerdictUndo([{ id, next: v }]);
    void optimistic(new Map([[id, { verdict: v }]]), () => api.setVerdict(id, v));
  }

  function setVerdicts(pairs: Array<{ id: string; verdict: Verdict }>) {
    if (!pairs.length) return;
    recordVerdictUndo(pairs.map((p) => ({ id: p.id, next: p.verdict })));
    const patches = new Map<string, Partial<Shot>>();
    for (const p of pairs) patches.set(p.id, { verdict: p.verdict });
    void optimistic(patches, () => Promise.all(pairs.map((p) => api.setVerdict(p.id, p.verdict))));
  }

  function undo(): number {
    const n = undoVerdicts();
    if (n) setNotice(n === 1 ? "Undone" : `Undone · ${n} frames`);
    return n;
  }

  function toggleFavorite(id: string) {
    const shot = shotsById.get(id);
    if (!shot) return;
    void optimistic(new Map([[id, { favorite: !shot.favorite }]]), async () => {
      const res = await api.set(id, { favorite: shot.favorite ? 0 : 1 });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    });
  }

  function setStars(id: string, n: number) {
    void optimistic(new Map([[id, { stars: n }]]), async () => {
      const res = await api.set(id, { stars: n });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    });
  }

  function cycleColor(id: string) {
    const shot = shotsById.get(id);
    if (!shot) return;
    const i = COLOR_CYCLE.indexOf((shot.color || "") as (typeof COLOR_CYCLE)[number]);
    const next = COLOR_CYCLE[(i + 1) % COLOR_CYCLE.length] || "none";
    void optimistic(new Map([[id, { color: next === "none" ? null : next }]]), async () => {
      const res = await api.set(id, { color: next });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    });
  }

  function setAnimalType(id: string, t: AnimalType) {
    void optimistic(new Map([[id, { animal_type: t }]]), async () => {
      const res = await api.set(id, { animal_type: t });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    });
  }

  async function saveIdentity(id: string, common: string, scientific: string) {
    try {
      const res = await api.identify(id, { commonName: common, scientificName: scientific });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
      setNotice("Species saved");
    } catch (e) {
      fail(e);
    }
  }

  async function clearIdentity(id: string) {
    try {
      await api.clearIdentity({ id });
      await reload();
      setNotice("Identification cleared");
    } catch (e) {
      fail(e);
    }
  }

  async function saveFieldMarks(id: string, marks: string[]) {
    try {
      const res = await api.set(id, { field_marks: marks.join(",") });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    } catch (e) {
      fail(e);
    }
  }

  async function setLocationLabel(id: string, label: string) {
    try {
      const res = await api.setLocation(id, label);
      if (res.shot) patchShot(id, normalizeShot(res.shot));
      setNotice(label ? `Place set: ${label}` : "Place cleared");
    } catch (e) {
      fail(e);
    }
  }

  /** Label every shot taken on one day. Returns how many were changed. */
  async function labelDay(day: string, label: string): Promise<number> {
    try {
      const res = await api.setLocationByDate(day, label);
      await reload();
      if (res.geocode_error) setErrorText(`Labelled, but the place could not be looked up: ${res.geocode_error}`);
      else setNotice(`${res.count} shots labelled ${label}`);
      return res.count;
    } catch (e) {
      fail(e);
      return 0;
    }
  }

  async function setLifeListPick(id: string, clear = false) {
    try {
      await api.lifeListPick(id, clear);
      await reload();
      setNotice(clear ? "Back to the automatic pick" : "This frame now stands for the species");
    } catch (e) {
      fail(e);
    }
  }

  return {
    ready, busy, setBusy, error, setError, fail, notice, setNotice, library,
    shots, shotsById, reload, outings, locations, burstSizes, fieldMarkOptions,
    identify,
    setVerdict, setVerdicts, undo, toggleFavorite, setStars, cycleColor, setAnimalType,
    saveIdentity, clearIdentity, saveFieldMarks, setLocationLabel, labelDay, setLifeListPick,
  };
}

export type Store = ReturnType<typeof useStoreValue>;

const Ctx = createContext<Store | null>(null);

export function StoreProvider(props: { children: ReactNode }) {
  const value = useStoreValue();
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
