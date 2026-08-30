import { keyLabel } from "../lib/keys";
import { DEFAULT_KEYS, type Keymap } from "../types";
import { useState } from "react";

const LABELS: { key: keyof Keymap; label: string }[] = [
  { key: "next", label: "Next" },
  { key: "prev", label: "Previous" },
  { key: "keep", label: "Keep" },
  { key: "reject", label: "Reject" },
  { key: "unrated", label: "Unrated" },
  { key: "favorite", label: "Favorite" },
  { key: "color", label: "Color label" },
  { key: "loupe", label: "Loupe" },
  { key: "search", label: "Search" },
  { key: "close", label: "Close" },
];

export default function Settings(props: {
  onViewAudit: () => void;
  keys: Keymap;
  onKeys: (k: Keymap) => void;
  cli: string;
  library: string;
  hasXaiKey: boolean;
  xaiKeyDraft: string;
  onXaiKeyDraft: (v: string) => void;
  onSaveXaiKey: () => void;
  backend: "ollama" | "xai";
  ollamaModel: string;
  onBackend: (v: "ollama" | "xai") => void;
  onOllamaModel: (v: string) => void;
  onSaveIdentify: () => void;
  /** How many identified shots in the library still have no subject box. */
  subjectsMissing: number;
  onFindSubjects: () => void;
  onRefresh: () => void;
  onMassLocation?: (date: string, location: string) => Promise<void>;
}) {
  const [massDate, setMassDate] = useState("");
  const [massLocation, setMassLocation] = useState("");
  const [massBusy, setMassBusy] = useState(false);
  const [massError, setMassError] = useState("");
  return (
    <div className="fc-scroll h-full p-8 max-w-xl font-serif text-paper">
      <h2 className="text-2xl mb-2">Settings</h2>
      <p className="text-sm text-paper-dim mb-6">
        Local catalog only. No accounts. GPS is file metadata; a typed place is a label.
        Reject does not delete.
      </p>
      <h3 className="text-sm uppercase tracking-wide text-ochre mb-2">Cull keys</h3>
      <div className="space-y-2 mb-8">
        {LABELS.map((row) => (
          <label key={row.key} className="flex items-center justify-between gap-4 text-sm">
            <span>{row.label}</span>
            <input
              readOnly
              value={keyLabel(props.keys[row.key])}
              className="w-28 bg-charcoal border border-bark px-2 py-1 font-sans text-center"
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onKeys({ ...props.keys, [row.key]: e.key.length === 1 ? e.key.toLowerCase() : e.key });
              }}
            />
          </label>
        ))}
        <button
          className="text-sm text-moss mt-2"
          onClick={() => props.onKeys({ ...DEFAULT_KEYS })}
        >
          Restore defaults
        </button>
      </div>
      <h3 className="text-sm uppercase tracking-wide text-ochre mb-2">Identify</h3>
      <p className="text-xs text-paper-dim mb-2">
        User-clicked only, never on import. Local runs an Ollama vision model on this PC; xAI sends the preview to their API. Identification is optional — you can type species names in the detail panel instead.
      </p>
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          className={`px-3 py-1 text-sm border ${
            props.backend === "ollama" ? "border-moss bg-moss/20" : "border-bark"
          }`}
          onClick={() => props.onBackend("ollama")}
        >
          Local Ollama
        </button>
        <button
          type="button"
          className={`px-3 py-1 text-sm border ${
            props.backend === "xai" ? "border-moss bg-moss/20" : "border-bark"
          }`}
          onClick={() => props.onBackend("xai")}
        >
          xAI cloud
        </button>
      </div>
      <label className="block text-xs uppercase tracking-wide text-paper-dim mb-1">Ollama model</label>
      <input
        value={props.ollamaModel}
        onChange={(e) => props.onOllamaModel(e.target.value)}
        className="w-full bg-charcoal border border-bark px-2 py-1 font-sans text-sm mb-2"
      />
      <button
        type="button"
        className="px-3 py-1 border border-moss text-moss text-sm mb-6"
        onClick={props.onSaveIdentify}
      >
        Save identify settings
      </button>
      <h3 className="text-sm uppercase tracking-wide text-ochre mb-2">Subjects</h3>
      <p className="text-xs text-paper-dim mb-2">
        Identification can also record where in the frame the animal is, so sharpness is
        measured on the animal rather than on the whole picture — a soft bird in front of a
        crisp branch otherwise scores well. Shots identified before this existed have no
        subject recorded.
      </p>
      <button
        type="button"
        className="px-3 py-1 border border-moss text-moss text-sm mb-2 disabled:opacity-40"
        onClick={props.onFindSubjects}
        disabled={!props.subjectsMissing}
      >
        {props.subjectsMissing
          ? `Find subjects in ${props.subjectsMissing} shot${props.subjectsMissing === 1 ? "" : "s"}`
          : "Every identified shot has a subject"}
      </button>
      <p className="text-xs text-paper-dim mb-8">
        Re-runs identification on those shots, one at a time, and can be stopped at any point.
        The name and field marks are rewritten from the same answer.
      </p>
      <p className="text-xs text-paper-dim mb-2">
        xAI key (only if you pick cloud). Saved in the library folder, not the git repo.
        {props.hasXaiKey ? " A key is on disk." : " No key saved yet."}
      </p>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={props.xaiKeyDraft}
        onChange={(e) => props.onXaiKeyDraft(e.target.value)}
        placeholder={props.hasXaiKey ? "••••••••  (enter to replace)" : "XAI_API_KEY"}
        className="w-full bg-charcoal border border-bark px-2 py-1 font-sans text-sm mb-2"
      />
      <button
        type="button"
        className="px-3 py-1 border border-moss text-moss text-sm mb-8"
        onClick={props.onSaveXaiKey}
        disabled={!props.xaiKeyDraft.trim()}
      >
        Save key
      </button>
      <h3 className="text-sm uppercase tracking-wide text-ochre mb-2">Library</h3>
      <p className="text-xs break-all text-paper-dim mb-1">{props.library}</p>
      <p className="text-xs break-all text-paper-dim mb-4">{props.cli}</p>
      <button className="px-3 py-1 border border-moss text-moss text-sm" onClick={props.onRefresh}>
        Refresh previews
      </button>
      <button className="px-3 py-1 border border-bark text-paper-dim text-sm ml-2" onClick={props.onViewAudit}>
        View audit log
      </button>
      <p className="text-xs text-paper-dim mt-2">
        Rewrites catalog JPEGs from originals (orientation). Does not move originals.
      </p>
      <h3 className="text-sm uppercase tracking-wide text-ochre mb-2 mt-8">Mass location by date</h3>
      <p className="text-xs text-paper-dim mb-2">Set location label for all shots captured on a given date (captured_at).</p>
      <div className="flex gap-2 mb-2">
        <input
          type="date"
          value={massDate}
          onChange={(e) => setMassDate(e.target.value)}
          className="bg-charcoal border border-bark px-2 py-1 font-sans text-sm"
        />
        <input
          value={massLocation}
          onChange={(e) => setMassLocation(e.target.value)}
          placeholder="Location label"
          className="flex-1 bg-charcoal border border-bark px-2 py-1 font-sans text-sm"
        />
      </div>
      {massError && <div className="text-xs text-reject mb-2">{massError}</div>}
      <button
        type="button"
        className="px-3 py-1 border border-moss text-moss text-sm mb-6 disabled:opacity-50"
        disabled={massBusy || !massDate || !massLocation.trim() || !props.onMassLocation}
        onClick={async () => {
          setMassError("");
          if (!massDate || !massLocation.trim()) {
            setMassError("Date and location required");
            return;
          }
          setMassBusy(true);
          try {
            await props.onMassLocation!(massDate, massLocation.trim());
            setMassDate("");
            setMassLocation("");
          } catch (e) {
            setMassError(e instanceof Error ? e.message : String(e));
          } finally {
            setMassBusy(false);
          }
        }}
      >
        {massBusy ? "Applying…" : "Apply location to date"}
      </button>
    </div>
  );
}
