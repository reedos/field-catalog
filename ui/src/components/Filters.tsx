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
  sort: SortKey;
  onSort: (v: SortKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-bark px-4 py-2 bg-ink/80">
      <input
        ref={props.searchRef}
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
        placeholder="Search  /"
        className="bg-charcoal border border-bark px-2 py-1 text-sm w-52 outline-none focus:border-moss"
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
        value={props.location}
        onChange={(e) => props.onLocation(e.target.value)}
        className="bg-charcoal border border-bark px-2 py-1 text-sm"
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
        className="bg-charcoal border border-bark px-2 py-1 text-sm"
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
        className="bg-charcoal border border-bark px-2 py-1 text-sm"
      >
        <option value="">Any verdict</option>
        <option value="unrated">Unrated</option>
        <option value="keep">Keep</option>
        <option value="reject">Reject</option>
      </select>
      <select
        value={props.sort}
        onChange={(e) => props.onSort(e.target.value as SortKey)}
        className="bg-charcoal border border-bark px-2 py-1 text-sm ml-auto"
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
      className={`px-2 py-1 text-xs capitalize border ${
        props.active ? "border-moss bg-moss/20 text-paper" : "border-bark text-paper-dim"
      }`}
    >
      {props.children}
    </button>
  );
}
