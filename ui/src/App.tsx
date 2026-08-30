import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import Bursts from "./components/Bursts";
import CompareView from "./components/CompareView";
import Slideshow from "./components/Slideshow";
import AuditLog from "./components/AuditLog";
import Detail from "./components/Detail";
import DiskDialog from "./components/DiskDialog";
import Filters from "./components/Filters";
import Grid, { type BurstMeta } from "./components/Grid";
import LifeList from "./components/LifeList";
import MapView from "./components/MapView";
import Settings from "./components/Settings";
import Toolbar from "./components/Toolbar";
import ShortcutsOverlay from "./components/ShortcutsOverlay";
import CommandPalette from "./components/CommandPalette";
import BulkLocationModal from "./components/BulkLocationModal";
import { fmtBytes } from "./lib/format";
import { isTypingTarget, loadKeys, matches, saveKeys } from "./lib/keys";
import { isTauri, previewUrl } from "./lib/preview";
import { api, onWorkerProgress } from "./lib/worker";
import { useViewHistory } from "./hooks/useViewHistory";
import { normalizeShot, useShots } from "./hooks/useShots";
import { useDiskFlow } from "./hooks/useDiskFlow";
import { useIdentify } from "./hooks/useIdentify";
import {
  COLOR_CYCLE,
  type AnimalType,
  type BurstPick,
  type Keymap,
  type Shot,
  type SortKey,
  type Verdict,
  type View,
  type ViewState,
} from "./types";

