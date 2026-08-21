from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from .animal import infer_animal_type
from .bursts import assign_bursts
from .catalog import Catalog
from .exif import parse_exif
from .models import Shot
from .preview import is_photo, write_preview
from .sharpness import score_sharpness


def walk_photos(source: Path) -> list[Path]:
    source = source.expanduser().resolve()
    if source.is_file():
        return [source] if is_photo(source) else []
    files = [p for p in source.rglob("*") if p.is_file() and is_photo(p)]
    return sorted(files)


def import_paths(catalog: Catalog, paths: list[Path]) -> dict:
    imported: list[Shot] = []
    skipped = 0
    errors: list[dict] = []
    for path in paths:
        resolved = str(path.resolve())
        if catalog.by_original(resolved):
            skipped += 1
            continue
        shot_id = str(uuid.uuid4())
        preview = catalog.preview_file(shot_id)
        try:
            write_preview(path, preview)
            meta = parse_exif(path)
            if meta.get("lat") is None or meta.get("lon") is None:
                preview_meta = parse_exif(preview)
                for key in ("lat", "lon", "captured_at", "camera", "lens", "iso", "shutter", "aperture", "focal_length", "location"):
                    if meta.get(key) in (None, "") and preview_meta.get(key) not in (None, ""):
                        meta[key] = preview_meta[key]
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
        )
        catalog.upsert(shot)
        imported.append(shot)

    all_shots = catalog.list()
    assign_bursts(all_shots)
    for s in all_shots:
        catalog.update(s.id, burst_id=s.burst_id)

    return {
        "imported": len(imported),
        "skipped": skipped,
        "errors": errors,
        "ids": [s.id for s in imported],
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
            write_preview(src, Path(shot.preview_path))
            ok += 1
        except Exception as e:
            errors.append({"id": shot.id, "path": shot.original_path, "error": str(e)})
        if progress:
            progress(i, total)
    return {"refreshed": ok, "missing_originals": missing, "errors": errors, "total": total}
