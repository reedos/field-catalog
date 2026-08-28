# Field Catalog Desktop — TODO / Backlog

## High value, pending
- [ ] Back button / history navigation: restore previous view + state (e.g., life list → library filter → back to life list at same scroll position)
- [ ] Library thumbnails orientation + size: display photos in actual orientation (landscape/portrait) and increase thumbnail size in grid
- [ ] Detail view as scrollable side panel: open photo in side panel like screenshot, keep grid visible behind, not full-screen modal
- [ ] Mass add location info by date: bulk set location label for all photos captured on a specific day
- [ ] Bursts navigation: prevent auto-exit back to library after finishing bursts; stay in bursts view with updated state
- [ ] Burst photo ordering: ensure shots within a burst are ordered chronologically so “next” moves sequentially through burst
- [ ] Verdict button real-time update: Keep/Reject/Unrated button state updates immediately after press, no wait for next photo
- [ ] Wire `/api/field-marks` in Tauri backend to `Catalog.distinct_field_marks`; connect Detail datalist to live suggestions and add “Add field mark” button
- [ ] Wire `/api/field-marks` in Tauri backend to `Catalog.distinct_field_marks`; connect Detail datalist to live suggestions and add “Add field mark” button
- [ ] Import flow with folder picker → `import --source` with progress streaming from stderr
- [ ] Pending-deletes quick view: show count in Toolbar badge, open dry-run dialog directly
- [ ] Disk audit UI viewer fully functional: implement `/api/audit` Tauri route, read `library/audit.jsonl`, show in modal
- [ ] Burst pick UI polish: recommended keep per burst, compare view, bulk apply verdicts
- [ ] Map place-name edit save via `set-location` without moving GPS
- [ ] Settings: persist custom keymaps, backend selection, Ollama model
- [ ] Grid performance: item virtualizer tuning + preload next rows
- [ ] Disk audit log helper: ensure `audit_log` writes on every unlink, test with delete/offload

## Medium
- [ ] Keyboard cheat-sheet overlay: add missing shortcuts, make it toggleable
- [ ] Meter component: ensure gradient renders on all browsers
- [ ] Field marks suggestions: debounce input, show top 5
- [ ] Life list: add counts per species, filter by verdict
- [ ] Refresh previews progress indicator

## Low / Nice-to-have
- [ ] Dark mode toggle
- [ ] Export catalog CSV
- [ ] Thumbnail generation for bursts
- [ ] Cloud offload confirmation checklist

## Bugs
- [ ] Vite dev deps install reliably on Windows
- [ ] SCHEMA triple-quote was missing — fixed
- [ ] Ensure `fieldcatalog audit` returns JSON with `entries` field
