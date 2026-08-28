from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from .animal import infer_animal_type
from .bursts import assign_bursts
from .catalog import Catalog
from .exif import parse_exif_many
from .models import Shot
from PIL import Image

from .preview import is_photo, write_preview
from .sharpness import score_sharpness


def walk_photos(source: Path) -> list[Path]:
    source = source.expanduser().resolve()
    if source.is_file():
        return [source] if is_photo(source) else []
    files = [p for p in source.rglob("*") if p.is_file() and is_photo(p)]
    return sorted(files)


def import_paths(catalog: Catalog, paths: list[Path], *, progress=None) -> dict:
    imported: list[Shot] = []
    skipped = 0
    errors: list[dict] = []
    total = len(paths)

    # One exiftool spawn per batch rather than one per photo. Only the files we
    # will actually import are read, so a re-import of a known card costs nothing.
    fresh = [p for p in paths if not catalog.by_original(str(p.resolve()))]
    meta_by_path = parse_exif_many(fresh)

    for i, path in enumerate(paths, start=1):
        if progress:
            progress(i, total)
        resolved = str(path.resolve())
        if catalog.by_original(resolved):
            skipped += 1
            continue
        shot_id = str(uuid.uuid4())
        preview = catalog.preview_file(shot_id)
        try:
            preview_w, preview_h = write_preview(path, preview)
            meta = meta_by_path.get(path) or {}
            sharpness = score_sharpness(preview)
        except Exception as e:
            if preview.exists():
                preview.unlink(missing_ok=True)
            errors.append({"path": resolved, "error": str(e)})
            continue
        captured = meta.get("captured_at") or datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        shot = Shot(
            id=shot_id,
            original_path=resolved,
            preview_path=str(preview),
            original_status="present",
            display_name=path.stem,
            captured_at=captured,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            location=meta.get("location") or "",
            lat=meta.get("lat"),
            lon=meta.get("lon"),
            camera=meta.get("camera") or "",
            lens=meta.get("lens") or "",
            iso=meta.get("iso"),
            shutter=meta.get("shutter"),
            aperture=meta.get("aperture"),
            focal_length=meta.get("focal_length"),
            sharpness=sharpness,
            burst_id=f"burst-{shot_id}",
            bytes_original=path.stat().st_size,
            animal_type=infer_animal_type(path.stem),
            gps_from_file=meta.get("lat") is not None and meta.get("lon") is not None,
            preview_width=preview_w,
            preview_height=preview_h,
        )
        catalog.upsert(shot)
        imported.append(shot)

    # Bursts are recomputed across the whole library, but only the rows whose
    # burst actually moved get written, and they go out in one transaction --
    # importing one photo used to issue one committed UPDATE per existing row.
    all_shots = catalog.list()
    before = {s.id: s.burst_id for s in all_shots}
    assign_bursts(all_shots)
    changed = [(s.id, s.burst_id) for s in all_shots if before[s.id] != s.burst_id]
    catalog.set_burst_ids(changed)

    return {
        "imported": len(imported),
        "skipped": skipped,
        "errors": errors,
        "ids": [s.id for s in imported],
        "bursts_rewritten": len(changed),
    }


def refresh_previews(catalog: Catalog, *, progress=None) -> dict:
    """Rewrite previews from originals (orientation, size). Does not re-import or touch originals."""
    shots = catalog.list()
    ok = 0
    missing = 0
    errors: list[dict] = []
    total = len(shots)
    for i, shot in enumerate(shots, start=1):
        src = Path(shot.original_path)
        if not src.is_file():
            missing += 1
            continue
        try:
            w, h = write_preview(src, Path(shot.preview_path))
            # Dimensions can change here (orientation, max_edge), so keep them
            # in step with the file the grid is about to lay out.
            if (w, h) != (shot.preview_width, shot.preview_height):
                catalog.update(shot.id, preview_width=w, preview_height=h)
            ok += 1
        except Exception as e:
            errors.append({"id": shot.id, "path": shot.original_path, "error": str(e)})
        if progress:
            progress(i, total)
    return {"refreshed": ok, "missing_originals": missing, "errors": errors, "total": total}


def backfill_dimensions(catalog: Catalog, *, progress=None) -> dict:
    """Fill preview_width/height for rows imported before dimensions were stored.

    Reads only each preview's JPEG header, so a few thousand rows take seconds.
    Without these the grid re-learns aspect ratios as thumbnails decode, and
    every repack used to shove the scroll position around.
    """
    todo = [s for s in catalog.list() if not s.preview_width or not s.preview_height]
    pairs: list[tuple[int, int, str]] = []
    missing = 0
    errors: list[dict] = []
    total = len(todo)
    for i, shot in enumerate(todo, start=1):
        path = Path(shot.preview_path)
        if not path.is_file():
            missing += 1
            continue
        try:
            with Image.open(path) as img:
                w, h = img.size
            pairs.append((w, h, shot.id))
        except Exception as e:
            errors.append({"id": shot.id, "error": str(e)})
        if progress:
            progress(i, total)
    if pairs:
        catalog.conn.executemany(
            "UPDATE shots SET preview_width = ?, preview_height = ? WHERE id = ?", pairs
        )
        catalog.conn.commit()
    return {"backfilled": len(pairs), "missing_previews": missing, "errors": errors, "total": total}
