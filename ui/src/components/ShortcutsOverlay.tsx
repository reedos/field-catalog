import { Fragment } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import type { Keymap, View } from "../types";

const VIEW_HINTS: Record<View, { action: string; hint: string }[]> = {
  library: [
    { action: "Navigate", hint: "j/k or ↑/↓" },
    { action: "Open detail", hint: "Enter or click" },
    { action: "Toggle loupe", hint: "l" },
    { action: "Compare burst", hint: "COMPARE on a burst cell" },
  ],
  map: [
    { action: "Focus search", hint: "/" },
    { action: "Close detail", hint: "Escape" },
  ],
  bursts: [
    { action: "Open burst", hint: "Enter" },
    { action: "Apply keep", hint: "p" },
    { action: "Compare frames", hint: "Compare button" },
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
  const { dialogProps } = useModalDialog({ labelledBy: "shortcuts-title" });
  return (
    <div className="fixed inset-0 z-50 bg-ink/90 flex items-center justify-center p-8" onClick={onClose}>
      <div {...dialogProps} className="fc-card w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 id="shortcuts-title" className="text-lg font-serif">Keyboard shortcuts</h3>
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
            ["Open detail", "Enter"],
            ["Undo verdict", "Ctrl+Z"],
          ].map(([a, k]) => (
            <Fragment key={String(a)}>
              <div className="text-bark/80">{a}</div>
              <div className="font-mono">{String(k)}</div>
            </Fragment>
          ))}
        </div>
        <div className="mt-6 pt-4 border-t border-bark">
          <div className="text-sm font-medium text-bark mb-2">Compare view</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-bark/80">Focus frame</div><div>arrows or j/k</div>
            <div className="text-bark/80">Reject / keep / restore</div><div>x · p · u</div>
            <div className="text-bark/80">Keep focused, reject rest</div><div>Enter</div>
            <div className="text-bark/80">1:1 zoom, drag pans all</div><div>l or double-click</div>
          </div>
        </div>
        {VIEW_HINTS[view] && (
          <div className="mt-6 pt-4 border-t border-bark">
            <div className="text-sm font-medium text-bark mb-2">View-specific hints — {view}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {VIEW_HINTS[view].map((h) => (
                <Fragment key={h.action}>
                  <div className="text-bark/80">{h.action}</div>
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
