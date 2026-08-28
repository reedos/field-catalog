from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .catalog import Catalog
from .models import Shot

CONFIRM_DELETE = "DELETE_ORIGINALS"
CONFIRM_OFFLOAD = "OFFLOAD_ORIGINALS"

# Delete is for rejects; offload is for keepers already copied to the cloud.
# Anything else has to be asked for explicitly with allow_any_verdict.
REQUIRED_VERDICT = {"delete": "reject", "offload": "keep"}


class DiskError(RuntimeError):
    pass


def _guard_original(
    catalog: Catalog,
    shot: Shot,
    *,
    action: str = "delete",
    allow_any_verdict: bool = False,
) -> Path:
    if shot.original_status != "present":
        raise DiskError(f"{shot.id} original already {shot.original_status}")
    wanted = REQUIRED_VERDICT.get(action)
    if wanted and not allow_any_verdict and shot.verdict != wanted:
        raise DiskError(
            f"refusing to {action} a shot with verdict {shot.verdict!r}; "
            f"{action} expects {wanted!r}"
        )
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


def pending(catalog: Catalog, verdict: str | None = "reject", *, all_verdicts: bool = False) -> list[dict]:
    """List present originals. Defaults to rejects; pass all_verdicts to skip filtering.

    An empty verdict string means "reject", not "everything" -- listing keepers as
    delete candidates should take an explicit flag.
    """
    rows = catalog.list(original_status="present")
    if not all_verdicts:
        rows = [s for s in rows if s.verdict == (verdict or "reject")]
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


def _remove(path: Path, *, permanent: bool) -> str:
    """Remove one original. Returns the disposal actually used: 'trash' or 'unlink'."""
    if not permanent:
        try:
            from send2trash import send2trash
        except ImportError:
            pass
        else:
            send2trash(str(path))
            return "trash"
    path.unlink()
    return "unlink"


def unlink_originals(
    catalog: Catalog,
    ids: list[str],
    *,
    action: str,
    confirm: str,
    execute: bool,
    allow_any_verdict: bool = False,
    permanent: bool = False,
    skip_backup: bool = False,
) -> dict:
    if action not in ("delete", "offload"):
        raise DiskError("action must be delete or offload")
    expected = CONFIRM_DELETE if action == "delete" else CONFIRM_OFFLOAD
    if confirm != expected:
        raise DiskError(f"confirm must be exactly {expected}")

    status = "deleted" if action == "delete" else "offloaded"
    planned = []
    errors = []
    for shot_id in ids:
        shot = catalog.get(shot_id)
        if not shot:
            errors.append({"id": shot_id, "error": "unknown id"})
            continue
        try:
            path = _guard_original(
                catalog, shot, action=action, allow_any_verdict=allow_any_verdict
            )
        except DiskError as e:
            errors.append({"id": shot_id, "error": str(e)})
            continue
        planned.append(
            {
                "id": shot.id,
                "path": str(path),
                "bytes": path.stat().st_size,
                "preview_kept": shot.preview_path,
                "verdict": shot.verdict,
            }
        )

    # The dry run has to describe every planned file, not just the first one --
    # this is the list the user reads before confirming.
    if not execute:
        return {
            "dry_run": True,
            "action": action,
            "count": len(planned),
            "bytes": sum(p["bytes"] for p in planned),
            "files": planned,
            "errors": errors,
            "allow_any_verdict": allow_any_verdict,
            "disposal": "unlink" if permanent else "trash",
        }

    # The catalog is the record of every culling decision; the delete is the
    # highest-stakes moment, so it always gets a restore point first.
    backup_path = None
    if not skip_backup:
        from .maintenance import backup_catalog

        try:
            backup_path = backup_catalog(catalog)["path"]
        except Exception as e:
            raise DiskError(
                f"backup before {action} failed: {e}; pass --no-backup to proceed without one"
            ) from e

    done = []
    disposals = set()
    for item in planned:
        path = Path(item["path"])
        try:
            item["disposal"] = _remove(path, permanent=permanent)
            disposals.add(item["disposal"])
            catalog.update(item["id"], original_status=status)
            done.append(item)
        except OSError as e:
            errors.append({"id": item["id"], "error": str(e)})

    result = {
        "dry_run": False,
        "action": action,
        "count": len(done),
        "bytes": sum(p["bytes"] for p in done),
        "files": done,
        "errors": errors,
        "previews_kept": True,
        "allow_any_verdict": allow_any_verdict,
        "disposal": sorted(disposals),
        "backup": backup_path,
    }

    # The files are already gone by here. A failure to write the log must not be
    # reported as a failure to delete.
    try:
        audit_log(
            catalog.library,
            action,
            [i["id"] for i in done],
            len(done),
            result["bytes"],
            disposal=sorted(disposals),
        )
    except OSError as e:
        result["audit_error"] = str(e)
    return result


def audit_log(
    library: Path,
    action: str,
    ids: list[str],
    count: int,
    bytes_total: int,
    *,
    disposal: list[str] | None = None,
) -> None:
    log_path = Path(library).expanduser() / "audit.jsonl"
    entry = {
        "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        "action": action,
        "ids": ids,
        "count": count,
        "bytes": bytes_total,
        "disposal": disposal or [],
    }
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
