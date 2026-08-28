from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime
from pathlib import Path

from .catalog import Catalog

BACKUP_KEEP = 5

# Partial-content hash: size + the first 1MB + the last 64KB. Enough to tell
# burst frames apart (the embedded preview lives in the head of a NEF) without
# reading 50MB per file, and stable when a file is merely moved or renamed.
_HEAD = 1024 * 1024
_TAIL = 64 * 1024


def content_hash(path: Path) -> str:
    size = path.stat().st_size
    h = hashlib.sha256()
    h.update(str(size).encode())
    with open(path, "rb") as f:
        h.update(f.read(_HEAD))
        if size > _HEAD + _TAIL:
            f.seek(-_TAIL, 2)
            h.update(f.read(_TAIL))
    return h.hexdigest()


def backup_catalog(catalog: Catalog, keep: int = BACKUP_KEEP) -> dict:
    """Copy the live catalog into library/backups/ with SQLite's online backup
    API (safe against concurrent writers under WAL), keeping the newest few."""
    dest_dir = catalog.library / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = dest_dir / f"catalog-{stamp}.sqlite"
    n = 1
    while dest.exists():
        dest = dest_dir / f"catalog-{stamp}-{n}.sqlite"
        n += 1
    out = sqlite3.connect(dest)
    try:
        catalog.conn.backup(out)
    finally:
        out.close()
    # Order by mtime with the file just written pinned newest -- name order
    # alone would put a same-second collision suffix BEFORE its base name and
    # prune the backup we just took.
    others = [p for p in dest_dir.glob("catalog-*.sqlite") if p != dest]
    others.sort(key=lambda p: (p.stat().st_mtime, p.name))
    ordered = [*others, dest]
    pruned = 0
    for old in ordered[:-keep] if keep > 0 else []:
        old.unlink()
        pruned += 1
    return {
        "path": str(dest),
        "bytes": dest.stat().st_size,
        "kept": min(len(ordered), keep),
        "pruned": pruned,
    }


def run_doctor(catalog: Catalog, *, fix: bool = False, progress=None) -> dict:
    """Integrity report for the library. Report-only by default; --fix performs
    the safe backfills (dimensions, content hashes) and nothing destructive."""
    integrity = catalog.conn.execute("PRAGMA integrity_check").fetchone()[0]

    shots = catalog.list()
    missing_originals = [
        s for s in shots if s.original_status == "present" and not Path(s.original_path).is_file()
    ]
    missing_previews = [s for s in shots if not Path(s.preview_path).is_file()]
    known_previews = {str(Path(s.preview_path).resolve()) for s in shots}
    orphaned_previews = [
        p for p in sorted(catalog.previews.glob("*.jpg")) if str(p.resolve()) not in known_previews
    ]
    no_dimensions = [s for s in shots if not s.preview_width or not s.preview_height]
    hashable = [
        s
        for s in shots
        if s.original_status == "present" and not s.content_hash and Path(s.original_path).is_file()
    ]

    backups = sorted((catalog.library / "backups").glob("catalog-*.sqlite"))
    newest_backup = str(backups[-1]) if backups else None

    fixed: dict[str, int] = {}
    if fix:
        from .importer import backfill_dimensions

        if no_dimensions:
            fixed["dimensions"] = backfill_dimensions(catalog, progress=progress)["backfilled"]
        if hashable:
            pairs = []
            total = len(hashable)
            for i, shot in enumerate(hashable, start=1):
                try:
                    pairs.append((content_hash(Path(shot.original_path)), shot.id))
                except OSError:
                    continue
                if progress:
                    progress(i, total)
            if pairs:
                catalog.conn.executemany(
                    "UPDATE shots SET content_hash = ? WHERE id = ?", pairs
                )
                catalog.conn.commit()
            fixed["hashes"] = len(pairs)

    def _sample(items, key=lambda x: x):
        return [key(x) for x in items[:10]]

    return {
        "integrity": integrity,
        "shots": len(shots),
        "missing_originals": len(missing_originals),
        "missing_originals_sample": _sample(missing_originals, lambda s: s.original_path),
        "missing_previews": len(missing_previews),
        "orphaned_previews": len(orphaned_previews),
        "orphaned_previews_sample": _sample(orphaned_previews, str),
        "missing_dimensions": len(no_dimensions) - fixed.get("dimensions", 0),
        "missing_hashes": len(hashable) - fixed.get("hashes", 0),
        "newest_backup": newest_backup,
        "backups": len(backups),
        "fixed": fixed,
        "hints": _hints(missing_originals, orphaned_previews, backups),
    }


def _hints(missing_originals, orphaned_previews, backups) -> list[str]:
    hints = []
    if missing_originals:
        hints.append(
            "Originals missing on disk: if they were moved, re-import the new location -- "
            "matching files re-link to their existing rows instead of importing twice."
        )
    if orphaned_previews:
        hints.append("Orphaned previews are reported only; delete them by hand if unwanted.")
    if not backups:
        hints.append("No backups yet. Run `fieldcatalog backup` -- one also runs automatically before every delete.")
    return hints
