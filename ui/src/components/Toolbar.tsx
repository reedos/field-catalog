import type { View, ViewState } from "../types";

const ITEMS: { id: View; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "map", label: "Map" },
  { id: "bursts", label: "Bursts" },
  { id: "life", label: "Life list" },
  { id: "settings", label: "Settings" },
];

export default function Toolbar(props: {
  view: View;
  onView: (v: View) => void;
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  history?: ViewState[];
  historyIndex?: number;
  onJump?: (idx: number) => void;
  backTo?: string;
  onImport: () => void;
  onDelete: () => void;
  onOffload: () => void;
  onIdentifySeries: () => void;
  onCancelIdentify: () => void;
  identifyingSeries: boolean;
  busy: string;
  onBulkLocation?: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-bark px-4 py-2 bg-charcoal">
      <div className="flex items-center gap-3">
        {props.onBack ? (
          <button
            type="button"
            onClick={props.onBack}
            className="px-2 py-1 text-sm border border-bark text-paper-dim hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed"
            title="Back"
            disabled={!props.canGoBack}
          >
            ← Back
          </button>
        ) : null}
        {props.canGoBack && props.backTo ? (
          <span className="text-xs text-paper-dim max-w-[180px] truncate" title={`Back to ${props.backTo}`}>
            to {props.backTo}
          </span>
        ) : null}
        {props.onForward ? (
          <button
            type="button"
            onClick={props.onForward}
            className="px-2 py-1 text-sm border border-bark text-paper-dim hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed"
            title="Forward"
            disabled={!props.canGoForward}
          >
            Forward →
          </button>
        ) : null}
      </div>
      <div className="font-serif text-lg tracking-wide text-paper">
        Field Catalog
      </div>
      <nav className="flex gap-1 ml-4">
        {ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => props.onView(item.id)}
            className={`px-3 py-1 text-sm rounded-sm ${
              props.view === item.id
                ? "bg-moss text-paper"
                : "text-paper-dim hover:text-paper"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {props.busy ? <span className="text-xs text-ochre">{props.busy}</span> : null}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (props.identifyingSeries) props.onCancelIdentify();
            else props.onIdentifySeries();
          }}
          className="px-3 py-1 text-sm border border-moss text-moss hover:bg-moss hover:text-paper"
        >
          {props.identifyingSeries ? "Stop identify" : "Identify series"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onBulkLocation?.();
          }}
          className="px-3 py-1 text-sm border border-moss text-moss hover:bg-moss hover:text-paper"
        >
          Bulk location
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onImport();
          }}
          className="px-3 py-1 text-sm border border-moss text-moss hover:bg-moss hover:text-paper"
        >
          Import folder
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onDelete();
          }}
          className="px-3 py-1 text-sm border border-reject/60 text-reject hover:bg-reject hover:text-paper"
        >
          Delete rejected
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            // quick preview of pending count
            // will open dialog in dry-run mode
            props.onDelete();
          }}
          className="px-3 py-1 text-sm border border-bark text-paper-dim hover:text-paper"
        >
          Pending
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onOffload();
          }}
          className="px-3 py-1 text-sm border border-ochre/60 text-ochre hover:bg-ochre hover:text-ink"
        >
          Offload keepers
        </button>
      </div>
    </header>
  );
}
