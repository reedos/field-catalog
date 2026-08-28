# CLAUDE.md — Field Catalog

Local wildlife photo catalog. Three parts, one app:

- **Python worker** (`src/fieldcatalog/`) — a CLI that prints JSON. All catalog logic lives here.
  `fieldcatalog serve` is the persistent mode: one JSON request per stdin line
  (`{"id": N, "args": [...]}`), same envelope back plus the id. identify/import/refresh-previews run
  on a slow lane so verdicts stay instant. EOF on stdin is shutdown.
- **Rust/Tauri 2 shell** (`src-tauri/`) — holds one `serve` child and routes `run_worker(args)`
  through it by request id; falls back to one-shot spawning only if serve fails to *start* (never
  after a request was written — re-running a mutation is worse than an error).
- **React 18 + Vite + Tailwind UI** (`ui/`) — calls the shell; in browser dev the vite plugin holds
  its own `serve` child. Domain state lives in `ui/src/hooks/` (useShots, useDiskFlow, useIdentify,
  useViewHistory); App.tsx keeps view/filter/selection state, the keyboard handler, and layout.

Library data lives at `~/FieldCatalog/`: `catalog.sqlite`, `previews/{id}.jpg`, `audit.jsonl`,
`geocode-cache.json`, `xai.key`. Override with `$FIELDCATALOG_LIBRARY`.

## Commands

```
./.venv/Scripts/python.exe -m pytest -q      # the full suite must pass
pip install -e ".[dev]"                      # ".[raw]" adds rawpy for NEF thumbnails
npm install && npm --prefix ui install
npm run tauri -- dev             # full desktop app
npm --prefix ui run dev          # browser-only, vite plugin bridges to the CLI
npm --prefix ui run build        # tsc --noEmit && vite build
```

**Use the project `.venv`, not the system Python.** Running bare `pytest` picks up system Python 3.14,
which lacks `send2trash`, and `test_delete_uses_the_recycle_bin_by_default` fails with
`ModuleNotFoundError`. That is an environment artifact, not a real failure — the venv runs 37/37 green.

`pytest` sets `pythonpath = ["src"]`, so it works from the repo root without installing.

**Build gotcha:** close any running `field-catalog.exe` before rebuilding, or the Rust link step fails.

**Installer:** `powershell -File scriptsuild-worker.ps1` builds the standalone worker
(`src-tauriinariesieldcatalog.exe`, PyInstaller onefile), then `npm run tauri build` bundles it
beside the app exe via the `resources` map. `find_cli()` prefers that installed copy; the dev venv is
its last fallback. The worker exe must be rebuilt whenever the Python changes.

## Hard rules

These are safety invariants, not style preferences. The README and `AGENT.md` state them too.

1. **Reject is not delete.** A `reject` verdict marks a shot; it never removes a file.
2. **Never invent GPS.** Coordinates come from file EXIF only. Place names are labels. There is no
   default city — and none may be inferred from the user's location.
3. **Never call `--execute` without first showing the dry-run `files` list.** Confirmation strings are
   exactly `DELETE_ORIGINALS` and `OFFLOAD_ORIGINALS`.
4. The worker refuses to unlink previews, the sqlite file, or a missing original. Keep it that way.
5. Disposal goes through the recycle bin unless `--permanent` is passed, and an automatic
   catalog backup precedes every `--execute` (a failed backup aborts the delete; `--no-backup`
   overrides).
6. Executed unlinks append a JSONL record to `<library>/audit.jsonl`. Don't bypass it.

Delete expects verdict `reject`, offload expects `keep`, overridable only with `--allow-any-verdict`.
Per-id failures collect into an `errors` list so one bad id never aborts a batch — preserve that.

## Conventions

**JSON envelope.** Every CLI command prints `{"ok": true|false, ...}` via `_out()` in
[cli.py](src/fieldcatalog/cli.py). stdout is JSON *only* — progress goes to stderr via
`_stderr_progress`. Anything else on stdout breaks the Tauri parser.

**Naming crosses the IPC boundary unchanged.** Python snake_case field names appear verbatim in
`ui/src/types.ts` (`original_path`, `captured_at`, `preview_width`). Do not camelCase them. CLI
subcommands are kebab-case (`set-verdict`, `pending-deletes`, `refresh-previews`); argparse dests are
snake_case.

**Central model.** `Shot` dataclass in [models.py](src/fieldcatalog/models.py), ~35 fields, with
`to_row()`/`from_row()`. Literal enums: `Verdict = keep|reject|unrated`,
`OriginalStatus = present|deleted|offloaded`, `AnimalType = bird|mammal|herp|fish|invertebrate|other`.
Mirrored in `ui/src/types.ts` — change both.

**Serialization is inconsistent by history:** `tags` is comma-joined, `field_marks` and
`similar_species` are JSON arrays, `favorite`/`gps_from_file` are ints. Known wart, listed in
`TODO_UI_POLISH.md`. Don't silently normalize it.

**CLI handler pattern:** one `cmd_*` per subcommand, wired via
`sub.add_parser(...).set_defaults(func=cmd_x)`. Handlers print via `_out()`, which serve mode
captures per-request through a thread-local buffer — never print around it. `_catalog()` caches one
Catalog per thread per library; serve's two lanes each get their own sqlite connection, which WAL
makes safe. Heavy modules (`geocode`, `vision`) stay lazily imported inside handlers to keep the
one-shot CLI quick.

**SQLite:** schema string in `catalog.py`, `journal_mode=WAL` + `busy_timeout=5000` (serve runs two
lanes on separate connections, and one-shot CLI calls can still race the app). Migrations are
additive via `PRAGMA table_info` checks in `_migrate()`.

**Theme:** `ui/tailwind.config.js` defines the field-journal palette — `ink`, `charcoal`, `bark`,
`paper`, `paper-dim`, `moss`, `moss-dark`, `ochre`, `reject`, serif-first stack. Deliberately not a
SaaS dashboard look; see `DESKTOP_PROMPT.md`. Use the tokens, don't hardcode hex.

## Before reporting a bug

Check `TODO_UI_POLISH.md` first — it already documents several known issues, including: `find_cli()`
bakes in `CARGO_MANIFEST_DIR` so the NSIS bundle only runs on this machine; a forward-button history
bug; four sources of truth for the animal-type enum; `xai.key` stored plaintext; path-based import
dedupe orphaning moved originals.

## Don't

From `AGENT.md`: no deleting on reject, no demosaicing every NEF on import, no putting originals
inside the preview folder, no invented GPS, no accounts/social features, no auto-identify on import
(identify is user-click only), no Electron.

Secrets stay in the library folder, never the repo — `.gitignore` covers `xai.key`, `*.key`,
`secrets.json`, `geocode-cache.json`. `lib.rs` injects `XAI_API_KEY` into the child env only for the
`identify` subcommand.
