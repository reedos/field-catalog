from __future__ import annotations

from pathlib import Path

from .catalog import Catalog
from .models import Shot

CONFIRM_DELETE = "DELETE_ORIGINALS"
CONFIRM_OFFLOAD = "OFFLOAD_ORIGINALS"


class DiskError(RuntimeError):
    pass


def _guard_original(catalog: Catalog, shot: Shot) -> Path:
    if shot.original_status != "present":
        raise DiskError(f"{shot.id} original already {shot.original_status}")
    path = Path(shot.original_path)
    if not path.is_file():
        raise DiskError(f"original missing on disk: {path}")
    preview = Path(shot.preview_path).resolve()
    resolved = path.resolve()
    if resolved == preview:
        raise DiskError("refusing to delete the catalog preview")
    if catalog.previews.resolve() in resolved.parents or resolved.parent == catalog.previews.resolve():
        raise DiskError("refusing to delete a file inside the preview library")
    if catalog.db_path.resolve() == resolved:
        raise DiskError("refusing to delete the catalog database")
    return resolved


def pending(catalog: Catalog, verdict: str | None = "reject") -> list[dict]:
    rows = catalog.list(original_status="present")
    if verdict:
        rows = [s for s in rows if s.verdict == verdict]
    return [
        {
            "id": s.id,
            "original_path": s.original_path,
            "preview_path": s.preview_path,
            "bytes": s.bytes_original or _size(s.original_path),
            "verdict": s.verdict,
            "common_name": s.common_name,
            "captured_at": s.captured_at,
        }
        for s in rows
    ]


def _size(path: str) -> int:
    p = Path(path)
    return p.stat().st_size if p.is_file() else 0


def unlink_originals(
    catalog: Catalog,
    ids: list[str],
    *,
    action: str,
    confirm: str,
    execute: bool,
) -> dict:
    expected = CONFIRM_DELETE if action == "delete" else CONFIRM_OFFLOAD
    if confirm != expected:
        raise DiskError(f"confirm must be exactly {expected}")
    if action not in ("delete", "offload"):
        raise DiskError("action must be delete or offload")

    status = "deleted" if action == "delete" else "offloaded"
    planned = []
    errors = []
    for shot_id in ids:
        shot = catalog.get(shot_id)
        if not shot:
            errors.append({"id": shot_id, "error": "unknown id"})
            continue
        try:
            path = _guard_original(catalog, shot)
        except DiskError as e:
            errors.append({"id": shot_id, "error": str(e)})
            continue
        planned.append(
            {
                "id": shot.id,
                "path": str(path),
                "bytes": path.stat().st_size,
                "preview_kept": shot.preview_path,
            }
        )

    if not execute:
        return {
            "dry_run": True,
            "action": action,
            "count": len(planned),
            "bytes": sum(p["bytes"] for p in planned),
            "files": planned,
            "errors": errors,
        }

    done = []
    for item in planned:
        path = Path(item["path"])
        try:
            path.unlink()
            catalog.update(item["id"], original_status=status)
            done.append(item)
        except OSError as e:
            errors.append({"id": item["id"], "error": str(e)})

    return {
        "dry_run": False,
        "action": action,
        "count": len(done),
        "bytes": sum(p["bytes"] for p in done),
        "files": done,
        "errors": errors,
        "previews_kept": True,
    }
