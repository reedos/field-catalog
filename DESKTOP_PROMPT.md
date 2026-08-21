# Paste this entire file into a local coding agent (Cursor, Grok, etc.) on the photographer's PC.

You are building **Field Catalog Desktop** — a local Tauri 2 app around an existing React cull UI and an existing Python worker. The user is a wildlife photographer (Nikon D850, 500mm). Storage on the SSD is tight; originals move to the cloud; the catalog must keep low-res previews forever.

Do not start from a blank photography app. Do not use Electron. Do not add accounts.

## Stack

- **UI:** existing Field Catalog React catalog (library, bursts, keys, map, life list, settings). Replace `localStorage` persistence with worker `list`.
- **Shell:** Tauri 2 (Rust). OS folder picker, spawn the Python CLI, show confirm dialogs for disk unlink.
- **Worker:** Python package in this repo (`fieldcatalog` CLI). Python 3.10+, venv at `.venv`. Optional: `exiftool` on PATH, `pip install rawpy`.
- **Library root:** `~/FieldCatalog/`
  - `catalog.sqlite`
  - `previews/{id}.jpg`  — app-owned, never deleted by offload/delete-originals

## Data model (sqlite row)

- `id`, `original_path`, `preview_path`
- `original_status`: `present` | `deleted` | `offloaded`
- `verdict`: `keep` | `reject` | `unrated`  (reject is not delete)
- EXIF: `captured_at`, `lat`, `lon`, `location` (empty unless IPTC/XMP in the file), camera/lens/iso/shutter/aperture/focal
- Cull: `stars`, `color`, `favorite`, `sharpness`, `burst_id`
- ID: `common_name`, `scientific_name`, `animal_type`

GPS is file metadata only. **Never invent a default city.** File GPS is ground truth; a typed place name is a label and must not move coordinates that came from EXIF.

## Worker CLI (JSON stdout only: `{ "ok": true|false, ... }`)

```text
fieldcatalog --library ~/FieldCatalog init
fieldcatalog --library ~/FieldCatalog import --source <folder>
fieldcatalog --library ~/FieldCatalog list [--verdict] [--status]
fieldcatalog --library ~/FieldCatalog set-verdict --id <id> --verdict keep|reject|unrated
fieldcatalog --library ~/FieldCatalog identify --id <id> --common-name "..." --scientific-name "..."
fieldcatalog --library ~/FieldCatalog bursts
fieldcatalog --library ~/FieldCatalog pending-deletes --verdict reject
fieldcatalog --library ~/FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS
fieldcatalog --library ~/FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS --execute
fieldcatalog --library ~/FieldCatalog offload-originals --ids id1,id2 --confirm OFFLOAD_ORIGINALS --execute
```

Import copies **nothing** except a compressed preview into `~/FieldCatalog/previews/`. NEF: embedded JPEG / rawpy thumb only — no full demosaic on import.

## Delete / offload rules (load-bearing)

1. Reject only sets `verdict=reject`. Original stays on disk.
2. UI must call **dry-run first** (omit `--execute`). Show path, size, count.
3. User explicitly confirms.
4. Then `--execute` with the **exact** confirm string:
   - delete rejected originals: `DELETE_ORIGINALS`
   - unlink keepers after cloud copy: `OFFLOAD_ORIGINALS`
5. Worker refuses: wrong confirm, preview files, sqlite, missing original, files inside the preview directory.
6. After unlink: `original_status` becomes `deleted` or `offloaded`. **Preview JPEG remains.** Catalog row remains.

## What to build in Tauri (order)

1. Install worker, `init`, folder picker → `import`.
2. Library grid from `list` + preview files.
3. Existing cull keys → `set-verdict`. Burst recommended → `bursts`.
4. Screen: Delete rejected originals = pending-deletes → dry-run list → confirm → execute.
5. Screen: Offload originals, same flow, keepers only, after user says cloud copy is done.
6. Optional: xAI species ID (user-initiated), then `identify`.

## Do not invent

- Accounts, social, comments, trips-required-on-import
- Auto-identify on import
- Auto-delete on reject
- Default location (no Westlake)
- Electron
- A new cull UI
- Moving originals into the app library

## Done when

A folder of D850 JPEG/NEF imports, culls in the existing UI, dry-run lists real paths/sizes, confirm unlinks originals, previews still open in the catalog, sqlite still has the rows.
