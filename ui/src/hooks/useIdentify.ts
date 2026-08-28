import { useRef, useState } from "react";
import type { Shot } from "../types";
import { api } from "../lib/worker";
import { normalizeShot } from "./useShots";

/**
 * Species identification: single-shot runs, the batch series with its
 * confidence gate, and the backend/key settings that drive them.
 *
 * Known limit, tracked in the backlog: cancel is checked between shots, so an
 * in-flight model call still runs to completion.
 */
export function useIdentify(deps: {
  patchShot: (id: string, partial: Partial<Shot>) => void;
  setSelectedId: (id: string) => void;
  setBusy: (s: string) => void;
  setError: (s: string) => void;
}) {
  const { patchShot, setSelectedId, setBusy, setError } = deps;

  const [identifying, setIdentifying] = useState(false);
  const [identifyingSeries, setIdentifyingSeries] = useState(false);
  const cancelIdentify = useRef(false);

  const [hasXaiKey, setHasXaiKey] = useState(false);
  const [xaiKeyDraft, setXaiKeyDraft] = useState("");
  const [backend, setBackend] = useState<"ollama" | "xai">("ollama");
  const [ollamaModel, setOllamaModel] = useState("muse-glimmer:30b");

  /** Pull the saved backend/key status into state; called once at startup. */
  async function loadKeyStatus() {
    const key = await api.keyStatus();
    setHasXaiKey(!!key.has_xai_key);
    if (key.backend === "xai" || key.backend === "ollama") setBackend(key.backend);
    if (key.ollama_model) setOllamaModel(key.ollama_model);
  }

  async function saveKey() {
    try {
      const res = await api.setKey(xaiKeyDraft.trim());
      setHasXaiKey(!!res.has_xai_key);
      setXaiKeyDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveBackend(next: { backend?: string; model?: string; url?: string }) {
    try {
      const res = await api.setIdentify(next);
      if (res.backend === "xai" || res.backend === "ollama") setBackend(res.backend);
      if (res.ollama_model) setOllamaModel(res.ollama_model);
      setHasXaiKey(!!res.has_xai_key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  /** Identify picked shots, or every unlabeled shot in view, one at a time. */
  async function runIdentifySeries(filtered: Shot[], pickedIds: Set<string>) {
    const picked = filtered.filter((s) => pickedIds.has(s.id));
    const queue = picked.length ? picked : filtered.filter((s) => !s.common_name);
    // Confidence gate: skip already high confidence
    const gated = queue.filter((s) => {
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
      setBusy(failed ? `Identify stopped · ${failed} failed` : "");
    }
  }

  return {
    identifying,
    identifyingSeries,
    cancel: () => {
      cancelIdentify.current = true;
    },
    hasXaiKey,
    xaiKeyDraft,
    setXaiKeyDraft,
    backend,
    setBackend,
    ollamaModel,
    setOllamaModel,
    loadKeyStatus,
    saveKey,
    saveBackend,
    runIdentify,
    runIdentifySeries,
  };
}
