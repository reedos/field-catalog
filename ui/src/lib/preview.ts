import { convertFileSrc } from "@tauri-apps/api/core";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function previewUrl(path: string): string {
  if (!path) return "";
  if (!isTauri()) return `/api/file?path=${encodeURIComponent(path)}`;
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}
