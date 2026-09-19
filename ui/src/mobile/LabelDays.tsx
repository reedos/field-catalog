import { useEffect, useMemo, useState } from "react";
import { fmtDay } from "../lib/format";
import { useStore } from "./store";
import { Chip, Empty, Sheet, TopBar } from "./ui";

/**
 * Naming a whole day's shooting at once. Most outings are one place, and most
 * frames carry no GPS, so this is the fastest way to put a library on the map.
 * Frames that do have the camera's GPS keep it: they only take the name.
 */
export function LabelDaySheet(props: { day: string | null; onClose: () => void }) {
  const store = useStore();
  const [place, setPlace] = useState("");
  const [saving, setSaving] = useState(false);

  const info = useMemo(() => {
    if (!props.day) return null;
    const list = store.shots.filter((s) => (s.captured_at || "").slice(0, 10) === props.day);
    const places = new Map<string, number>();
    for (const s of list) places.set(s.location || "", (places.get(s.location || "") || 0) + 1);
    return {
      count: list.length,
      withGps: list.filter((s) => s.gps_from_file).length,
      places: [...places.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [props.day, store.shots]);

  useEffect(() => {
    if (!info) return;
    const named = info.places.find(([name]) => name);
    setPlace(named ? named[0] : "");
  }, [props.day]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!props.day || !info) return <Sheet open={false} onClose={props.onClose}>{null}</Sheet>;
  const already = info.places.filter(([name]) => name);
  const overwrites = already.filter(([name]) => name !== place.trim()).reduce((n, [, c]) => n + c, 0);

  return (
    <Sheet open onClose={props.onClose} title={`Where was ${fmtDay(props.day)}?`}>
      <p className="text-sm leading-relaxed text-paper-dim">
        This names all {info.count} frames from that day.
        {info.withGps ? ` ${info.withGps} of them carry the camera's GPS and keep it; they only take the name.` : ""}
      </p>
      {already.length ? (
        <div className="mt-3">
          <p className="mb-1 text-xs text-paper-dim/70">Already on this day</p>
          <div className="flex flex-wrap gap-1.5">
            {already.map(([name, n]) => (
              <Chip key={name} active={place.trim() === name} onClick={() => setPlace(name)}>{name} · {n}</Chip>
            ))}
          </div>
        </div>
      ) : null}
      <label className="m-label" htmlFor="m-dayplace">Place</label>
      <input id="m-dayplace" className="m-input" list="m-places-day" value={place} onChange={(e) => setPlace(e.target.value)}
             placeholder="Wengen, Switzerland" autoCapitalize="words" enterKeyHint="done" />
      <datalist id="m-places-day">{store.locations.map((l) => <option key={l} value={l} />)}</datalist>
      <p className="mt-1.5 text-xs leading-snug text-paper-dim/70">
        Add the country if the name is not unique: plain "Wengen" is a village in Italy as well.
      </p>
      {overwrites ? (
        <p className="mt-3 rounded-lg border border-ochre/40 bg-ochre/10 px-3 py-2 text-xs leading-snug text-ochre">
          {overwrites} frame{overwrites === 1 ? "" : "s"} from this day already {overwrites === 1 ? "has" : "have"} a different place, which this replaces.
        </p>
      ) : null}
      <button type="button" className="m-btn m-btn-keep m-btn-block mt-4" disabled={!place.trim() || saving}
              onClick={async () => {
                setSaving(true);
                const n = await store.labelDay(props.day!, place.trim());
                setSaving(false);
                if (n) props.onClose();
              }}>
        {saving ? "Labelling…" : `Label ${info.count} frames`}
      </button>
    </Sheet>
  );
}

/** Every shooting day, with what it is called so far: the unnamed ones first. */
export function LabelDays(props: { onBack: () => void; onPick: (day: string) => void }) {
  const { outings } = useStore();
  const [onlyBare, setOnlyBare] = useState(true);
  const days = useMemo(() => outings.filter((o) => o.day && (!onlyBare || o.unplaced > 0)), [outings, onlyBare]);
  const bare = outings.filter((o) => o.day && o.unplaced > 0).length;

  return (
    <div className="m-screen">
      <TopBar title="Label days" sub={bare ? `${bare} shooting days have frames with no place` : "Every frame has a place"} onBack={props.onBack} />
      <div className="flex flex-none gap-2 border-b border-bark/50 px-4 py-2.5">
        <Chip active={onlyBare} tone="ochre" onClick={() => setOnlyBare(true)}>Without a place</Chip>
        <Chip active={!onlyBare} onClick={() => setOnlyBare(false)}>All days</Chip>
      </div>
      {days.length ? (
        <div className="m-scroll">
          {days.map((o) => (
            <button key={o.day} type="button" className="m-row" onClick={() => props.onPick(o.day)}>
              <span className="min-w-0 flex-1 text-left">
                <span className="block font-serif text-[16px] text-paper">{fmtDay(o.day)}</span>
                <span className="block truncate text-xs text-paper-dim/75">
                  {o.count} frames · {o.places.length ? o.places.join(", ") : "no place yet"}
                  {o.unplaced && o.places.length ? ` · ${o.unplaced} unnamed` : ""}
                </span>
              </span>
              <span className="text-paper-dim/50">›</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty title="Every day is named">Nothing left to label.</Empty>
      )}
    </div>
  );
}
