# Field Catalog Desktop — TODO / Backlog

## High value, pending
- [ ] Pending-deletes quick view: show count in Toolbar badge, open dry-run dialog directly
- [ ] Burst pick UI polish: compare view, bulk apply verdicts
- [ ] Map place-name edit save via `set-location` without moving GPS (`PinCard` in `MapView.tsx` is written but never rendered)
- [ ] Grid performance: item virtualizer tuning + preload next rows
- [ ] Forward button never enables: `pushHistory` always leaves `historyIndex` at `length-1`, and the 16-entry trim shifts indices without adjusting it
- [ ] "Pending" toolbar button is a duplicate of "Delete rejected" — give it its own handler or remove it
- [ ] Accessibility pass: no `role="dialog"` / focus trap on any modal; `text-paper-dim` on `bg-paper` is unreadable in the shortcuts overlay and command palette
- [ ] Ship off this machine: `find_cli()` bakes in `CARGO_MANIFEST_DIR` at compile time, so the NSIS bundle only runs here. Needs a sidecar or `resources` entry.

## Medium
- [ ] Meter component: ensure gradient renders on all browsers
- [ ] Life list: filter by verdict (counts per species are already shown)
- [ ] `list` supports `--limit` and `truncated`, but `api.list()` never passes it — decide whether to paginate

## Low / Nice-to-have
- [ ] Dark mode toggle
- [ ] Export catalog CSV
- [ ] Thumbnail generation for bursts
- [ ] Cloud offload confirmation checklist

## Bugs
- [ ] Vite dev deps install reliably on Windows
- [ ] Import dedupe is path-based, so a moved or renamed original re-imports as a new shot and orphans the old row
- [ ] `preview.py` minimum-preview-size check is inert (`return best if best and len(best) > 20_000 else best` — both branches return `best`), so a tiny embedded thumbnail is accepted as the preview
- [ ] `parse_exif` is `_exiftool(path) or _pil(path)`, and `_exiftool` always returns a truthy dict, so the PIL fallback is unreachable whenever exiftool is on PATH
- [ ] `importer.py` re-parses EXIF from the preview it just wrote, but `write_preview` saves no EXIF, so that fallback can never recover anything

## Done
- [x] Back button / history navigation
- [x] Library thumbnails orientation + size
- [x] Detail view as scrollable side panel
- [x] Mass add location info by date
- [x] Bursts navigation stays in the bursts view
- [x] Burst photo ordering is chronological
- [x] Verdict button real-time update
- [x] Import folder picker
- [x] Disk audit UI viewer + `audit` command returning `entries`
- [x] Settings: persist custom keymaps, backend selection, Ollama model
- [x] Refresh previews progress indicator
- [x] SCHEMA triple-quote (commit `ab8588c`)
- [x] Field marks suggestions: debounced, sourced from the catalog via the `field-marks` command, rendered as clickable chips (a `<textarea>` cannot use a `<datalist>`, which is why the old scaffolding never appeared)
- [x] Import progress streaming from stderr
- [x] `audit_log` writes on every executed unlink, is guarded so a log failure cannot report a successful delete as failed, and is covered by tests
- [x] Keyboard cheat-sheet overlay closes on Escape and no longer leaks cull keys to the shot behind it
- [x] Loupe key actually renders a 1:1 view with drag-to-pan
