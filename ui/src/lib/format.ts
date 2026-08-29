export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDate(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.replace("T", " ");
  return d.toLocaleString();
}

export function fileName(path: string): string {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function starsLabel(n: number): string {
  const s = Math.max(0, Math.min(5, n || 0));
  return "★".repeat(s) + "☆".repeat(5 - s);
}

export function focusScore(shot: { sharpness: number | null; quality: number | null }): string {
  if (shot.quality != null) return String(Math.round(shot.quality > 1 ? shot.quality : shot.quality * 100));
  if (shot.sharpness != null) return shot.sharpness.toFixed(0);
  return "—";
}

export function sharpnessMeter(shot: { sharpness: number | null; quality: number | null }): number | null {
  if (shot.quality != null) return shot.quality > 1 ? shot.quality / 100 : shot.quality;
  if (shot.sharpness == null) return null;
  return Math.max(0, Math.min(1, shot.sharpness / 150));
}

export function fmtDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day || "Undated";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function captureDay(capturedAt: string | null | undefined): string {
  return (capturedAt || "").slice(0, 10);
}

/** Animal types are stored lowercase as an enum; they read better capitalised. */
export function animalLabel(t: string | null | undefined): string {
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
