import type { View, ViewState } from "../types";

const ITEMS: { id: View; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "map", label: "Map" },
  { id: "bursts", label: "Bursts" },
  { id: "life", label: "Life list" },
  { id: "guide", label: "Guide" },
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
  onExport: () => void;
  onSlideshow: () => void;
  onIdentifySeries: () => void;
  onCancelIdentify: () => void;
  identifyingSeries: boolean;
  busy: string;
  onBulkLocation?: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-bark bg-charcoal px-4 py-2">
      <div className="flex items-center gap-1">
        {props.onBack ? (
          <button
            type="button"
            onClick={props.onBack}
            className="fc-btn fc-ghost px-2"
            title={props.backTo ? `Back to ${props.backTo}` : "Back (Alt+←)"}
            disabled={!props.canGoBack}
          >
            ←
          </button>
        ) : null}
        {props.onForward ? (
          <button
            type="button"
            onClick={props.onForward}
            className="fc-btn fc-ghost px-2"
            title="Forward (Alt+→)"
            disabled={!props.canGoForward}
          >
            →
          </button>
        ) : null}
      </div>

      <div className="font-serif text-lg tracking-[0.06em] text-paper">
        Field <span className="text-ochre">Catalog</span>
      </div>

      <nav className="ml-3 flex gap-0.5 rounded-lg border border-bark bg-ink/50 p-0.5">
        {ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => props.onView(item.id)}
            aria-current={props.view === item.id ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-sm transition-colors duration-150 ${
              props.view === item.id
                ? "bg-moss text-paper shadow-sm"
                : "text-paper-dim hover:bg-bark/50 hover:text-paper"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {props.busy ? (
          <span className="flex items-center gap-1.5 text-xs text-ochre">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ochre" />
            {props.busy}
          </span>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (props.identifyingSeries) props.onCancelIdentify();
            else props.onIdentifySeries();
          }}
          className={`fc-btn ${props.identifyingSeries ? "fc-warn" : "fc-accent"}`}
        >
          {props.identifyingSeries ? "Stop identify" : "Identify series"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onBulkLocation?.();
          }}
          className="fc-btn fc-accent"
        >
          Bulk location
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onImport();
          }}
          className="fc-btn border-moss bg-moss text-paper hover:bg-moss-dark hover:border-moss-dark"
        >
          Import folder
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onSlideshow();
          }}
          className="fc-btn fc-ghost"
          title="Full-screen review of the keepers in view"
        >
          Slideshow
        </button>
        <span className="mx-0.5 h-5 w-px bg-bark" aria-hidden />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onDelete();
          }}
          className="fc-btn fc-danger"
        >
          Delete rejected
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onExport();
          }}
          className="fc-btn fc-warn"
        >
          Export keepers
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onOffload();
          }}
          className="fc-btn fc-warn"
        >
          Offload keepers
        </button>
      </div>
    </header>
  );
}
