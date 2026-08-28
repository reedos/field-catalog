import { fmtDay } from "../lib/format";
import type { ReactNode, RefObject } from "react";
import { ANIMAL_TYPES, type AnimalType, type SortKey, type Verdict } from "../types";

export default function Filters(props: {
  needsId: boolean;
  onNeedsId: (v: boolean) => void;
  search: string;
  searchRef: RefObject<HTMLInputElement>;
  onSearch: (v: string) => void;
  animal: AnimalType | "";
  onAnimal: (v: AnimalType | "") => void;
  location: string;
  locations: string[];
  onLocation: (v: string) => void;
  starsMin: number;
  onStarsMin: (v: number) => void;
  verdict: Verdict | "";
  onVerdict: (v: Verdict | "") => void;
  day: string;
  outings: { day: string; count: number; unrated: number }[];
  onDay: (v: string) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-bark px-4 py-2 bg-ink/80">
      <input
        ref={props.searchRef}
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
        placeholder="Search…"
        className="fc-input w-52"
      />
      <div className="flex gap-1">
        <Pill active={props.animal === ""} onClick={() => props.onAnimal("")}>
          All
        </Pill>
        <Pill active={props.needsId} onClick={() => props.onNeedsId(!props.needsId)}>
          Needs ID
        </Pill>
        {ANIMAL_TYPES.map((t) => (
          <Pill key={t} active={props.animal === t} onClick={() => props.onAnimal(t)}>
            {t}
          </Pill>
        ))}
      </div>
      <select
        value={props.day}
        onChange={(e) => props.onDay(e.target.value)}
        className="fc-select"
        aria-label="Outing"
      >
        <option value="">All outings</option>
        {props.outings.map((o) => (
          <option key={o.day} value={o.day}>
            {fmtDay(o.day)} · {o.count}{o.unrated ? ` (${o.unrated} unrated)` : ""}
          </option>
        ))}
      </select>
      <select
        value={props.location}
        onChange={(e) => props.onLocation(e.target.value)}
        className="fc-select"
      >
        <option value="">Any place</option>
        <option value="__none__">Unlabeled</option>
        {props.locations.map((loc) => (
          <option key={loc} value={loc}>
            {loc}
          </option>
        ))}
      </select>
      <select
        value={props.starsMin}
        onChange={(e) => props.onStarsMin(Number(e.target.value))}
        className="fc-select"
      >
        <option value={0}>Any stars</option>
        <option value={1}>1+</option>
        <option value={2}>2+</option>
        <option value={3}>3+</option>
        <option value={4}>4+</option>
        <option value={5}>5</option>
      </select>
      <select
        value={props.verdict}
        onChange={(e) => props.onVerdict(e.target.value as Verdict | "")}
        className="fc-select"
      >
        <option value="">Any verdict</option>
        <option value="unrated">Unrated</option>
        <option value="keep">Keep</option>
        <option value="reject">Reject</option>
      </select>
      <select
        value={props.sort}
        onChange={(e) => props.onSort(e.target.value as SortKey)}
        className="fc-select ml-auto"
      >
        <option value="captured_at">Captured date</option>
        <option value="created_at">Import date</option>
        <option value="stars">Stars</option>
        <option value="sharpness">Sharpness</option>
        <option value="species">Species</option>
        <option value="location">Location</option>
      </select>
    </div>
  );
}

function Pill(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors duration-150 ${
        props.active
          ? "border-moss bg-moss/25 text-paper"
          : "border-bark text-paper-dim hover:border-moss/60 hover:text-paper"
      }`}
      aria-pressed={props.active}
    >
      {props.children}
    </button>
  );
}
