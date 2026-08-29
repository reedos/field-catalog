export type AnimalType = "bird" | "mammal" | "herp" | "fish" | "invertebrate" | "other";
export type Verdict = "keep" | "reject" | "unrated";
export type OriginalStatus = "present" | "deleted" | "offloaded";
export type ColorLabel = "red" | "yellow" | "green" | "blue" | "purple";
export type View = "library" | "map" | "bursts" | "life" | "settings";
export type SortKey = "captured_at" | "created_at" | "stars" | "sharpness" | "species" | "location";

export type ViewState = {
  view: View;
  search: string;
  animal: AnimalType | "";
  location: string;
  starsMin: number;
  verdict: Verdict | "";
  needsId: boolean;
  sort: SortKey;
  day: string; // "" = all outings; else a capture day, YYYY-MM-DD
};

export interface Shot {
  id: string;
  original_path: string;
  preview_path: string;
  original_status: OriginalStatus;
  verdict: Verdict;
  captured_at: string;
  created_at: string;
  lat: number | null;
  lon: number | null;
  sharpness: number | null;
  quality: number | null;
  burst_id: string;
  common_name: string | null;
  scientific_name: string | null;
  animal_type: AnimalType | null;
  stars: number;
  location: string;
  favorite: boolean;
  color: string | null;
  display_name: string;
  camera: string;
  lens: string;
  iso: number | null;
  shutter: string | null;
  aperture: string | null;
  focal_length: string | null;
  bytes_original: number;
  confidence: number | null;
  field_marks: string[];
  similar_species: string[];
  notes: string;
  gps_from_file: boolean;
  life_list_pick?: boolean;
  preview_width: number | null;
  preview_height: number | null;
}

export interface ListResult {
  ok: boolean;
  count: number;
  verdicts: Record<string, number>;
  original_status: Record<string, number>;
  previews: string;
  shots: Shot[];
  truncated?: boolean;
}

export interface BurstPick {
  burst_id: string;
  count: number;
  unrated?: number;
  keep?: number;
  reject?: number;
  keep_id: string;
  sharpness: number | null;
  member_ids?: string[];
  reject_ids: string[];
}

export interface DiskFile {
  id: string;
  path?: string;
  original_path?: string;
  bytes?: number;
  preview_kept?: string;
  preview_path?: string;
  verdict?: string;
  error?: string;
}

export interface DiskResult {
  ok: boolean;
  dry_run?: boolean;
  action?: string;
  count: number;
  bytes: number;
  files: DiskFile[];
  errors?: { id: string; error: string }[];
  previews_kept?: boolean;
}

export interface Keymap {
  next: string;
  prev: string;
  keep: string;
  reject: string;
  unrated: string;
  favorite: string;
  color: string;
  loupe: string;
  search: string;
  close: string;
}

export const DEFAULT_KEYS: Keymap = {
  next: "j",
  prev: "k",
  keep: "p",
  reject: "x",
  unrated: "u",
  favorite: "f",
  color: "c",
  loupe: "l",
  search: "/",
  close: "Escape",
};

export const ANIMAL_TYPES: AnimalType[] = ["bird", "mammal", "herp", "fish", "invertebrate", "other"];
export const COLOR_CYCLE: Array<ColorLabel | ""> = ["", "red", "yellow", "green", "blue", "purple"];