export default function App() {
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Plate order, as the life list currently shows it. Kept here so the panel's
  // next/previous follows the plates on screen instead of the library behind
  // them. Same contents means same array, so this cannot loop.
  const [lifePlateIds, setLifePlateIds] = useState<string[]>([]);
  const [detail, setDetail] = useState(false);
  const [loupe, setLoupe] = useState(false);
  const [view, setView] = useState<View>("library");
  const [search, setSearch] = useState("");
  // The input stays responsive; the 3500-row filter + sort yields to it.
  const deferredSearch = useDeferredValue(search);
  const [animal, setAnimal] = useState<AnimalType | "">("");
  const [location, setLocation] = useState("");
  const [day, setDay] = useState("");
  const [starsMin, setStarsMin] = useState(0);
  const [verdict, setVerdictFilter] = useState<Verdict | "">("");
  const [needsId, setNeedsId] = useState(false);
  const [sort, setSort] = useState<SortKey>("captured_at");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  const { shots, shotsById, catalogFieldMarks, reload, patchShot, optimistic, recordVerdictUndo, undoVerdicts } =
    useShots(fail);

  const diskFlow = useDiskFlow({
    shots,
    reload,
    setBusy,
    setError,
    closeDetail: () => setDetail(false),
  });
  const { disk, setDisk } = diskFlow;

  const identify = useIdentify({ patchShot, setSelectedId, setBusy, setError });
  const [keys, setKeys] = useState<Keymap>(loadKeys);
  const [bursts, setBursts] = useState<BurstPick[]>([]);
  const [burstsResolved, setBurstsResolved] = useState(0);
  const [showResolvedBursts, setShowResolvedBursts] = useState(false);
  const [paths, setPaths] = useState({ cli: "", library: "" });
  const [audit, setAudit] = useState<{ts:string;action:string;count:number;bytes:number}[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [burstReviewId, setBurstReviewId] = useState<string | null>(null);
  const [compareBurstId, setCompareBurstId] = useState<string | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showBulkLocation, setShowBulkLocation] = useState(false);

  // The composite view state, as one value, for history and the palette.
  const currentViewState: ViewState = { view, search, animal, location, starsMin, verdict, needsId, sort, day };

  function applyState(state: ViewState) {
    setView(state.view);
    setSearch(state.search);
    setAnimal(state.animal);
    setLocation(state.location);
    setStarsMin(state.starsMin);
    setVerdictFilter(state.verdict);
    setNeedsId(state.needsId);
    setSort(state.sort);
    setDay(state.day ?? ""); // states recorded before outings existed lack it
  }

  const nav = useViewHistory(currentViewState, applyState);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onWorkerProgress((line) => setBusy(line)).then((fn) => {
      unlisten = fn;
    });
    (async () => {
      try {
        setBusy("Opening library…");
        setPaths(await api.paths());
        await api.init();
        await identify.loadKeyStatus();
        await reload();
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy("");
      }
    })();
    return () => unlisten?.();
  }, [reload]);

  const outings = useMemo(() => {
    const byDay = new Map<string, { count: number; unrated: number }>();
    for (const s of shots) {
      const d = (s.captured_at || "").slice(0, 10);
      if (!d) continue;
      const cur = byDay.get(d) || { count: 0, unrated: 0 };
      cur.count += 1;
      if (s.verdict === "unrated") cur.unrated += 1;
      byDay.set(d, cur);
    }
    return [...byDay.entries()]
      .map(([d, v]) => ({ day: d, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [shots]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const s of shots) {
      if (s.location) set.add(s.location);
    }
    return [...set].sort();
  }, [shots]);

  // Marks from the loaded shots, merged with the catalog-wide vocabulary so
  // suggestions still work when the grid is filtered down to a few frames.
  const fieldMarkOptions = useMemo(() => {
    const set = new Set<string>(catalogFieldMarks);
    for (const s of shots) {
      for (const m of s.field_marks || []) {
        if (m) set.add(m);
      }
    }
    return [...set].sort();
  }, [shots, catalogFieldMarks]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let rows = shots.filter((s) => {
      if (needsId && (s.common_name || s.scientific_name)) return false;
      if (animal && s.animal_type !== animal) return false;
      if (day && (s.captured_at || "").slice(0, 10) !== day) return false;
      if (location === "__none__" && s.location) return false;
      if (location && location !== "__none__" && s.location !== location) return false;
      if (starsMin && (s.stars || 0) < starsMin) return false;
      if (verdict && s.verdict !== verdict) return false;
      if (q) {
        const blob = [s.common_name, s.scientific_name, s.display_name, s.location, s.original_path, s.camera]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      let c = 0;
      if (va < vb) c = -1;
      else if (va > vb) c = 1;
      if (sort === "species" || sort === "location") return c || a.id.localeCompare(b.id);
      return -c || a.id.localeCompare(b.id);
    });
    return rows;
  }, [shots, animal, location, starsMin, verdict, deferredSearch, sort, needsId, day]);

  const selected = selectedId ? shotsById.get(selectedId) : undefined;
  const burstMembers = useMemo(() => {
    if (!burstReviewId) return [];
    return shots
      .filter((s) => s.burst_id === burstReviewId)
      // EXIF timestamps are whole seconds, so a 7fps burst has many frames on
      // the same instant. The filename sequence (DSC_####) is the real order;
      // the old uuid tiebreak shuffled frames within each second.
      .sort(
        (a, b) =>
          (a.captured_at || "").localeCompare(b.captured_at || "") ||
          (a.display_name || "").localeCompare(b.display_name || "", undefined, { numeric: true }) ||
          a.id.localeCompare(b.id),
      );
  }, [shots, burstReviewId]);
  const compareMembers = useMemo(() => {
    if (!compareBurstId) return [];
    return shots
      .filter((s) => s.burst_id === compareBurstId)
      .sort(
        (a, b) =>
          (a.captured_at || "").localeCompare(b.captured_at || "") ||
          (a.display_name || "").localeCompare(b.display_name || "", undefined, { numeric: true }) ||
          a.id.localeCompare(b.id),
      );
  }, [shots, compareBurstId]);

  async function onExportKeepers() {
    let dest: string | null = null;
    if (isTauri()) {
      const picked = await open({ directory: true, multiple: false, title: "Export keepers to folder" });
      dest = typeof picked === "string" ? picked : null;
    } else {
      dest = window.prompt("Export keepers to folder:") || null;
    }
    if (!dest) return;
    setBusy("Exporting keepers…");
    setError("");
    try {
      const res = await api.exportOriginals(dest);
      setBusy(
        `Exported ${res.exported} original${res.exported === 1 ? "" : "s"} (${fmtBytes(res.bytes)}) · metadata.csv written`,
      );
      setTimeout(() => setBusy(""), 5000);
    } catch (e) {
      fail(e);
      setBusy("");
    }
  }

  function cullOuting(d: string) {
    setDay(d);
    setVerdictFilter("unrated");
    setView("library");
    nav.record({ day: d, verdict: "unrated", view: "library" });
  }

  function openCompare(burstId: string | null | undefined) {
    if (!burstId) return;
    if (shots.filter((s) => s.burst_id === burstId).length < 2) return;
    setDetail(false);
    setLoupe(false);
    setCompareBurstId(burstId);
  }

  const lifePlates = useMemo(
    () => lifePlateIds.map((id) => shotsById.get(id)).filter((s): s is Shot => !!s),
    [lifePlateIds, shotsById],
  );
  const navList = burstReviewId ? burstMembers : view === "life" ? lifePlates : filtered;
  const selectedIndex = navList.findIndex((s) => s.id === selectedId);

  // Warm the next frames while this one is being judged -- image decode is the
  // last visible latency in the j/k loop now that the worker answers in ~1ms.
  const prefetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (selectedIndex < 0) return;
    for (const offset of [1, 2, -1]) {
      const shot = navList[selectedIndex + offset];
      if (!shot) continue;
      const src = previewUrl(shot.preview_path);
      if (!src || prefetched.current.has(src)) continue;
      if (prefetched.current.size > 300) prefetched.current.clear();
      prefetched.current.add(src);
      const img = new window.Image();
      img.decoding = "async";
      img.src = src;
    }
  }, [selectedIndex, navList]);
  const burstMeta = useMemo(() => {
    const groups = new Map<string, Shot[]>();
    for (const s of shots) {
      const bid = s.burst_id || s.id;
      const arr = groups.get(bid) || [];
      arr.push(s);
      groups.set(bid, arr);
    }
    const meta = new Map<string, BurstMeta>();
    for (const [bid, members] of groups) {
      const pick = [...members].sort((a, b) => (b.sharpness || -1) - (a.sharpness || -1))[0];
      meta.set(bid, { count: members.length, keepId: pick.id, memberIds: members.map((m) => m.id) });
    }
    return meta;
  }, [shots]);

  async function setVerdictOnly(id: string, v: Verdict) {
    recordVerdictUndo([{ id, next: v }]);
    await optimistic(new Map([[id, { verdict: v }]]), () => api.setVerdict(id, v));
  }

  async function applyVerdict(id: string, v: Verdict) {
    recordVerdictUndo([{ id, next: v }]);
    void optimistic(new Map([[id, { verdict: v }]]), () => api.setVerdict(id, v));
    if (!burstReviewId) return;
    const idx = burstMembers.findIndex((s) => s.id === id);
    const next = burstMembers[idx + 1];
    if (next) setSelectedId(next.id);
  }

  async function toggleFavorite(id: string) {
    const shot = shotsById.get(id);
    if (!shot) return;
    const next = shot.favorite ? 0 : 1;
    await optimistic(new Map([[id, { favorite: !shot.favorite }]]), async () => {
      const res = await api.set(id, { favorite: next });
      if (res.shot) patchShot(id, res.shot);
    });
  }

  async function cycleColor(id: string) {
    const shot = shotsById.get(id);
    if (!shot) return;
    const i = COLOR_CYCLE.indexOf((shot.color || "") as (typeof COLOR_CYCLE)[number]);
    const next = COLOR_CYCLE[(i + 1) % COLOR_CYCLE.length] || "none";
    await optimistic(new Map([[id, { color: next === "none" ? null : next }]]), async () => {
      const res = await api.set(id, { color: next });
      if (res.shot) patchShot(id, res.shot);
    });
  }

  async function setStars(id: string, n: number) {
    await optimistic(new Map([[id, { stars: n }]]), async () => {
      const res = await api.set(id, { stars: n });
      if (res.shot) patchShot(id, res.shot);
    });
  }

  async function setLocationLabel(id: string, label: string) {
    try {
      const res = await api.setLocation(id, label);
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveIdentity(id: string, common: string, scientific: string) {
    try {
      const res = await api.identify(id, { commonName: common, scientificName: scientific });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
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

  function pickShot(id: string, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      setPickedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectedId(id);
      return;
    }
    if (e.shiftKey && selectedId) {
      const a = filtered.findIndex((s) => s.id === selectedId);
      const b = filtered.findIndex((s) => s.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setPickedIds(new Set(filtered.slice(lo, hi + 1).map((s) => s.id)));
        setSelectedId(id);
        return;
      }
    }
    setSelectedId(id);
    setPickedIds(new Set());
  }

  async function setAnimalType(id: string, t: AnimalType) {
    await optimistic(new Map([[id, { animal_type: t }]]), async () => {
      const res = await api.set(id, { animal_type: t });
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    });
  }

  function move(delta: number) {
    if (!navList.length) return;
    const idx = selectedIndex < 0 ? 0 : selectedIndex + delta;
    const next = navList[Math.max(0, Math.min(navList.length - 1, idx))];
    setSelectedId(next.id);
  }

  function enterBurst(id: string) {
    const shot = shotsById.get(id);
    if (!shot?.burst_id) return;
    setBurstReviewId(shot.burst_id);
    setSelectedId(id);
    setDetail(true);
  }

  function exitBurst() {
    setBurstReviewId(null);
    setDetail(false);
    setLoupe(false);
    // Preserve view: stay in bursts if we were in bursts, else go to library
    setView((v) => (v === "bursts" ? "bursts" : "library"));
  }

  /**
   * Write verdicts to several shots as one optimistic batch and one undo step,
   * so resolving a burst is a single thing to take back.
   */
  async function setVerdicts(pairs: Array<{ id: string; verdict: Verdict }>) {
    if (!pairs.length) return;
    // A resolved burst leaves the queue; refresh it if that is what we are looking at.
    if (view === "bursts") setTimeout(() => void loadBursts(), 0);
    recordVerdictUndo(pairs.map((p) => ({ id: p.id, next: p.verdict })));
    const patches = new Map<string, Partial<Shot>>();
    for (const p of pairs) patches.set(p.id, { verdict: p.verdict });
    await optimistic(patches, () =>
      Promise.all(pairs.map((p) => api.setVerdict(p.id, p.verdict))),
    );
  }

  /** Keep one frame of a burst and reject the rest, in a single optimistic write. */
  async function keepOneOfBurst(keepId: string, memberIds: string[]) {
    await setVerdicts(
      memberIds.map((id) => ({ id, verdict: (id === keepId ? "keep" : "reject") as Verdict })),
    );
  }

  async function keepThis(id: string) {
    const shot = shotsById.get(id);
    if (!shot) return;
    const members = shots.filter((s) => s.burst_id === shot.burst_id);
    await keepOneOfBurst(id, members.map((m) => m.id));
  }

  async function keepPick(burstId: string) {
    const meta = burstMeta.get(burstId);
    if (!meta) return;
    await keepOneOfBurst(meta.keepId, meta.memberIds);
  }

  function onKey(e: KeyboardEvent) {
    if (compareBurstId || slideshow) return; // those overlays own the keyboard
    {
      // Anything modal swallows the cull keys. Without this, x and p write
      // verdicts to the shot sitting behind the open dialog.
      const closeTopModal =
        (disk && (() => setDisk(null))) ||
        (showBulkLocation && (() => setShowBulkLocation(false))) ||
        (auditOpen && (() => setAuditOpen(false))) ||
        (showPalette && (() => setShowPalette(false))) ||
        (showShortcuts && (() => setShowShortcuts(false))) ||
        null;
      // Typing is checked first so inputs inside a modal still work.
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (closeTopModal) closeTopModal();
          else (e.target as HTMLElement).blur();
        }
        return;
      }
      if (closeTopModal) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeTopModal();
        }
        return;
      }
      if (matches(e, keys.search)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const restored = undoVerdicts();
        if (restored) {
          setBusy(`Restored ${restored} verdict${restored === 1 ? "" : "s"}`);
          setTimeout(() => setBusy(""), 2000);
        }
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        nav.goBack();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        nav.goForward();
        return;
      }
      if (matches(e, keys.close)) {
        if (burstReviewId) {
          e.preventDefault();
          exitBurst();
          return;
        }
        if (detail) {
          // Close the panel itself. goBack only restores view and filters,
          // which left the panel stuck open with no keyboard way out.
          e.preventDefault();
          setDetail(false);
          setLoupe(false);
          return;
        }
        return;
      }
      if (!selectedId && navList[0]) setSelectedId(navList[0].id);
      const id = selectedId || navList[0]?.id;
      if (!id) return;
      if (e.key === "Enter" && !detail) {
        e.preventDefault();
        setDetail(true);
        return;
      }
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (matches(e, keys.next) || (bare && (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j"))) {
        e.preventDefault();
        move(1);
      } else if (matches(e, keys.prev) || (bare && (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k"))) {
        e.preventDefault();
        move(-1);
      } else if (matches(e, keys.keep)) {
        e.preventDefault();
        void applyVerdict(id, "keep");
      } else if (matches(e, keys.reject)) {
        e.preventDefault();
        void applyVerdict(id, "reject");
      } else if (matches(e, keys.unrated)) {
        e.preventDefault();
        void applyVerdict(id, "unrated");
      } else if (matches(e, keys.favorite)) {
        e.preventDefault();
        void toggleFavorite(id);
      } else if (matches(e, keys.color)) {
        e.preventDefault();
        void cycleColor(id);
      } else if (matches(e, keys.loupe)) {
        e.preventDefault();
        if (!detail) setDetail(true);
        setLoupe((v) => !v);
      }
    }
  }

  // The handler closes over most of the app's state, so it is kept in a ref and
  // the listener is registered once. A dependency array here would either
  // re-register on every render or go stale.
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function onImport() {
    let source: string | null = null;
    if (isTauri()) {
      const dir = await open({ directory: true, multiple: false, title: "Import folder — originals stay put" });
      if (!dir) return;
      source = Array.isArray(dir) ? dir[0] : dir;
    } else {
      source = window.prompt("Folder to import (originals stay there)");
    }
    if (!source) return;
    setBusy("Importing…");
    setError("");
    try {
      await api.importSource(source);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function loadAudit() {
    try {
      const res = await api.audit(200);
      if (!res.ok) return;
      const data = res;
      setAudit(data.entries || []);
      setAuditOpen(true);
    } catch {}
  }
  async function loadBursts(includeResolved = showResolvedBursts) {
    setBusy("Finding bursts…");
    try {
      const res = await api.bursts(includeResolved);
      setBursts(res.bursts || []);
      setBurstsResolved(res.resolved || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onView(v: View) {
    setView(v);
    nav.record({ view: v });
    if (v === "bursts") await loadBursts();
  }

  function persistKeys(next: Keymap) {
    setKeys(next);
    saveKeys(next);
  }

  
const verdicts = useMemo(() => {
    const v = { keep: 0, reject: 0, unrated: 0 };
    for (const s of shots) v[s.verdict] += 1;
    return v;
  }, [shots]);

  return (
    <div className="h-full flex flex-col bg-ink text-paper">
      <Toolbar
        view={view}
        onBack={() => nav.goBack()}
        onForward={() => nav.goForward()}
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        backTo={nav.backLabel}
        history={nav.entries}
        historyIndex={nav.index}
        onJump={(idx) => nav.goTo(idx)}
        onView={(v) => void onView(v)}
        onImport={() => void onImport()}
        onDelete={() => void diskFlow.openDelete()}
        onOffload={() => void diskFlow.openOffload()}
        onExport={() => void onExportKeepers()}
        onSlideshow={() => {
          setDetail(false);
          setSlideshow(true);
        }}
        onIdentifySeries={() => void identify.runIdentifySeries(filtered, pickedIds)}
        onCancelIdentify={identify.cancel}
        identifyingSeries={identify.identifyingSeries}
        busy={busy}
        onBulkLocation={() => setShowBulkLocation(true)}
      />
      {view === "library" ? (
        <Filters
          search={search}
          searchRef={searchRef}
          onSearch={setSearch}
          animal={animal}
          onAnimal={(v) => {
            setAnimal(v);
            nav.record({ animal: v });
          }}
          location={location}
          locations={locations}
          onLocation={(v) => {
            setLocation(v);
            nav.record({ location: v });
          }}
          starsMin={starsMin}
          onStarsMin={(v) => {
            setStarsMin(v);
            nav.record({ starsMin: v });
          }}
          day={day}
          outings={outings}
          onDay={(v) => {
            setDay(v);
            nav.record({ day: v });
          }}
          verdict={verdict}
          onVerdict={(v) => {
            setVerdictFilter(v);
            nav.record({ verdict: v });
          }}
          sort={sort}
          onSort={(v) => {
            setSort(v);
            nav.record({ sort: v });
          }}
          needsId={needsId}
          onNeedsId={(v) => {
            setNeedsId(v);
            nav.record({ needsId: v });
          }}
        />
      ) : null}
      {error ? (
        <div role="alert" className="flex justify-between border-l-4 border-reject bg-reject/15 px-4 py-2 text-sm text-paper">
          <span>{error}</span>
          <button className="text-paper-dim transition-colors hover:text-paper" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      ) : null}
      <main className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 h-full">
        {view === "library" ? (
          ready ? (
            <Grid
              shots={filtered}
              selectedId={selectedId}
              pickedIds={pickedIds}
              bursts={burstMeta}
              onSelect={pickShot}
              onOpen={(id) => {
                setSelectedId(id);
                setDetail(true);
              }}
              onKeepThis={(id) => void keepThis(id)}
              onKeepPick={(bid) => void keepPick(bid)}
              onCompare={(id) => openCompare(shotsById.get(id)?.burst_id)}
              grouped={sort === "captured_at" && !day}
              onCullDay={cullOuting}
            />
          ) : (
            <div className="p-8 text-paper-dim font-serif">Loading library…</div>
          )
        ) : null}
        {view === "map" ? (
          <MapView
            shots={shots}
            onOpen={(id) => {
              setSelectedId(id);
              setDetail(true);
            }}
            onLocation={(id, label) => void setLocationLabel(id, label)}
          />
        ) : null}
        {view === "life" ? (
          <LifeList
            shots={shots}
            selectedId={selectedId}
            onPlates={setLifePlateIds}
            onOpenShot={(id) => {
              setSelectedId(id);
              setDetail(true);
            }}
            onPick={(id, clear) => {
              void (async () => {
                try {
                  await api.lifeListPick(id, !!clear);
                  await reload();
                } catch (e) { fail(e); }
              })();
            }}
            onClearSpecies={(key, common) => {
              void (async () => {
                const ok = window.confirm(
                  `Remove ${common} from the life list?

` +
                  `This clears the identification from every shot of it — the ` +
                  `photographs are untouched, and you can identify them again.`,
                );
                if (!ok) return;
                try {
                  const res = await api.clearIdentity({ species: key });
                  await reload();
                  setBusy(`Cleared ${common} from ${res.cleared} shot${res.cleared === 1 ? "" : "s"}`);
                  setTimeout(() => setBusy(""), 4000);
                } catch (e) { fail(e); }
              })();
            }}
            onOpenSpecies={(name) => {
              setSearch(name);
              setView("library");
              nav.record({ search: name, view: "library" });
            }}
          />
        ) : null}
        {view === "bursts" ? (
          <Bursts
            bursts={bursts}
            shotsById={shotsById}
            onCompare={(burstId) => openCompare(burstId)}
            onOpen={(id) => enterBurst(id)}
            onApply={(keepId, rejectIds) => {
              // One batched, undoable gesture -- same path compare's Enter uses.
              void keepOneOfBurst(keepId, [keepId, ...rejectIds]);
            }}
            resolved={burstsResolved}
            showResolved={showResolvedBursts}
            onShowResolved={(v) => {
              setShowResolvedBursts(v);
              void loadBursts(v);
            }}
          />
        ) : null}
        {view === "settings" ? (
          <Settings
            keys={keys}
            onKeys={persistKeys}
            cli={paths.cli}
            library={paths.library}
            hasXaiKey={identify.hasXaiKey}
            xaiKeyDraft={identify.xaiKeyDraft}
            onXaiKeyDraft={identify.setXaiKeyDraft}
            backend={identify.backend}
            ollamaModel={identify.ollamaModel}
            onBackend={identify.setBackend}
            onOllamaModel={identify.setOllamaModel}
            onSaveIdentify={() =>
              void identify.saveBackend({ backend: identify.backend, model: identify.ollamaModel })
            }
            onSaveXaiKey={() => void identify.saveKey()}
            onViewAudit={loadAudit}
            onRefresh={() => {
              void (async () => {
                setBusy("Refreshing previews…");
                try {
                  await api.refreshPreviews();
                  await reload();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy("");
                }
              })();
            }}
            onMassLocation={async (date: string, locationLabel: string) => {
              setBusy("Applying location by date…");
              setError("");
              try {
                const res = await api.setLocationByDate(date, locationLabel);
                await reload();
                setBusy(`Location updated for ${res.count} shot${res.count !== 1 ? "s" : ""} on ${res.date}`);
                setTimeout(() => setBusy(""), 4000);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy("");
              }
            }}
          />
        ) : null}
        </div>
        {detail && selected ? (
          <Detail
            shot={selected}
            loupe={loupe}
            identifying={identify.identifying}
            fieldMarkOptions={fieldMarkOptions}
            burstPos={
              burstReviewId && burstMembers.length
                ? { index: Math.max(0, selectedIndex), count: burstMembers.length }
                : null
            }
            onClose={() => {
              if (burstReviewId) exitBurst();
              else {
                setDetail(false);
                setLoupe(false);
              }
            }}
            onStars={(n) => void setStars(selected.id, n)}
            onFavorite={() => void toggleFavorite(selected.id)}
            onColor={() => void cycleColor(selected.id)}
            onVerdict={(v) => void applyVerdict(selected.id, v)}
            onLocation={(label) => void setLocationLabel(selected.id, label)}
            onAnimalType={(t) => void setAnimalType(selected.id, t)}
            onSaveIdentity={(c, s) => void saveIdentity(selected.id, c, s)}
            onSaveFieldMarks={(m) => void saveFieldMarks(selected.id, m)}
            onRunIdentify={() => void identify.runIdentify(selected.id)}
          />
        ) : null}
      </main>
      
      {showShortcuts && (
        <ShortcutsOverlay keys={keys} view={view} onClose={() => setShowShortcuts(false)} />
      )}
      {showPalette && (
        <CommandPalette
          history={nav.entries}
          historyIndex={nav.index}
          onView={(v) => { void onView(v); setShowPalette(false); }}
          onJump={(idx) => { nav.goTo(idx); setShowPalette(false); }}
          onClose={() => setShowPalette(false)}
        />
      )}

      <footer className="flex items-center gap-4 border-t border-bark bg-charcoal/60 px-4 py-1.5 text-xs text-paper-dim">
        <span className="sr-only" role="status" aria-live="polite">{busy}</span>
        <span>
          <span className="text-paper">{filtered.length}</span> shown · {shots.length} in library
        </span>
        <span className="flex items-center gap-2">
          <span className="text-moss">{verdicts.keep} keep</span>
          <span className="text-reject">{verdicts.reject} reject</span>
          <span>{verdicts.unrated} unrated</span>
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="fc-kbd">Ctrl+K</kbd> palette
          <kbd className="fc-kbd">?</kbd> shortcuts
        </span>
        <span className="ml-auto">
          {burstReviewId
            ? `Burst ${selectedIndex + 1}/${burstMembers.length} · Esc library`
            : pickedIds.size
              ? `${pickedIds.size} picked · Identify series`
              : "Ctrl+click pick · Identify series · J/K cull"}
        </span>
      </footer>
      {showBulkLocation && (
        <BulkLocationModal
          open
          shots={shots}
          onClose={() => setShowBulkLocation(false)}
          onApplied={(count) => {
            void reload();
            setBusy(`Location updated for ${count} shots`);
            setTimeout(() => setBusy(""), 4000);
          }}
        />
      )}
      {slideshow ? (
        <Slideshow
          shots={filtered}
          startId={selected?.id ?? null}
          onFavorite={(id) => void toggleFavorite(id)}
          onClose={() => setSlideshow(false)}
        />
      ) : null}
      {compareBurstId ? (
        <CompareView
          members={compareMembers}
          keys={keys}
          onVerdict={(id, v) => void setVerdictOnly(id, v)}
          onResolve={(pairs) => {
            void setVerdicts(pairs);
            setCompareBurstId(null);
            // Land on a survivor, whether it was marked keep during the
            // compare or only just became one.
            const applied = new Map(pairs.map((p) => [p.id, p.verdict]));
            const keeper = compareMembers.find(
              (m) => (applied.get(m.id) ?? m.verdict) === "keep",
            );
            if (keeper) setSelectedId(keeper.id);
          }}
          onKeepOnly={(keepId) => {
            void keepOneOfBurst(keepId, compareMembers.map((m) => m.id));
            setCompareBurstId(null);
            setSelectedId(keepId);
          }}
          onClose={() => setCompareBurstId(null)}
        />
      ) : null}
      {auditOpen ? <AuditLog entries={audit} onClose={() => setAuditOpen(false)} /> : null}
      {disk ? (
        <DiskDialog
          kind={disk.kind}
          dryRun={disk.dryRun}
          confirmTyped={diskFlow.confirmTyped}
          cloudOk={diskFlow.cloudOk}
          busy={!!busy}
          onTyped={diskFlow.setConfirmTyped}
          onCloudOk={diskFlow.setCloudOk}
          onCancel={() => setDisk(null)}
          onExecute={() => void diskFlow.executeDisk()}
        />
      ) : null}
    </div>
  );
}


function sortValue(s: Shot, key: SortKey): string | number {
  switch (key) {
    case "captured_at":
      return s.captured_at || "";
    case "created_at":
      return s.created_at || "";
    case "stars":
      return s.stars || 0;
    case "sharpness":
      return s.sharpness || -1;
    case "species":
      return (s.common_name || "").toLowerCase();
    case "location":
      return (s.location || "").toLowerCase();
  }
}