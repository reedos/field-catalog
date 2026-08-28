import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import type { Shot } from "../types";
import { api } from "../lib/worker";

type Props = {
  open: boolean;
  shots: Shot[];
  onClose: () => void;
  onApplied: (count: number) => void;
};

function dayKey(capturedAt: string): string {
  return (capturedAt || "").replace(/\//g, "-").replace(" ", "T").slice(0, 10);
}

export default function BulkLocationModal({ open, shots, onClose, onApplied }: Props) {
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const s of shots) {
      const d = dayKey(s.captured_at);
      if (d.length === 10) set.add(d);
    }
    return [...set].sort().reverse();
  }, [shots]);

  useEffect(() => {
    if (!open) {
      setError("");
      setBusy(false);
    }
  }, [open]);

  const count = useMemo(() => {
    if (!date) return 0;
    return shots.filter((s) => dayKey(s.captured_at) === date).length;
  }, [shots, date]);

  async function apply() {
    if (!date || !location.trim()) {
      setError("Date and location required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.setLocationByDate(date, location.trim());
      if (res.geocode_error) {
        setError(`Labels saved. Map pin skipped: ${res.geocode_error}`);
        onApplied(res.count);
        return;
      }
      onApplied(res.count);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/80 flex items-center justify-center p-4" onClick={onClose}>
      <Panel>
        <h3 id="bulk-title" className="text-lg font-serif mb-2">Mass set location by date</h3>
        <p className="text-xs text-bark mb-4">
          Sets the place-name label for every photo captured that calendar day. File GPS is not moved. One geocode if needed.
        </p>
        <label className="block text-xs mb-1">Date</label>
        <select
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-charcoal text-paper border border-bark px-2 py-1 mb-3"
        >
          <option value="">Select date</option>
          {dates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label className="block text-xs mb-1">Location label</label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Place name"
          className="w-full bg-charcoal text-paper border border-bark px-2 py-1 mb-3"
        />
        {date ? (
          <div className="text-xs text-bark mb-3">
            {count} photo{count === 1 ? "" : "s"} on {date}
          </div>
        ) : null}
        {error ? <div className="text-xs text-reject mb-2">{error}</div> : null}
        <div className="flex gap-2 justify-end">
          <button type="button" className="px-3 py-1 border border-bark" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1 border border-moss text-moss disabled:opacity-50"
            onClick={() => void apply()}
            disabled={busy || !date || !location.trim() || count === 0}
          >
            {busy ? "Applying…" : `Apply to ${count} shots`}
          </button>
        </div>
      </Panel>
    </div>
  );
}

/** The dialog panel. Separate so its focus-trap hooks only run while open. */
function Panel({ children }: { children: ReactNode }) {
  const { dialogProps } = useModalDialog({ labelledBy: "bulk-title" });
  return (
    <div {...dialogProps} className="fc-card w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
