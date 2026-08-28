# Field Catalog Desktop — TODO / Backlog

## High value, pending
- [ ] Pending-deletes quick view: show count in Toolbar badge, open dry-run dialog directly
- [ ] "Pending" toolbar button is a duplicate of "Delete rejected" — give it its own
      handler or remove it
- [ ] Accessibility pass: no `role="dialog"` or focus trap on any modal;
      `text-paper-dim` on `bg-paper` is unreadable in the shortcuts overlay and
      command palette; grid has no ARIA structure and no Enter-to-open
- [ ] Ship off this machine. Two halves:
      - [x] Runtime lookup: `find_cli()` now checks beside the app executable and
            `resources/` before falling back to the dev venv, so an installed app
            no longer depends on `CARGO_MANIFEST_DIR`.
      - [ ] Ship an actual CLI. `.venv/Scripts/fieldcatalog.exe` is a 108 KB
            setuptools launcher that resolves Python relative to itself — it needs
            the whole venv beside it and cannot be bundled alone. Freeze the worker
            with PyInstaller into a standalone exe, then declare it as a Tauri
            sidecar (`externalBin`, named `fieldcatalog-x86_64-pc-windows-msvc.exe`).
            Adds a build step and roughly 40-80 MB to the installer.

## Medium
- [ ] Outing headers could show a per-outing keep/reject summary once culled
- [ ] Meter component: ensure gradient renders on all browsers
- [ ] Life list: filter by verdict (counts per species are already shown)
- [ ] `api.list()` still fetches every row. `--limit` and `truncated` work now, so
      pagination is a decision rather than a missing feature.
- [ ] `tags` serializes comma-joined while `field_marks` and `similar_species` use
      JSON, so a tag containing a comma would split. Nothing in the UI reads `tags`,
      so this is a latent inconsistency rather than a live bug.
- [ ] Four sources of truth for the animal-type enum: `models.AnimalType`,
      `vision.TYPES`, the argparse `choices`, and `types.ts ANIMAL_TYPES`

## Low / Nice-to-have
- [ ] Dark mode toggle
- [ ] Thumbnail generation for bursts
- [ ] Cloud offload confirmation checklist

## Bugs
- [ ] Vite dev deps install reliably on Windows
- [ ] Import dedupe is path-based, so a moved or renamed original re-imports as a new
      shot and orphans the old row
- [ ] `xai.key` is written plaintext with default permissions

## Done
- [x] Outings: capture-day headers in the grid with cull-this-outing, a day filter
      in the filter bar, day as part of view history
- [x] Preview prefetch around the selection; compare view badges the recommended pick
- [x] Life list as an achievement page: best frame per species, first-seen plate
      numbering, per-type counts (the Museum Plate direction's second life)
- [x] Export keepers: originals copied to a chosen folder with metadata.csv
      (includes the old "export catalog CSV" idea)
- [x] Installability: find_cli prefers installed layouts, PyInstaller standalone
      worker (scripts/build-worker.ps1), bundled via the resources map
- [x] Backup + doctor: `fieldcatalog backup` (rotating, WAL-safe, automatic before
      every executed delete/offload — a failed backup aborts the delete), and
      `fieldcatalog doctor [--fix]` for integrity, missing files, orphans, and the
      safe backfills. Content hashes re-link moved originals at import instead of
      orphaning their rows.
- [x] Ctrl+Z restores verdicts, burst operations as one group
- [x] Real identify cancellation: `identify-cancel` on the serve fast lane aborts
      the in-flight model call; "Stop identify" now actually stops
- [x] Compare view: survey all frames of a burst at once with synced pan/1:1 zoom,
      X culls the pool live, U restores, Enter keeps the focused frame and rejects
      the rest. Entered from a burst cell's COMPARE or the Bursts view.
- [x] Back button / history navigation
- [x] Library thumbnails orientation + size
- [x] Detail view as scrollable side panel
- [x] Mass add location info by date
- [x] Bursts navigation stays in the bursts view
- [x] Burst photo ordering is chronological
- [x] Verdict button real-time update
- [x] Import folder picker, with progress streaming from stderr
- [x] Disk audit UI viewer + `audit` command returning `entries`
- [x] Settings: persist custom keymaps, backend selection, Ollama model
- [x] Refresh previews progress indicator
- [x] SCHEMA triple-quote (commit `ab8588c`)
- [x] Field marks: debounced, sourced from the catalog, rendered as clickable chips
      (a `<textarea>` cannot use a `<datalist>`, which is why the old scaffolding
      never appeared), and `set` and `identify` now split the field the same way
- [x] `audit_log` writes on every executed unlink, is guarded so a log failure cannot
      report a successful delete as failed, and is covered by tests
- [x] Keyboard cheat-sheet closes on Escape and no longer leaks cull keys to the shot
      behind it
- [x] Loupe renders a 1:1 view with drag-to-pan
- [x] Map place-name editing: `PinCard` is wired into single-shot popups
- [x] Delete dry-run describes every planned file, requires the right verdict, routes
      through the recycle bin, and can no longer be confirmed against a list that was
      never dry-run
- [x] Import no longer does whole-library work per photo; exiftool runs once per batch
- [x] Preview dimensions are stored, so the grid lays out before any image decodes
- [x] Persistent worker: `fieldcatalog serve` behind the Tauri shell and the vite dev
      shim — one process for the session, ~1ms per request instead of ~140ms spawns,
      slow lane for identify/import so culling stays responsive
- [x] Forward button works: history is browser-style now (`lib/historyCore.ts`),
      entries[index] is always the current state
- [x] App.tsx split into domain hooks (useShots, useDiskFlow, useIdentify,
      useViewHistory); 1,116 → 790 lines
