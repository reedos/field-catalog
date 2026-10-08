import { useEffect, useMemo, useState } from "react";
import { ANIMAL_TYPES } from "../types";
import { animalLabel, fmtBytes, fmtDate, titleCommon, titleScientific } from "../lib/format";
import { useStore } from "./store";
import { Chip, Meter, Sheet, Stars } from "./ui";

const COLORS: Record<string, string> = {
  red: "#b5523f", yellow: "#c9a545", green: "#6a7a52", blue: "#4f7396", purple: "#80609a",
};

/**
 * Everything you can say about one frame: what it is, where it was, how good it
 * is. The name and the place save when you press Save, not on blur -- a thumb
 * drifting off a field on a phone should not write to the catalog.
 */
export function DetailSheet(props: { id: string | null; onClose: () => void; onLabelDay: (day: string) => void }) {
  const store = useStore();
  const shot = props.id ? store.shotsById.get(props.id) : undefined;

  const [common, setCommon] = useState("");
  const [scientific, setScientific] = useState("");
  const [place, setPlace] = useState("");
  const [mark, setMark] = useState("");

  useEffect(() => {
    setCommon(shot?.common_name || "");
    setScientific(shot?.scientific_name || "");
    setPlace(shot?.location || "");
    setMark("");
    // when the frame changes, or the worker answers with corrected values
  }, [shot?.id, shot?.common_name, shot?.scientific_name, shot?.location]);

  const suggestions = useMemo(() => {
    const q = mark.trim().toLowerCase();
    if (!q || !shot) return [];
    return store.fieldMarkOptions.filter((m) => m.toLowerCase().includes(q) && !shot.field_marks.includes(m)).slice(0, 6);
  }, [mark, store.fieldMarkOptions, shot]);

  if (!shot) return <Sheet open={false} onClose={props.onClose}>{null}</Sheet>;

  const day = (shot.captured_at || "").slice(0, 10);
  const nameChanged = titleCommon(common) !== (shot.common_name || "") || titleScientific(scientific) !== (shot.scientific_name || "");
  const placeChanged = place.trim() !== (shot.location || "");
  const conf = shot.confidence == null ? null : shot.confidence > 1 ? shot.confidence / 100 : shot.confidence;
  const exif = [shot.aperture, shot.shutter, shot.iso ? `ISO ${shot.iso}` : "", shot.focal_length].filter(Boolean).join(" · ");

  function addMark(text: string) {
    const m = text.trim();
    if (!m || shot!.field_marks.includes(m)) return;
    void store.saveFieldMarks(shot!.id, [...shot!.field_marks, m]);
    setMark("");
  }

  return (
    <Sheet open onClose={props.onClose} tall title={shot.common_name || "Not identified yet"}>
      <p className="-mt-1 text-xs text-paper-dim/75">
        {[shot.display_name, fmtDate(shot.captured_at)].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-3 flex items-center justify-between">
        <Stars value={shot.stars || 0} onChange={(n) => store.setStars(shot.id, n)} size="lg" />
        <button type="button" className="m-round" onClick={() => store.cycleColor(shot.id)} aria-label="Colour label">
          <span className="block h-5 w-5 rounded-full border border-paper-dim/40"
                style={{ background: shot.color ? COLORS[shot.color] : "transparent" }} />
        </button>
      </div>

      {/* ---- what it is ---- */}
      <label className="m-label" htmlFor="m-common">Species</label>
      <input id="m-common" className="m-input" value={common} onChange={(e) => setCommon(e.target.value)}
             placeholder="Common name" autoCapitalize="words" autoCorrect="off" enterKeyHint="done" />
      <input className="m-input mt-2 italic" value={scientific} onChange={(e) => setScientific(e.target.value)}
             placeholder="Scientific name" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Scientific name" />
      {shot.similar_species.length ? (
        <div className="mt-2">
          <p className="mb-1 text-xs text-paper-dim/70">The model also considered</p>
          <div className="flex flex-wrap gap-1.5">
            {shot.similar_species.map((s) => (
              <Chip key={s} tone="ochre" onClick={() => { setCommon(s); setScientific(""); }}>{s}</Chip>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-2.5 flex gap-2">
        <button type="button" className="m-btn m-btn-keep flex-1" disabled={!nameChanged || !common.trim()}
                onClick={() => store.saveIdentity(shot.id, titleCommon(common), titleScientific(scientific))}>
          Save name
        </button>
        <button type="button" className="m-btn flex-1" disabled={store.identify.identifying}
                onClick={() => store.identify.runIdentify(shot.id)}>
          {store.identify.identifying ? "Asking the model…" : "Ask the model"}
        </button>
      </div>
      <div className="mt-3 space-y-1.5">
        <Meter label="ID confidence" value={conf} />
        {conf === 1 ? <p className="text-xs text-moss">You named this one yourself.</p> : null}
      </div>

      <p className="m-label">Kind of animal</p>
      <div className="flex flex-wrap gap-1.5">
        {ANIMAL_TYPES.map((t) => (
          <Chip key={t} active={shot.animal_type === t} onClick={() => store.setAnimalType(shot.id, t)}>{animalLabel(t)}</Chip>
        ))}
      </div>

      {/* ---- where it was ---- */}
      <label className="m-label" htmlFor="m-place">Place</label>
      <input id="m-place" className="m-input" list="m-places" value={place} onChange={(e) => setPlace(e.target.value)}
             placeholder="Huntington Beach Central Park" autoCapitalize="words" enterKeyHint="done" />
      <datalist id="m-places">{store.locations.map((l) => <option key={l} value={l} />)}</datalist>
      <p className="mt-1.5 text-xs leading-snug text-paper-dim/70">
        {shot.gps_from_file
          ? "This file has the camera's GPS, which a place name never overwrites."
          : "No GPS in this file, so the map will use the centre of the place you name."}
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="m-btn m-btn-keep flex-1" disabled={!placeChanged}
                onClick={() => store.setLocationLabel(shot.id, place.trim())}>
          Save place
        </button>
        {day ? (
          <button type="button" className="m-btn flex-1" onClick={() => props.onLabelDay(day)}>Label the whole day…</button>
        ) : null}
      </div>

      {/* ---- field marks ---- */}
      <p className="m-label">Field marks</p>
      <div className="flex flex-wrap gap-1.5">
        {shot.field_marks.map((m) => (
          <button key={m} type="button" className="m-chip m-chip-on-moss"
                  onClick={() => store.saveFieldMarks(shot.id, shot.field_marks.filter((x) => x !== m))}
                  aria-label={`Remove ${m}`}>
            <span className="max-w-[15rem] truncate">{m}</span><span className="text-paper-dim/60">×</span>
          </button>
        ))}
        {!shot.field_marks.length ? <p className="text-xs text-paper-dim/60">None yet.</p> : null}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="m-input" value={mark} onChange={(e) => setMark(e.target.value)} placeholder="Add a field mark"
               enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter") addMark(mark); }} aria-label="Add a field mark" />
        <button type="button" className="m-btn" disabled={!mark.trim()} onClick={() => addMark(mark)}>Add</button>
      </div>
      {suggestions.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => <Chip key={s} onClick={() => addMark(s)}>{s}</Chip>)}
        </div>
      ) : null}

      {shot.notes ? (
        <>
          <p className="m-label">Notes from the identification</p>
          <p className="text-sm leading-relaxed text-paper-dim">{shot.notes}</p>
        </>
      ) : null}

      {/* ---- the frame itself ---- */}
      <p className="m-label">The frame</p>
      <div className="space-y-1.5 text-sm text-paper-dim">
        {exif ? <p>{exif}</p> : null}
        <p>{[shot.camera, shot.lens].filter(Boolean).join(" · ") || "No camera data"}</p>
        <p className="text-xs text-paper-dim/70">
          Original {shot.original_status}{shot.bytes_original ? ` · ${fmtBytes(shot.bytes_original)}` : ""}
        </p>
        <Meter label="Sharpness" value={shot.sharpness == null ? null : Math.min(1, shot.sharpness / 150)} />
      </div>

      <div className="mt-5 space-y-2">
        {shot.common_name ? (
          <button type="button" className="m-btn m-btn-block"
                  onClick={() => store.setLifeListPick(shot.id, !!shot.life_list_pick)}>
            {shot.life_list_pick ? "Stop using this frame on the life list" : "Use this frame on the life list"}
          </button>
        ) : null}
        {shot.common_name ? (
          <button type="button" className="m-btn m-btn-block m-btn-reject"
                  onClick={() => { if (window.confirm(`Clear the identification of this frame?`)) void store.clearIdentity(shot.id); }}>
            Clear the identification
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
