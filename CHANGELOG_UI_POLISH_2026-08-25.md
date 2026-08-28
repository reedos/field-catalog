# Field Catalog Desktop — High-Value Changes 2026-08-25

## UI Polish — Detail view
- Verdict buttons now show selection state with ring/highlight
- Stars rating visual feedback patched — ochre when active, consistent ★ rendering
- Favorite button: ★ Favorite / ☆ Favorite? with ochre active state
- Color button: ● color name in ochre when set, dim when none
- Animal type chips: selected chip gets ochre text + font-semibold
- Meter bars: rounded, gradient moss→ochre with smooth transition
- Field marks & similar species rendered as chips instead of lists

## UI Polish — Grid
- Hover preview: image scales 105% on hover
- Burst badge `B{n}` top-left when shot is in a burst
- Keyboard cheat-sheet overlay `?` showing all shortcuts

## Filters & Identify
- Needs ID filter pill added to Filters
- Batch identify with confidence gating: skips shots with confidence ≥0.9
- Filter logic updated to hide shots with common/scientific name when Needs ID active

## Backend — Catalog
- Migrations table added for safe schema upgrades
- SQLite indexes added: common_name, scientific_name, location, captured_at DESC
- `distinct_field_marks(limit)` method added
- CLI command `field-marks` exposed for live suggestions

## Disk Ops
- Audit log helper writes JSONL to `library/audit.jsonl`
- `unlink_originals` now logs successful delete/offload executions

## Map
- MapView clustering by ~0.5° grid cells
- Cluster markers sized by count, popup shows thumbnails + quick open

## Field Marks Autocomplete
- Datalist scaffolding in Detail view
- Hook `useFieldMarksSuggestions` fetches suggestions from worker
- Ready for live catalog suggestions via `/api/field-marks`

Files touched:
- ui/src/components/Detail.tsx
- ui/src/components/Grid.tsx
- ui/src/App.tsx
- ui/src/components/Filters.tsx
- ui/src/components/MapView.tsx
- src/fieldcatalog/catalog.py
- src/fieldcatalog/cli.py
- src/fieldcatalog/disk.py
