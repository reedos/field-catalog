# Field Catalog

A local-first desktop app for culling wildlife photography. Import a card, decide
what to keep, identify what you photographed, and get the keepers out — without
uploading anything or moving your originals.

Built for one photographer, one machine, one library. No accounts, no cloud, no
telemetry. The catalog is a SQLite file you own.

**Reject never deletes.** Verdicts are marks; removing a file from disk is a
separate, deliberate act behind a dry run and an exact confirmation string.

> **Status.** A personal tool, shared in case it is useful. Developed and tested
> on Windows against a Nikon D850 library of a few thousand frames. The worker
> is portable Python, but the desktop shell has only ever been built and run on
> Windows — macOS and Linux are unverified rather than unsupported.
>
> Bug reports are welcome. Feature requests are too, when they suit the workflow
> and keep the safety guarantees intact — see
> [CONTRIBUTING.md](CONTRIBUTING.md) for what that means in practice. Fixes may
> be slow.

## What it does

- **Import** a card without moving or copying originals — only a compressed
  preview enters the library. RAW files use the embedded JPEG; nothing is
  demosaiced.
- **Cull** with the keyboard: `j`/`k` to walk, `p` keep, `x` reject, `f`
  favorite, `l` for a 1:1 loupe, `Ctrl+Z` to undo.
- **Compare** a burst: every frame on screen at once with pan and zoom synced
  across them. Mark frames one at a time, or mark the keepers and reject the
  rest in a stroke, or flag only the duds and keep the rest.
- **Outings** — the library groups by capture day, so a session is a trip
  rather than a wall of thumbnails.
