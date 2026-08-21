# Paste this entire file into Kilo / Cursor on the photographer's PC.

You are building **Field Catalog Desktop** in **this repo** (`field-catalog-worker`).

Do **not** fetch `https://github.com/reedos/field-catalog-worker` (it is private; a 404 is normal). Work only on the local files. Do **not** look for an existing React Field Catalog app — it is not in this repo. The Grok web preview is a different sandbox. **Create the UI here.**

Do not use Electron. Do not add accounts. Do not invent GPS / a default location.

## What already exists (Python worker)

Package root = this repo. CLI: `fieldcatalog` (venv at `.venv`).

- Library: `%USERPROFILE%\FieldCatalog\` → `catalog.sqlite` + `previews\{id}.jpg`
- Originals stay on disk; `original_status` = `present` | `deleted` | `offloaded`
- Reject ≠ delete
- All CLI stdout is JSON `{ "ok": true|false, ... }`

```text
fieldcatalog --library %USERPROFILE%\FieldCatalog init
fieldcatalog --library %USERPROFILE%\FieldCatalog import --source <folder>
fieldcatalog --library %USERPROFILE%\FieldCatalog list --summary
fieldcatalog --library %USERPROFILE%\FieldCatalog list --limit 50
fieldcatalog --library %USERPROFILE%\FieldCatalog set-verdict --id <id> --verdict keep|reject|unrated
fieldcatalog --library %USERPROFILE%\FieldCatalog identify --id <id> --common-name "..." --scientific-name "..."
fieldcatalog --library %USERPROFILE%\FieldCatalog bursts
fieldcatalog --library %USERPROFILE%\FieldCatalog pending-deletes --verdict reject
fieldcatalog --library %USERPROFILE%\FieldCatalog refresh-previews
fieldcatalog --library %USERPROFILE%\FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS
fieldcatalog --library %USERPROFILE%\FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS --execute
fieldcatalog --library %USERPROFILE%\FieldCatalog offload-originals --ids id1,id2 --confirm OFFLOAD_ORIGINALS --execute
```

On Windows, spawn `.venv\Scripts\fieldcatalog.exe` (or `python -m fieldcatalog`) with `--library` set to the user's FieldCatalog folder. Parse stdout JSON only. Progress lines may appear on stderr (`refresh 50/3500`).

## What to create

1. **`ui/`** — Vite + React + TypeScript + Tailwind. Quiet field-journal UI (charcoal / warm paper / moss-green accent). Not a SaaS dashboard.
   - Library grid of previews from `list` (image = `preview_path` on disk)
   - Detail / full-size viewer
   - Burst pick from `bursts`
   - Filters: animal type (mutually exclusive: bird / mammal / herp / fish / invertebrate / other), location label, stars
   - Sort: captured date, import date, stars, sharpness, species, location
   - Keyboard cull (customizable in Settings): J/K next-prev, P keep, X reject, U unrated, F favorite, C color, L loupe, `/` search, Esc close
   - Map: interactive world map, pins from file GPS only; user can edit **place name** without moving GPS that came from EXIF
   - Import: OS folder picker → `import --source`
   - Delete rejected originals: `pending-deletes` → dry-run list (paths + sizes) → user confirms → `--execute --confirm DELETE_ORIGINALS`
   - Offload keepers: same with `OFFLOAD_ORIGINALS` after user says cloud copy is done
   - Previews always remain. Never unlink files inside `previews\`.

2. **Tauri 2** shell around `ui/`. Folder picker, spawn the Python CLI, confirm dialogs for disk unlink.

GPS is file metadata only. A typed location is a **label**. Do not default any city.

Import copies nothing except a compressed preview into the library. NEF: embedded JPEG only.

## Delete / offload (load-bearing)

1. Reject only sets `verdict=reject`.
2. Dry-run first (omit `--execute`). Show paths, sizes, count.
3. User confirms.
4. Then `--execute` with the exact string `DELETE_ORIGINALS` or `OFFLOAD_ORIGINALS`.
5. Worker refuses wrong confirm, preview files, sqlite, missing originals.

## Do not

- Accounts, social, comments
- Auto-identify on import
- Auto-delete on reject
- Default location
- Electron
- `git clone` this GitHub URL
- Move originals into the app library

## Done when

A folder of D850 JPEG/NEF imports (catalog may already have ~3500 shots), library shows previews with correct orientation, cull keys update verdicts, dry-run lists real paths, confirm unlinks originals, previews still open.
