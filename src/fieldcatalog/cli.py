from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .bursts import burst_pick, grouped
from .catalog import Catalog
from .disk import CONFIRM_DELETE, CONFIRM_OFFLOAD, DiskError, pending, unlink_originals
from .importer import import_paths, walk_photos


def _out(ok: bool, **payload) -> int:
    print(json.dumps({"ok": ok, **payload}, indent=2, default=str))
    return 0 if ok else 1


def _catalog(ns: argparse.Namespace) -> Catalog:
    return Catalog(Path(ns.library))


def cmd_init(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    return _out(True, library=str(cat.library), db=str(cat.db_path), previews=str(cat.previews))


def cmd_import(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    paths = walk_photos(Path(ns.source))
    if not paths:
        return _out(False, error=f"no photos under {ns.source}")
    result = import_paths(cat, paths)
    return _out(True, **result)


def cmd_list(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    where = {}
    if ns.verdict:
        where["verdict"] = ns.verdict
    if ns.status:
        where["original_status"] = ns.status
    shots = cat.list(**where)
    verdicts: dict[str, int] = {}
    statuses: dict[str, int] = {}
    for s in shots:
        verdicts[s.verdict] = verdicts.get(s.verdict, 0) + 1
        statuses[s.original_status] = statuses.get(s.original_status, 0) + 1
    payload = {
        "count": len(shots),
        "verdicts": verdicts,
        "original_status": statuses,
        "previews": str(cat.previews),
    }
    if ns.summary:
        return _out(True, **payload)
    shown = shots[: ns.limit] if ns.limit else shots
    payload["shots"] = [
        {
            "id": s.id,
            "original_path": s.original_path,
            "preview_path": s.preview_path,
            "original_status": s.original_status,
            "verdict": s.verdict,
            "captured_at": s.captured_at,
            "lat": s.lat,
            "lon": s.lon,
            "sharpness": s.sharpness,
            "burst_id": s.burst_id,
            "common_name": s.common_name,
            "animal_type": s.animal_type,
            "stars": s.stars,
        }
        for s in shown
    ]
    if ns.limit and len(shots) > ns.limit:
        payload["truncated"] = True
    return _out(True, **payload)


def cmd_set_verdict(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    shot = cat.update(ns.id, verdict=ns.verdict)
    if not shot:
        return _out(False, error="unknown id")
    return _out(True, id=shot.id, verdict=shot.verdict)


def cmd_identify(ns: argparse.Namespace) -> int:
    from .animal import infer_animal_type

    cat = _catalog(ns)
    animal = infer_animal_type(ns.common_name, ns.scientific_name)
    shot = cat.update(
        ns.id,
        common_name=ns.common_name,
        scientific_name=ns.scientific_name or None,
        animal_type=animal,
    )
    if not shot:
        return _out(False, error="unknown id")
    return _out(True, id=shot.id, common_name=shot.common_name, animal_type=shot.animal_type)


def cmd_bursts(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    groups = grouped(cat.list())
    picks = []
    for bid, members in groups.items():
        pick = burst_pick(members)
        if not pick:
            continue
        picks.append(
            {
                "burst_id": bid,
                "count": len(members),
                "keep_id": pick.id,
                "sharpness": pick.sharpness,
                "reject_ids": [m.id for m in members if m.id != pick.id],
            }
        )
    return _out(True, bursts=picks)


def cmd_pending_deletes(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    items = pending(cat, verdict=ns.verdict)
    return _out(True, count=len(items), bytes=sum(i["bytes"] for i in items), files=items)


def cmd_delete(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    ids = [i.strip() for i in ns.ids.split(",") if i.strip()]
    try:
        result = unlink_originals(
            cat,
            ids,
            action="delete",
            confirm=ns.confirm or "",
            execute=ns.execute,
        )
    except DiskError as e:
        return _out(False, error=str(e))
    return _out(True, **result)


def cmd_offload(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    ids = [i.strip() for i in ns.ids.split(",") if i.strip()]
    try:
        result = unlink_originals(
            cat,
            ids,
            action="offload",
            confirm=ns.confirm or "",
            execute=ns.execute,
        )
    except DiskError as e:
        return _out(False, error=str(e))
    return _out(True, **result)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="fieldcatalog", description="Field Catalog local worker")
    p.add_argument("--library", default="~/FieldCatalog", help="catalog root (previews + sqlite)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create library folders").set_defaults(func=cmd_init)

    im = sub.add_parser("import", help="import a folder or file; originals stay put")
    im.add_argument("--source", required=True)
    im.set_defaults(func=cmd_import)

    ls = sub.add_parser("list")
    ls.add_argument("--verdict", choices=["keep", "reject", "unrated"])
    ls.add_argument("--status", choices=["present", "deleted", "offloaded"])
    ls.add_argument("--summary", action="store_true", help="counts only, no shot rows")
    ls.add_argument("--limit", type=int, default=0, help="max shot rows to print (0 = all)")
    ls.set_defaults(func=cmd_list)

    sv = sub.add_parser("set-verdict")
    sv.add_argument("--id", required=True)
    sv.add_argument("--verdict", required=True, choices=["keep", "reject", "unrated"])
    sv.set_defaults(func=cmd_set_verdict)

    ident = sub.add_parser("identify")
    ident.add_argument("--id", required=True)
    ident.add_argument("--common-name", required=True)
    ident.add_argument("--scientific-name", default="")
    ident.set_defaults(func=cmd_identify)

    sub.add_parser("bursts", help="recommended keep per burst").set_defaults(func=cmd_bursts)

    pd = sub.add_parser("pending-deletes", help="list originals that would be unlinked")
    pd.add_argument("--verdict", default="reject")
    pd.set_defaults(func=cmd_pending_deletes)

    dl = sub.add_parser("delete-originals", help="unlink rejected originals; previews stay")
    dl.add_argument("--ids", required=True, help="comma-separated shot ids")
    dl.add_argument("--confirm", default="", help=f"must be {CONFIRM_DELETE}")
    dl.add_argument("--execute", action="store_true", help="actually unlink; omit for dry-run")
    dl.set_defaults(func=cmd_delete)

    off = sub.add_parser("offload-originals", help="unlink keepers after cloud copy; previews stay")
    off.add_argument("--ids", required=True)
    off.add_argument("--confirm", default="", help=f"must be {CONFIRM_OFFLOAD}")
    off.add_argument("--execute", action="store_true")
    off.set_defaults(func=cmd_offload)
    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    ns = parser.parse_args(argv)
    try:
        code = ns.func(ns)
    except Exception as e:
        code = _out(False, error=str(e))
    sys.exit(code)


if __name__ == "__main__":
    main()
