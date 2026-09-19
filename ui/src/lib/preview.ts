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

/**
 * A smaller copy of a preview, for grids. Only `fieldcatalog web` can resize, so
 * anywhere else this is just the preview: the desktop reads files from disk,
 * where the full preview costs nothing.
 */
export function thumbUrl(path: string, width: 320 | 480 | 800): string {
  if (!path) return "";
  if (isTauri()) return previewUrl(path);
  return `/api/file?path=${encodeURIComponent(path)}&w=${width}`;
}

/** A 1:1 region of the original, cut server-side. Web only. */
export function loupeUrl(id: string, cx: number, cy: number, size: number): string {
  return `/api/loupe?id=${encodeURIComponent(id)}&cx=${cx.toFixed(4)}&cy=${cy.toFixed(4)}&size=${Math.round(size)}`;
}
