import { DEFAULT_KEYS, type Keymap } from "../types";

const STORAGE = "fieldcatalog.keymap";

export function loadKeys(): Keymap {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return { ...DEFAULT_KEYS };
    return { ...DEFAULT_KEYS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

export function saveKeys(keys: Keymap): void {
  localStorage.setItem(STORAGE, JSON.stringify(keys));
}

/**
 * What to print on a key cap. Arrow keys are named "ArrowRight" in the DOM and
 * nobody has that written on their keyboard.
 */
const LABELS: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  " ": "Space",
};

export function keyLabel(k: string): string {
  return LABELS[k] ?? k;
}

export function eventKey(e: KeyboardEvent): string {
  if (e.key === "Escape" || e.key === "/" || e.key.length > 1) return e.key;
  return e.key.toLowerCase();
}

export function matches(e: KeyboardEvent, wanted: string): boolean {
  // Cull keys are bare keys. Without this, Ctrl+X rejects the selected shot
  // and Ctrl+F toggles favorite instead of doing what the user meant.
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (wanted === "Escape") return e.key === "Escape";
  if (wanted === "/") return e.key === "/";
  return e.key.toLowerCase() === wanted.toLowerCase();
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
