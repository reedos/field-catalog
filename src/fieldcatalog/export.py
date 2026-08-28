from __future__ import annotations

import csv
import shutil
from pathlib import Path

from .catalog import Catalog
from .models import Shot

CSV_FIELDS = [
    "filename",
    "display_name",
    "common_name",
    "scientific_name",
    "animal_type",
    "captured_at",
    "location",
    "lat",
    "lon",
    "stars",
    "verdict",
    "sharpness",
    "camera",
    "lens",
    "iso",
    "shutter",
    "aperture",
    "focal_length",
]


class ExportError(RuntimeError):
    pass


def export_originals(
    catalog: Catalog,
    dest: Path,
    *,
    ids: list[str] | None = None,
    verdict: str = "keep",
    progress=None,
) -> dict:
    """Copy originals (keepers by default) into `dest`, with a metadata CSV.

    Copying, never moving -- the catalog's paths stay valid, and the export is
    what goes to the editor or the cloud. Name collisions get a numeric suffix
    rather than overwriting.
    """
    dest = Path(dest).expanduser().resolve()
    if dest == catalog.previews.resolve() or catalog.previews.resolve() in dest.parents:
        raise ExportError("refusing to export into the preview library")
    if dest == catalog.db_path.resolve().parent and dest == catalog.library:
        # The library root itself is legal but almost certainly a misclick.
        raise ExportError("refusing to export into the library root; pick a subfolder")
    dest.mkdir(parents=True, exist_ok=True)

    if ids:
        shots = [s for i in ids if (s := catalog.get(i)) is not None]
    else:
        shots = catalog.list(verdict=verdict, original_status="present")

    exported: list[dict] = []
    missing = 0
    errors: list[dict] = []
    total = len(shots)
    used: set[str] = set()
    rows: list[Shot] = []

    for i, shot in enumerate(shots, start=1):
        src = Path(shot.original_path)
        if not src.is_file():
            missing += 1
            continue
        name = src.name
        stem, suffix = src.stem, src.suffix
        n = 2
        while name.lower() in used or (dest / name).exists():
            name = f"{stem}-{n}{suffix}"
            n += 1
        try:
            shutil.copy2(src, dest / name)
        except OSError as e:
            errors.append({"id": shot.id, "path": str(src), "error": str(e)})
            continue
        used.add(name.lower())
        exported.append({"id": shot.id, "file": name, "bytes": src.stat().st_size})
        rows.append((shot, name))  # type: ignore[arg-type]
        if progress:
            progress(i, total)

    csv_path = dest / "metadata.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for shot, name in rows:  # type: ignore[misc]
            writer.writerow(
                {
                    "filename": name,
                    "display_name": shot.display_name,
                    "common_name": shot.common_name or "",
                    "scientific_name": shot.scientific_name or "",
                    "animal_type": shot.animal_type or "",
                    "captured_at": shot.captured_at,
                    "location": shot.location,
                    "lat": shot.lat if shot.lat is not None else "",
                    "lon": shot.lon if shot.lon is not None else "",
                    "stars": shot.stars,
                    "verdict": shot.verdict,
                    "sharpness": shot.sharpness if shot.sharpness is not None else "",
                    "camera": shot.camera,
                    "lens": shot.lens,
                    "iso": shot.iso if shot.iso is not None else "",
                    "shutter": shot.shutter or "",
                    "aperture": shot.aperture or "",
                    "focal_length": shot.focal_length or "",
                }
            )

    return {
        "dest": str(dest),
        "exported": len(exported),
        "bytes": sum(e["bytes"] for e in exported),
        "csv": str(csv_path),
        "missing": missing,
        "errors": errors,
    }
