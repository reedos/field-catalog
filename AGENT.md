# Local agent brief — Field Catalog desktop

You are wrapping **existing React Field Catalog UI** in **Tauri 2** and calling this Python worker. Do not rewrite the cull UI.

## Worker contract

Package: `worker/` in the Field Catalog repo (`fieldcatalog` CLI).

- Library: `~/FieldCatalog/catalog.sqlite` + `~/FieldCatalog/previews/{id}.jpg`
- Originals: paths stored on each row; `original_status` = `present` | `deleted` | `offloaded`
- All CLI commands: JSON `{ ok, ... }` on stdout

Import does **not** move or copy the RAW/JPEG except writing a compressed preview into the library.

## Must implement in Tauri

1. Folder picker → `fieldcatalog import --source <dir>`
2. Library reads `list` + preview paths (`asset:` or copy to app cache)
3. Existing cull keys call `set-verdict`
4. **Delete rejected from disk**: show dry-run `files` + sizes, user types/clicks confirm, then `--execute --confirm DELETE_ORIGINALS`
5. **Offload keepers**: same with `OFFLOAD_ORIGINALS` after user says cloud copy is done
6. Previews always remain

## Do not

- Delete on reject
- Demosaic every NEF on import (embedded JPEG / rawpy thumb only)
- Put originals inside the preview folder
- Invent GPS / any default location
- Accounts, social, auto-ID on import
- Electron

## Optional

- `exiftool` on PATH for D850 NEF GPS
- `pip install rawpy` for thumbs
- Species ID: existing xAI identify, then `fieldcatalog identify --id --common-name --scientific-name`

## Stack

Tauri 2 + current React catalog. Replace localStorage with worker list. Python 3.10+ venv next to the app or in `worker/.venv`.
