import { Fragment } from "react";
import type { Keymap, View } from "../types";

const VIEW_HINTS: Record<View, { action: string; hint: string }[]> = {
  library: [
    { action: "Navigate", hint: "j/k or ↑/↓" },
    { action: "Open detail", hint: "Enter or click" },
    { action: "Toggle loupe", hint: "l" },
  ],
  map: [
    { action: "Focus search", hint: "/" },
    { action: "Close detail", hint: "Escape" },
  ],
  bursts: [
    { action: "Open burst", hint: "Enter" },
    { action: "Apply keep", hint: "p" },
  ],
  life: [
    { action: "Search species", hint: "/" },
    { action: "Open library", hint: "Enter" },
  ],
  settings: [
    { action: "Save changes", hint: "Enter" },
    { action: "Close", hint: "Escape" },
  ],
};

export default function ShortcutsOverlay({ keys, view, onClose }: { keys: Keymap; view: View; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/90 flex items-center justify-center p-8" onClick={onClose}>
      <div className="bg-paper text-ink rounded p-6 max-w-lg w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-serif">Keyboard shortcuts</h3>
          <span className="text-xs text-bark">Press ? to toggle • Esc to close</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="font-medium text-bark">Action</div>
          <div className="font-medium text-bark">Key</div>
          {[
            ["Next", keys.next],
            ["Previous", keys.prev],
            ["Keep", keys.keep],
            ["Reject", keys.reject],
            ["Unrated", keys.unrated],
            ["Favorite", keys.favorite],
            ["Color", keys.color],
            ["Loupe", keys.loupe],
            ["Search", keys.search],
            ["Close", keys.close],
          ].map(([a, k]) => (
            <Fragment key={String(a)}>
              <div className="text-paper-dim">{a}</div>
              <div className="font-mono">{String(k)}</div>
            </Fragment>
          ))}
        </div>
        {VIEW_HINTS[view] && (
          <div className="mt-6 pt-4 border-t border-bark">
            <div className="text-sm font-medium text-bark mb-2">View-specific hints — {view}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {VIEW_HINTS[view].map((h) => (
                <Fragment key={h.action}>
                  <div className="text-paper-dim">{h.action}</div>
                  <div>{h.hint}</div>
                </Fragment>
              ))}
            </div>
          </div>
        )}
        <button className="mt-6 text-sm text-bark hover:text-ink" onClick={onClose}>Esc to close</button>
      </div>
    </div>
  );
}
