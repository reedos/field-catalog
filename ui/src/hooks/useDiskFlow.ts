import { useState } from "react";
import { confirm as nativeConfirm } from "@tauri-apps/plugin-dialog";
import type { DiskResult, Shot } from "../types";
import { fmtBytes } from "../lib/format";
import { isTauri } from "../lib/preview";
import { api } from "../lib/worker";

/**
 * The delete/offload flow: dry-run first, confirm-string gate, execute.
 *
 * The safety property this hook owns: the dialog only ever shows dry-run data,
 * and execute takes its ids from that same dry run. If the dry run fails there
 * is nothing safe to show, so no dialog opens.
 */
export function useDiskFlow(deps: {
  shots: Shot[];
  reload: () => Promise<void>;
  setBusy: (s: string) => void;
  setError: (s: string) => void;
  closeDetail: () => void;
}) {
  const [disk, setDisk] = useState<null | { kind: "delete" | "offload"; dryRun: DiskResult | null }>(
    null,
  );
  const [confirmTyped, setConfirmTyped] = useState("");
  const [cloudOk, setCloudOk] = useState(false);

  const { reload, setBusy, setError, closeDetail } = deps;

  async function openDelete() {
    setBusy("Listing rejected originals…");
    setError("");
    closeDetail();
    try {
      const pending = await api.pendingDeletes("reject");
      if (!pending.count || !pending.files?.length) {
        setError("No rejected originals still on disk.");
        return;
      }
      const ids = pending.files.map((f) => f.id).filter(Boolean);
      // The dry run is the list the user confirms and the list we execute. If it
      // fails there is nothing safe to show, so do not fall back to `pending`.
      const dryRun = await api.deleteOriginals(ids, false);
      setConfirmTyped("");
      setCloudOk(false);
      setDisk({ kind: "delete", dryRun });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function openOffload() {
    const keepers = deps.shots.filter((s) => s.verdict === "keep" && s.original_status === "present");
    if (!keepers.length) {
      setError("No keepers with originals still on disk.");
      return;
    }
    setBusy("Dry-run offload…");
    setError("");
    try {
      const ids = keepers.map((s) => s.id);
      const dryRun = await api.offloadOriginals(ids, false);
      setConfirmTyped("");
      setCloudOk(false);
      setDisk({ kind: "offload", dryRun });
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
    setBusy("Unlinking originals…");
    try {
      const result =
        disk.kind === "delete"
          ? await api.deleteOriginals(ids, true)
          : await api.offloadOriginals(ids, true);
      setDisk({ ...disk, dryRun: result });
      await reload();
      if (result.errors?.length) {
        // Leave the dialog open so the per-file failures stay readable.
        setBusy("");
        return;
      }
      setDisk(null);
      const n = result.count ?? ids.length;
      // Not inside a finally -- that would clear this before it ever rendered.
      setBusy(`Unlinked ${n} original${n === 1 ? "" : "s"} · previews kept`);
      setTimeout(() => setBusy(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  return {
    disk,
    setDisk,
    confirmTyped,
    setConfirmTyped,
    cloudOk,
    setCloudOk,
    openDelete,
    openOffload,
    executeDisk,
  };
}