- **Identify** species with a local vision model or an API key — optional, see
  [Identification](#identification); typing names by hand works fine too.
- **Life list** — one plate per species, your best frame of it, numbered in
  the order you first saw them.
- **Slideshow** — full-screen review of the keepers (or the rejects, for a
  second opinion) in the current view.
- **Export** keepers to a folder with a metadata CSV, then optionally offload
  the originals once the copy is verified.

## Screenshots

<!--
  Add images to docs/screenshots/ and reference them here, for example:

  ![The library, grouped by outing](docs/screenshots/library.png)
  ![Comparing a burst](docs/screenshots/compare.png)
  ![The life list](docs/screenshots/life-list.png)

  Take them against a scratch library, not your own: a screenshot of the real
  thing publishes your filenames, species, place names and capture dates.
  `python -m fieldcatalog ... init` a throwaway library and import a handful of
  frames you are happy to show.
-->

_Coming: the library grouped by outing, the burst compare view, and the life
list._

## Identification

**This feature is optional and the app is fully useful without it.** Culling,
bursts, outings, the life list, export — none of it needs a model. Without one,
type the common and scientific name into the detail panel, which is what you'd
be doing from a field guide anyway. The life list fills up either way.

If you do want it, there are two paths.

### A local model, through Ollama

Free, private, and nothing leaves your machine. [Install
Ollama](https://ollama.com), then pull any vision model:

```bash
ollama pull llama3.2-vision      # the default; ~8GB, needs a reasonable GPU
ollama pull moondream            # ~1.7GB, runs on modest hardware
ollama pull llava                # ~4.7GB, a middle option
```

Set which one under Settings → Identify, or per library in
`<library>/identify.json`. Any Ollama model that accepts images works — larger
ones are better at species, smaller ones are faster and run on less.

### An API key

Settings → Identify → xAI, and paste a key. The preview image is sent to the
provider; nothing else is. The key is stored in your library folder, not in
this repository.

### Accuracy, honestly

Vision models are a first guess, not an authority. They are reasonably good at
common, distinctive species and confidently wrong about hard ones — subspecies,
juveniles, anything where the field marks are subtle. Everything a model writes
is editable, and low-confidence results are worth treating as a prompt to look
it up rather than an answer.

## Install

Download the latest **`Field-Catalog-x.y.z-x64-setup.exe`** from
[Releases](https://github.com/reedos/field-catalog-worker/releases) and run it.
The Python worker is bundled, so nothing else needs installing.

Windows will warn that the installer is unsigned — **More info → Run anyway**.
It installs per-user, so there is no admin prompt, and it lands in
`%LOCALAPPDATA%/Field Catalog` with a Start menu entry. A newer installer
upgrades in place and leaves your library alone — close the app first, because
Windows cannot replace a running executable.

**Requirements:** Windows. Optionally [`exiftool`](https://exiftool.org/) on
`PATH` for better RAW GPS and metadata, and — only for automatic species
identification — [Ollama](https://ollama.com) with a vision model or an xAI API
key. See [Identification](#identification); it is optional.

## Build from source

Needs Python 3.10+, Node 20+ and Rust.

```bash
git clone https://github.com/reedos/field-catalog-worker.git
cd field-catalog-worker
python -m venv .venv
.venv/Scripts/activate          # Unix: source .venv/bin/activate
pip install -e ".[dev]"         # ".[raw]" adds rawpy for NEF thumbnails
npm install && npm --prefix ui install
```

Run the desktop app with `Run Field Catalog.bat`, or:

```bash
npm run tauri -- dev            # desktop window
npm run dev                     # browser-only UI loop (scripts/dev-browser.bat)
```

Your library lives at `%USERPROFILE%/FieldCatalog` (`$FIELDCATALOG_LIBRARY` to
put it elsewhere): `catalog.sqlite`, `previews/`, `backups/`, `audit.jsonl`.
Nothing is written anywhere else.

### Building an installer

```bash
npm run build:installer
```

That builds the standalone worker with PyInstaller and bundles it into an NSIS
installer under `src-tauri/target/release/bundle/nsis/`. The worker exe is a
build artifact, so the bundling settings live in
`src-tauri/tauri.bundle.conf.json` and are merged only for that command — a
fresh clone can run `tauri dev` without building the worker first.

To cut a full release — version bump across all four files, tests, build, tag,
and a GitHub release with the installer attached — use
`scripts/release.ps1 -Version x.y.z`.

## The worker

All catalog logic lives in a Python CLI that prints JSON on stdout. The desktop
app is a thin shell over it, and everything the app can do is scriptable.

```bash
fieldcatalog --library ~/FieldCatalog init
fieldcatalog --library ~/FieldCatalog import --source /path/to/card
fieldcatalog --library ~/FieldCatalog list --summary
fieldcatalog --library ~/FieldCatalog set-verdict --id <id> --verdict reject
fieldcatalog --library ~/FieldCatalog bursts
fieldcatalog --library ~/FieldCatalog identify --id <id>
fieldcatalog --library ~/FieldCatalog export-originals --dest /path/to/handoff
fieldcatalog --library ~/FieldCatalog backup
fieldcatalog --library ~/FieldCatalog doctor --fix
```

Every command prints `{"ok": true|false, ...}`. Progress goes to stderr, so
stdout stays parseable. `--pretty` indents it for reading by hand.

`fieldcatalog serve` is the persistent mode the desktop app uses: one JSON
request per stdin line, one response per line, matched by id.

### Removing originals

Two steps, always, and the first one is a rehearsal:

```bash
# 1. See exactly what would go, with paths and sizes
fieldcatalog --library ~/FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS

# 2. Do it
fieldcatalog --library ~/FieldCatalog delete-originals --ids id1,id2 --confirm DELETE_ORIGINALS --execute
```

Keepers already copied elsewhere use `offload-originals` with
`OFFLOAD_ORIGINALS`. Both route through the recycle bin unless `--permanent` is
passed, back the catalog up first, and append to `audit.jsonl`.

## Rules the app holds itself to

These are safety invariants, not preferences. They are enforced in the worker,
not just the UI.

1. **Reject is not delete.** A verdict marks a shot; it never removes a file.
2. **Never invent GPS.** Coordinates come from file EXIF only. A typed place is
   a label, and it never overwrites coordinates the camera recorded. There is no
   default location.
3. **Dry run before execute.** `--execute` is refused without the exact
   confirmation string, and the UI never offers it without showing the file list
   first.
4. **Delete expects `reject`, offload expects `keep`**, overridable only with an
   explicit `--allow-any-verdict`.
5. **Previews always survive.** The worker refuses to unlink a preview, a file
   inside the preview folder, the database, or a missing original.
6. **Originals stay where they are.** Import copies nothing but a preview;
   export copies rather than moves.
7. **The catalog is backed up before every executed removal**, and a failed
   backup aborts the operation.

## Development

```bash
pytest -q                        # worker tests
npm --prefix ui run build        # typecheck and build the UI
cargo test --manifest-path src-tauri/Cargo.toml
```

`pytest` sets `pythonpath = ["src"]`, so it runs from the repo root without
installing. Use the project `.venv` rather than a system Python — the tests
need `send2trash`.

[BACKLOG.md](BACKLOG.md) tracks what is known-broken and known-missing.
[CLAUDE.md](CLAUDE.md) briefs coding agents on the conventions and invariants.

## License

[Functional Source License 1.1, MIT Future](LICENSE.md) (`FSL-1.1-MIT`).

In plain terms: **use it for anything you like, including your paid work.** Read
it, modify it, run it on client shoots, share your changes. The one thing you
may not do is turn it into a competing commercial product.

Each release becomes plain MIT two years after it is published, automatically
and irrevocably — so nothing here is ever locked away for good.

Source-available rather than open source, deliberately: the commercial rights
stay with the author for now.
