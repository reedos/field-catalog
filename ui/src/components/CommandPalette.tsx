import { useEffect, useMemo, useState } from "react";
import type { View, ViewState } from "../types";

type PaletteItem =
  | { kind: "view"; id: View; label: string }
  | { kind: "history"; label: string; state: ViewState; index: number };

export default function CommandPalette({
  history,
  historyIndex,
  onView,
  onJump,
  onClose,
}: {
  history: ViewState[];
  historyIndex: number;
  onView: (v: View) => void;
  onJump: (idx: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const el = document.getElementById("cmd-input") as HTMLInputElement | null;
    el?.focus();
  }, []);

  const views: { id: View; label: string }[] = useMemo(() => [
    { id: "library", label: "Library" },
    { id: "map", label: "Map" },
    { id: "bursts", label: "Bursts" },
    { id: "life", label: "Life list" },
    { id: "settings", label: "Settings" },
  ], []);

  const items: PaletteItem[] = useMemo(() => {
    const viewItems: PaletteItem[] = views.map(v => ({ kind: "view", id: v.id, label: v.label }));
    const histItems: PaletteItem[] = history.map((h, i) => {
      const label = `${views.find(v => v.id === h.view)?.label} · ${h.search || "all"} · ${h.animal || "any"} · ${h.location || "any"}`;
      return { kind: "history" as const, label, state: h, index: i };
    }).slice(-20).reverse();
    const all = [...viewItems, ...histItems];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(it => it.label.toLowerCase().includes(q));
  }, [views, history, query]);

  function doSelect(it: PaletteItem) {
    if (it.kind === "view") {
      onView(it.id);
    } else {
      onJump(it.index);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/80 flex items-start justify-center pt-24 p-4" onClick={onClose}>
      <div className="fc-card w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-bark flex items-center gap-2">
          <span className="text-bark/80">Ctrl+K</span>
          <input
            id="cmd-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to view or recent history…"
            className="flex-1 bg-transparent outline-none"
            onKeyDown={e => {
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="max-h-80 overflow-auto">
          {items.length === 0 ? (
            <div className="p-4 text-sm text-bark">No matches</div>
          ) : (
            <ul className="divide-y divide-bark">
              {items.map((it, idx) => (
                <li key={idx}>
                  <button
                    className="w-full text-left px-4 py-2 hover:bg-bark/10 flex items-center gap-3"
                    onClick={() => doSelect(it)}
                  >
                    <span className="text-sm">{it.kind === "view" ? "View" : "History"}</span>
                    <span className="flex-1">{it.label}</span>
                    {it.kind === "history" && it.index === historyIndex && (
                      <span className="text-xs text-bark">current</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-2 text-xs text-bark border-t border-bark">Press Esc to close</div>
      </div>
    </div>
  );
}
