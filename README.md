# Field Catalog worker

Local catalog for the desktop app. **Previews live in the library. Originals stay on disk until you confirm unlink.**

Reject does not delete. Offload is the same unlink with a different confirm string, after you have copied keepers to the cloud.

Repo: https://github.com/reedos/field-catalog-worker  
Paste-ready desktop prompt: [DESKTOP_PROMPT.md](DESKTOP_PROMPT.md)

## Install

```bash
git clone https://github.com/reedos/field-catalog-worker.git
cd field-catalog-worker
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
# optional, better NEF thumbs: pip install -e ".[raw]"
# optional, better NEF EXIF: install exiftool
```

Library default: `~/FieldCatalog/` (`catalog.sqlite` + `previews/*.jpg`).

## CLI (JSON on stdout)

```bash
fieldcatalog --library ~/FieldCatalog init
fieldcatalog --library ~/FieldCatalog import --source /path/to/card
fieldcatalog --library ~/FieldCatalog list
fieldcatalog --library ~/FieldCatalog set-verdict --id <id> --verdict reject
fieldcatalog --library ~/FieldCatalog bursts
fieldcatalog --library ~/FieldCatalog identify --id <id> --common-name "House Sparrow" --scientific-name "Passer domesticus"

# 1) see what would be unlinked
fieldcatalog --library ~/FieldCatalog pending-deletes --verdict reject

# 2) dry-run (default)
fieldcatalog --library ~/FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS

# 3) actually unlink originals; previews remain
fieldcatalog --library ~/FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS --execute

# keepers already copied to cloud
fieldcatalog --library ~/FieldCatalog offload-originals --ids id1 --confirm OFFLOAD_ORIGINALS --execute
```

Every command prints `{"ok": true|false, ...}`. Tauri should parse stdout JSON only.

## Rules the UI must not violate

- Never call `--execute` without showing `files` from a dry-run first.
- Confirm strings are exact: `DELETE_ORIGINALS` / `OFFLOAD_ORIGINALS`.
- Worker refuses to unlink previews, the sqlite file, or a missing original.
- GPS is file metadata only. No default city.

## Tests

```bash
pip install -e ".[dev]"
pytest -q
```
