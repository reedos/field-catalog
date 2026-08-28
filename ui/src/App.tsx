import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { open, confirm as nativeConfirm } from "@tauri-apps/plugin-dialog";
import Bursts from "./components/Bursts";
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
import { isTauri } from "./lib/preview";
import { api, onWorkerProgress } from "./lib/worker";
import {
  COLOR_CYCLE,
  type AnimalType,
  type BurstPick,
  type DiskResult,
  type Keymap,
  type Shot,
  type SortKey,
  type Verdict,
  type View,
  type ViewState,
} from "./types";

export default function App() {
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [loupe, setLoupe] = useState(false);
  const [view, setView] = useState<View>("library");
  const [search, setSearch] = useState("");
  // The input stays responsive; the 3500-row filter + sort yields to it.
  const deferredSearch = useDeferredValue(search);
  const [animal, setAnimal] = useState<AnimalType | "">("");
  const [location, setLocation] = useState("");
  const [starsMin, setStarsMin] = useState(0);
  const [verdict, setVerdictFilter] = useState<Verdict | "">("");
  const [needsId, setNeedsId] = useState(false);
  const [sort, setSort] = useState<SortKey>("captured_at");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [keys, setKeys] = useState<Keymap>(loadKeys);
  const [bursts, setBursts] = useState<BurstPick[]>([]);
  const [paths, setPaths] = useState({ cli: "", library: "" });
  const [disk, setDisk] = useState<null | { kind: "delete" | "offload"; pending: DiskResult | null; dryRun: DiskResult | null }>(null);
  const [audit, setAudit] = useState<{ts:string;action:string;count:number;bytes:number}[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [confirmTyped, setConfirmTyped] = useState("");
  const [cloudOk, setCloudOk] = useState(false);
  const [burstReviewId, setBurstReviewId] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identifyingSeries, setIdentifyingSeries] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const cancelIdentify = useRef(false);
  const [hasXaiKey, setHasXaiKey] = useState(false);
  const [xaiKeyDraft, setXaiKeyDraft] = useState("");
  const [identifyBackend, setIdentifyBackend] = useState<"ollama" | "xai">("ollama");
  const [ollamaModel, setOllamaModel] = useState("muse-glimmer:30b");
  const searchRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<ViewState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showBulkLocation, setShowBulkLocation] = useState(false);

  // Hydrate history from sessionStorage on start
  useEffect(() => {
    try {
      const h = sessionStorage.getItem('fc_history');
      const i = sessionStorage.getItem('fc_historyIndex');
      if (h && i) {
        const parsed = JSON.parse(h) as ViewState[];
        const idx = parseInt(i, 10);
        if (Array.isArray(parsed) && idx >= 0 && idx < parsed.length) {
          setHistory(parsed);
          setHistoryIndex(idx);
          const s = parsed[idx];
          setView(s.view);
          setSearch(s.search);
          setAnimal(s.animal);
          setLocation(s.location);
          setStarsMin(s.starsMin);
          setVerdictFilter(s.verdict);
          setNeedsId(s.needsId);
          setSort(s.sort);
        }
      }
    } catch {}
  }, []);

  // Persist history to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('fc_history', JSON.stringify(history));
      sessionStorage.setItem('fc_historyIndex', String(historyIndex));
    } catch {}
  }, [history, historyIndex]);

  const reload = useCallback(async () => {
    const listed = await api.list();
    setShots((listed.shots || []).map(normalizeShot));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onWorkerProgress((line) => setBusy(line)).then((fn) => {
      unlisten = fn;
    });
    (async () => {
      try {
        setBusy("Opening libraryâ€¦");
        setPaths(await api.paths());
        await api.init();
        const key = await api.keyStatus();
        setHasXaiKey(!!key.has_xai_key);
        if (key.backend === "xai" || key.backend === "ollama") setIdentifyBackend(key.backend);
        if (key.ollama_model) setOllamaModel(key.ollama_model);
        await reload();
        setReady(true);
        setHistory((prev) => (prev.length ? prev : [{
          view: "library",
          search: "",
          animal: "",
          location: "",
          starsMin: 0,
          verdict: "",
          needsId: false,
          sort: "captured_at",
        }]));
        setHistoryIndex((i) => (i < 0 ? 0 : i));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy("");
      }
    })();
    return () => unlisten?.();
  }, [reload]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const s of shots) {
      if (s.location) set.add(s.location);
    }
    return [...set].sort();
  }, [shots]);

  const fieldMarkOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of shots) {
      for (const m of s.field_marks || []) {
        if (m) set.add(m);
      }
    }
    return [...set].sort();
  }, [shots]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let rows = shots.filter((s) => {
      if (needsId && (s.common_name || s.scientific_name)) return false;
      if (animal && s.animal_type !== animal) return false;
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
  }, [shots, animal, location, starsMin, verdict, deferredSearch, sort, needsId]);

  const shotsById = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const selected = selectedId ? shotsById.get(selectedId) : undefined;
  const burstMembers = useMemo(() => {
    if (!burstReviewId) return [];
    return shots
      .filter((s) => s.burst_id === burstReviewId)
      .sort((a, b) => (a.captured_at || "").localeCompare(b.captured_at || "") || a.id.localeCompare(b.id));
  }, [shots, burstReviewId]);
  const navList = burstReviewId ? burstMembers : filtered;
  const selectedIndex = navList.findIndex((s) => s.id === selectedId);
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

  function patchShot(id: string, partial: Partial<Shot>) {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...partial } : s)));
  }

  /** Apply one patch per id in a single pass, instead of cloning the list per id. */
  function patchShots(patches: Map<string, Partial<Shot>>) {
    if (!patches.size) return;
    setShots((prev) => prev.map((s) => (patches.has(s.id) ? { ...s, ...patches.get(s.id)! } : s)));
  }

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  /** Optimistic write that puts the previous values back if the worker rejects it. */
  function optimistic(patches: Map<string, Partial<Shot>>, call: () => Promise<unknown>) {
    const rollback = new Map<string, Partial<Shot>>();
    for (const [id, partial] of patches) {
      const cur = shotsById.get(id);
      if (!cur) continue;
      rollback.set(id, Object.fromEntries(Object.keys(partial).map((k) => [k, (cur as any)[k]])));
    }
    patchShots(patches);
    return call().catch((e) => {
      patchShots(rollback);
      fail(e);
    });
  }

  async function setVerdictOnly(id: string, v: Verdict) {
    await optimistic(new Map([[id, { verdict: v }]]), () => api.setVerdict(id, v));
  }

  async function applyVerdict(id: string, v: Verdict) {
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

  async function runIdentify(id: string) {
    setIdentifying(true);
    setError("");
    try {
      const res = await api.identify(id);
      if (res.shot) patchShot(id, normalizeShot(res.shot));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIdentifying(false);
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

  async function runIdentifySeries() {
    const picked = filtered.filter((s) => pickedIds.has(s.id));
    const queue = picked.length
      ? picked
      : filtered.filter((s) => !s.common_name);
    // Confidence gate: skip already high confidence
    const gated = queue.filter(s => {
      const conf = s.confidence;
      if (conf == null) return true;
      const c = conf > 1 ? conf / 100 : conf;
      return c < 0.9;
    });
    if (!gated.length) {
      setError("Nothing to identify. Ctrl+click shots, or filter to Needs ID.");
      return;
    }
    const label = picked.length
      ? `Identify ${gated.length} selected shot(s) in series?`
      : `Identify ${gated.length} unlabeled shot(s) in the current view, one at a time?`;
    const ok = window.confirm(`${label}\nNot automatic on import. Stop anytime.`);
    if (!ok) return;
    cancelIdentify.current = false;
    setIdentifyingSeries(true);
    setIdentifying(true);
    setError("");
    let failed = 0;
    try {
      for (let i = 0; i < gated.length; i++) {
        if (cancelIdentify.current) break;
        const shot = gated[i];
        setSelectedId(shot.id);
        setBusy(`Identify ${i + 1}/${gated.length}`);
        try {
          const res = await api.identify(shot.id);
          if (res.shot) patchShot(shot.id, normalizeShot(res.shot));
        } catch (e) {
          failed += 1;
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      setIdentifying(false);
      setIdentifyingSeries(false);
      setBusy(failed ? `Identify stopped Â· ${failed} failed` : "");
    }
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

  /** Keep one frame of a burst and reject the rest, in a single optimistic write. */
  async function keepOneOfBurst(keepId: string, memberIds: string[]) {
    const patches = new Map<string, Partial<Shot>>();
    for (const id of memberIds) {
      patches.set(id, { verdict: id === keepId ? "keep" : "reject" });
    }
    await optimistic(patches, () =>
      Promise.all(
        memberIds.map((id) => api.setVerdict(id, id === keepId ? "keep" : "reject")),
      ),
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disk) {
        if (e.key === "Escape") setDisk(null);
        return;
      }
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
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
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
        return;
      }
      if (matches(e, keys.close)) {
        if (burstReviewId) {
          e.preventDefault();
          exitBurst();
          return;
        }
        if (detail) {
          goBack();
          return;
        }
        return;
      }
      if (!selectedId && navList[0]) setSelectedId(navList[0].id);
      const id = selectedId || navList[0]?.id;
      if (!id) return;
      if (matches(e, keys.next) || e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (matches(e, keys.prev) || e.key === "ArrowLeft" || e.key === "ArrowUp") {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function onImport() {
    let source: string | null = null;
    if (isTauri()) {
      const dir = await open({ directory: true, multiple: false, title: "Import folder â€” originals stay put" });
      if (!dir) return;
      source = Array.isArray(dir) ? dir[0] : dir;
    } else {
      source = window.prompt("Folder to import (originals stay there)");
    }
    if (!source) return;
    setBusy("Importingâ€¦");
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

  async function openDelete() {
    setBusy("Listing rejected originalsâ€¦");
    setError("");
    setDetail(false);
    try {
      const pending = await api.pendingDeletes("reject");
      if (!pending.count || !pending.files?.length) {
        setError("No rejected originals still on disk.");
        return;
      }
      const ids = pending.files.map((f) => f.id).filter(Boolean);
      let dryRun: DiskResult = pending;
      try {
        dryRun = await api.deleteOriginals(ids, false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setConfirmTyped("");
      setCloudOk(false);
      setDisk({ kind: "delete", pending, dryRun });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function openOffload() {
    const keepers = shots.filter((s) => s.verdict === "keep" && s.original_status === "present");
    if (!keepers.length) {
      setError("No keepers with originals still on disk.");
      return;
    }
    setBusy("Dry-run offloadâ€¦");
    setError("");
    try {
      const ids = keepers.map((s) => s.id);
      const dryRun = await api.offloadOriginals(ids, false);
      setConfirmTyped("");
      setCloudOk(false);
      setDisk({
        kind: "offload",
        pending: { ok: true, count: dryRun.count, bytes: dryRun.bytes, files: dryRun.files },
        dryRun,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function executeDisk() {
    if (!disk?.dryRun) return;
    const needed = disk.kind === "delete" ? "DELETE_ORIGINALS" : "OFFLOAD_ORIGINALS";
    if (confirmTyped !== needed) return;
    const ids = (disk.dryRun.files || []).map((f) => f.id);
    const message = `Unlink ${ids.length} original file(s) (${fmtBytes(disk.dryRun.bytes)})? Previews stay. This cannot be undone from the catalog.`;
    let ok = true;
    try {
      ok = isTauri()
        ? await nativeConfirm(message, {
            title: disk.kind === "delete" ? "Delete originals" : "Offload originals",
            kind: "warning",
          })
        : window.confirm(message);
    } catch {
      ok = window.confirm(message);
    }
    if (!ok) return;
    setBusy("Unlinking originalsâ€¦");
    try {
      const result =
        disk.kind === "delete"
          ? await api.deleteOriginals(ids, true)
          : await api.offloadOriginals(ids, true);
      setDisk({ ...disk, dryRun: result });
      await reload();
      if (!result.errors?.length) {
        setDisk(null);
        setBusy(`Unlinked ${result.count ?? ids.length} original${(result.count ?? ids.length) === 1 ? "" : "s"} Â· previews kept`);
        setTimeout(() => setBusy(""), 4000);
      }
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
  async function loadBursts() {
    setBusy("Finding burstsâ€¦");
    try {
      const res = await api.bursts();
      setBursts(res.bursts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onView(v: View) {
    pushHistory();
    setView(v);
    if (v === "bursts") await loadBursts();
  }

  function persistKeys(next: Keymap) {
    setKeys(next);
    saveKeys(next);
  }

  
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;

  function pushHistory() {
    const state: ViewState = {
      view,
      search,
      animal,
      location,
      starsMin,
      verdict,
      needsId,
      sort,
    };
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const last = trimmed[trimmed.length - 1];
      if (last && historyLabel(last) === historyLabel(state) && last.view === state.view && last.search === state.search && last.animal === state.animal && last.location === state.location && last.verdict === state.verdict && last.needsId === state.needsId && last.sort === state.sort && last.starsMin === state.starsMin) {
        return prev;
      }
      const next = [...trimmed, state];
      return next.length > 16 ? next.slice(next.length - 16) : next;
    });
    setHistoryIndex((i) => Math.min(15, i + 1));
  }

  function goBack() {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const state = history[newIndex];
    if (!state) return;
    applyState(state);
    setHistoryIndex(newIndex);
  }

  function goForward() {
    if (!canGoForward) return;
    const newIndex = historyIndex + 1;
    const state = history[newIndex];
    if (!state) return;
    applyState(state);
    setHistoryIndex(newIndex);
  }

  function applyState(state: ViewState) {
    setView(state.view);
    setSearch(state.search);
    setAnimal(state.animal);
    setLocation(state.location);
    setStarsMin(state.starsMin);
    setVerdictFilter(state.verdict);
    setNeedsId(state.needsId);
    setSort(state.sort);
  }

  function goToHistory(idx: number) {
    if (idx < 0 || idx >= history.length) return;
    const state = history[idx];
    if (!state) return;
    applyState(state);
    setHistoryIndex(idx);
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
        onBack={() => void goBack()}
        onForward={() => void goForward()}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        backTo={canGoBack && history[historyIndex - 1] ? historyLabel(history[historyIndex - 1]) : undefined}
        history={history}
        historyIndex={historyIndex}
        onJump={(idx) => void goToHistory(idx)}
        onView={(v) => void onView(v)}
        onImport={() => void onImport()}
        onDelete={() => void openDelete()}
        onOffload={() => void openOffload()}
        onIdentifySeries={() => void runIdentifySeries()}
        onCancelIdentify={() => {
          cancelIdentify.current = true;
        }}
        identifyingSeries={identifyingSeries}
        busy={busy}
        onBulkLocation={() => setShowBulkLocation(true)}
      />
      <div className="px-3 py-1 text-[10px] text-paper-dim flex gap-3">
        <span>⌘K palette</span>
        <span>?</span><span>shortcuts</span>
      </div>
      {view === "library" ? (
        <Filters
          search={search}
          searchRef={searchRef}
          onSearch={setSearch}
          animal={animal}
          onAnimal={(v) => {
            pushHistory();
            setAnimal(v);
          }}
          location={location}
          locations={locations}
          onLocation={(v) => {
            pushHistory();
            setLocation(v);
          }}
          starsMin={starsMin}
          onStarsMin={(v) => {
            pushHistory();
            setStarsMin(v);
          }}
          verdict={verdict}
          onVerdict={(v) => {
            pushHistory();
            setVerdictFilter(v);
          }}
          sort={sort}
          onSort={(v) => {
            pushHistory();
            setSort(v);
          }}
          needsId={needsId}
          onNeedsId={(v) => {
            pushHistory();
            setNeedsId(v);
          }}
        />
      ) : null}
      {error ? (
        <div className="px-4 py-2 text-sm bg-reject/20 text-paper flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
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
              onCompare={(id) => enterBurst(id)}
            />
          ) : (
            <div className="p-8 text-paper-dim font-serif">Loading libraryâ€¦</div>
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
            onOpenSpecies={(name) => {
              pushHistory();
              setSearch(name);
              setView("library");
            }}
          />
        ) : null}
        {view === "bursts" ? (
          <Bursts
            bursts={bursts}
            shotsById={shotsById}
            onOpen={(id) => enterBurst(id)}
            onApply={(keepId, rejectIds) => {
              void (async () => {
                await setVerdictOnly(keepId, "keep");
                for (const id of rejectIds) await setVerdictOnly(id, "reject");
              })();
            }}
          />
        ) : null}
        {view === "settings" ? (
          <Settings
            keys={keys}
            onKeys={persistKeys}
            cli={paths.cli}
            library={paths.library}
            hasXaiKey={hasXaiKey}
            xaiKeyDraft={xaiKeyDraft}
            onXaiKeyDraft={setXaiKeyDraft}
            backend={identifyBackend}
            ollamaModel={ollamaModel}
            onBackend={setIdentifyBackend}
            onOllamaModel={setOllamaModel}
            onSaveIdentify={() => {
              void (async () => {
                try {
                  const res = await api.setIdentify({
                    backend: identifyBackend,
                    model: ollamaModel,
                  });
                  if (res.backend === "xai" || res.backend === "ollama") setIdentifyBackend(res.backend);
                  if (res.ollama_model) setOllamaModel(res.ollama_model);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
            onSaveXaiKey={() => {
              void (async () => {
                try {
                  const res = await api.setKey(xaiKeyDraft.trim());
                  setHasXaiKey(!!res.has_xai_key);
                  setXaiKeyDraft("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
            onViewAudit={loadAudit}
            onRefresh={() => {
              void (async () => {
                setBusy("Refreshing previewsâ€¦");
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
            identifying={identifying}
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
            onRunIdentify={() => void runIdentify(selected.id)}
          />
        ) : null}
      </main>
      
      {showShortcuts && (
        <ShortcutsOverlay keys={keys} view={view} onClose={() => setShowShortcuts(false)} />
      )}
      {showPalette && (
        <CommandPalette
          view={view}
          history={history}
          historyIndex={historyIndex}
          onView={(v) => { onView(v); setShowPalette(false); }}
          onJump={(idx) => { goToHistory(idx); setShowPalette(false); }}
          onClose={() => setShowPalette(false)}
        />
      )}

      <footer className="border-t border-bark px-4 py-1 text-xs text-paper-dim flex gap-4">
        <span>{filtered.length} shown</span>
        <span>{shots.length} in library</span>
        <span>{verdicts.keep} keep</span>
        <span>{verdicts.reject} reject</span>
        <span>{verdicts.unrated} unrated</span>
        <span className="ml-auto">
          {burstReviewId
            ? `Burst ${selectedIndex + 1}/${burstMembers.length} Â· Esc library`
            : pickedIds.size
              ? `${pickedIds.size} picked Â· Identify series`
              : "Ctrl+click pick Â· Identify series Â· J/K cull"}
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
      {auditOpen ? <AuditLog entries={audit} onClose={() => setAuditOpen(false)} /> : null}
      {disk ? (
        <DiskDialog
          kind={disk.kind}
          dryRun={disk.dryRun}
          pending={disk.pending}
          confirmTyped={confirmTyped}
          cloudOk={cloudOk}
          busy={!!busy}
          onTyped={setConfirmTyped}
          onCloudOk={setCloudOk}
          onCancel={() => setDisk(null)}
          onExecute={() => void executeDisk()}
        />
      ) : null}
    </div>
  );
}

function historyLabel(s: ViewState): string {
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

function normalizeShot(s: Shot): Shot {
  return {
    ...s,
    field_marks: Array.isArray(s.field_marks) ? s.field_marks : [],
    similar_species: Array.isArray(s.similar_species) ? s.similar_species : [],
    notes: s.notes || "",
    confidence: s.confidence ?? null,
    gps_from_file: !!s.gps_from_file,
  };
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