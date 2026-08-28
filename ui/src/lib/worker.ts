import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BurstPick, DiskResult, ListResult, Shot } from "../types";
import { isTauri } from "./preview";

type Envelope<T> = T & { ok: boolean; error?: string };

interface WorkerProc {
  stdout: string;
  stderr: string;
  code: number | null;
}

function parseJson(stdout: string, stderr: string): Envelope<Record<string, unknown>> {
  const text = (stdout || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(stderr.trim() || "worker returned no JSON");
  }
  return JSON.parse(text.slice(start, end + 1)) as Envelope<Record<string, unknown>>;
}

export async function runWorker<T = Record<string, unknown>>(args: string[]): Promise<Envelope<T>> {
  let stdout: string;
  let stderr: string;
  if (isTauri()) {
    const result = await invoke<WorkerProc>("run_worker", { args });
    stdout = result.stdout;
    stderr = result.stderr;
  } else {
    const res = await fetch("/api/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const json = (await res.json()) as Envelope<Record<string, unknown>>;
    stdout = JSON.stringify(json);
    stderr = String(json.error || "");
  }
  const parsed = parseJson(stdout, stderr) as Envelope<T>;
  if (!parsed.ok) {
    throw new Error(parsed.error || "worker failed");
  }
  return parsed;
}

export function onWorkerProgress(cb: (line: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<string>("worker-progress", (e) => cb(e.payload));
}

export const api = {
  paths: async () => {
    if (isTauri()) return invoke<{ cli: string; library: string }>("app_paths");
    const res = await fetch("/api/paths");
    return res.json() as Promise<{ cli: string; library: string }>;
  },

  init: () => runWorker(["init"]),

  list: () => runWorker<ListResult>(["list"]) as Promise<ListResult>,

  fieldMarks: (limit = 200) =>
    runWorker<{ marks: string[] }>(["field-marks", "--limit", String(limit)]),

  setVerdict: (id: string, verdict: string) =>
    runWorker(["set-verdict", "--id", id, "--verdict", verdict]),

  set: (
    id: string,
    fields: {
      stars?: number;
      favorite?: number;
      color?: string;
      location?: string;
      animal_type?: string;
      field_marks?: string;
    },
  ) => {
    const args = ["set", "--id", id];
    if (fields.stars !== undefined) args.push("--stars", String(fields.stars));
    if (fields.favorite !== undefined) args.push("--favorite", String(fields.favorite));
    if (fields.color !== undefined) args.push("--color", fields.color);
    if (fields.location !== undefined) args.push("--location", fields.location);
    if (fields.animal_type !== undefined) args.push("--animal-type", fields.animal_type);
    if (fields.field_marks !== undefined) args.push("--field-marks", fields.field_marks);
    return runWorker<{ shot: Shot }>(args);
  },

  setLocation: (id: string, location: string) =>
    runWorker<{ shot: Shot }>(["set-location", "--id", id, "--location", location]),

  setLocationByDate: (date: string, location: string) =>
    runWorker<{ count: number; date: string; location: string; geocoded?: boolean; geocode_error?: string }>([
      "set-location-by-date",
      "--date",
      date,
      "--location",
      location,
    ]),

  identify: (
    id: string,
    fields?: {
      commonName?: string;
      scientificName?: string;
      confidence?: number;
      fieldMarks?: string;
      animalType?: string;
    },
  ) => {
    const args = ["identify", "--id", id];
    if (fields?.commonName) args.push("--common-name", fields.commonName);
    if (fields?.scientificName) args.push("--scientific-name", fields.scientificName);
    if (fields?.confidence !== undefined) args.push("--confidence", String(fields.confidence));
    if (fields?.fieldMarks !== undefined) args.push("--field-marks", fields.fieldMarks);
    if (fields?.animalType) args.push("--animal-type", fields.animalType);
    return runWorker<{ shot: Shot }>(args);
  },

  setKey: (value: string) => runWorker<{ has_xai_key: boolean }>(["set-key", "--value", value]),

  keyStatus: () =>
    runWorker<{
      has_xai_key: boolean;
      backend?: string;
      ollama_model?: string;
      ollama_url?: string;
    }>(["key-status"]),

  setIdentify: (fields: { backend?: string; model?: string; url?: string }) => {
    const args = ["set-identify"];
    if (fields.backend) args.push("--backend", fields.backend);
    if (fields.model) args.push("--model", fields.model);
    if (fields.url) args.push("--url", fields.url);
    return runWorker<{
      has_xai_key: boolean;
      backend: string;
      ollama_model: string;
      ollama_url: string;
    }>(args);
  },

  bursts: () => runWorker<{ bursts: BurstPick[] }>(["bursts"]),

  pendingDeletes: (verdict = "reject") =>
    runWorker<DiskResult>(["pending-deletes", "--verdict", verdict]),

  deleteOriginals: (ids: string[], execute: boolean) => {
    const args = ["delete-originals", "--ids", ids.join(","), "--confirm", "DELETE_ORIGINALS"];
    if (execute) args.push("--execute");
    return runWorker<DiskResult>(args);
  },

  offloadOriginals: (ids: string[], execute: boolean) => {
    const args = ["offload-originals", "--ids", ids.join(","), "--confirm", "OFFLOAD_ORIGINALS"];
    if (execute) args.push("--execute");
    return runWorker<DiskResult>(args);
  },

  importSource: (source: string) => runWorker(["import", "--source", source]),

  refreshPreviews: () => runWorker(["refresh-previews"]),
  audit: (limit = 200) => runWorker<{ entries: any[] }>(["audit", "--limit", String(limit)]),
};
