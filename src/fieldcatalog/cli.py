from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .bursts import burst_pick, grouped
from .catalog import Catalog
from .disk import CONFIRM_DELETE, CONFIRM_OFFLOAD, DiskError, pending, unlink_originals
from .importer import import_paths, refresh_previews, walk_photos
from .models import Shot


# Set from --pretty. A full list is thousands of rows crossing the Tauri IPC
# boundary as one string, so indentation is off unless a human asked for it.
_PRETTY = False


def _out(ok: bool, **payload) -> int:
    print(json.dumps({"ok": ok, **payload}, indent=2 if _PRETTY else None, default=str))
    return 0 if ok else 1


def _stderr_progress(label: str, every: int = 50):
    """Progress callback that prints '<label> i/total' to stderr, never stdout."""
    last = {"i": 0}

    def progress(i: int, total: int) -> None:
        if i == total or i - last["i"] >= every:
            last["i"] = i
            print(f"{label} {i}/{total}", file=sys.stderr)

    return progress


def _catalog(ns: argparse.Namespace) -> Catalog:
    return Catalog(Path(ns.library))


def shot_json(s: Shot) -> dict:
    return {
        "id": s.id,
        "original_path": s.original_path,
        "preview_path": s.preview_path,
        "original_status": s.original_status,
        "verdict": s.verdict,
        "captured_at": s.captured_at,
        "created_at": s.created_at,
        "lat": s.lat,
        "lon": s.lon,
        "sharpness": s.sharpness,
        "quality": s.quality,
        "burst_id": s.burst_id,
        "common_name": s.common_name,
        "scientific_name": s.scientific_name,
        "animal_type": s.animal_type,
        "stars": s.stars,
        "location": s.location,
        "favorite": bool(s.favorite),
        "color": s.color,
        "display_name": s.display_name,
        "camera": s.camera,
        "lens": s.lens,
        "iso": s.iso,
        "shutter": s.shutter,
        "aperture": s.aperture,
        "focal_length": s.focal_length,
        "bytes_original": s.bytes_original,
        "confidence": s.confidence,
        "field_marks": s.field_marks,
        "similar_species": s.similar_species,
        "notes": s.notes,
        "gps_from_file": bool(s.gps_from_file),
        "preview_width": s.preview_width,
        "preview_height": s.preview_height,
    }


def cmd_init(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    return _out(True, library=str(cat.library), db=str(cat.db_path), previews=str(cat.previews))


def cmd_import(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    paths = walk_photos(Path(ns.source))
    if not paths:
        return _out(False, error=f"no photos under {ns.source}")
    result = import_paths(cat, paths, progress=_stderr_progress("import", every=10))
    return _out(True, **result)


def cmd_refresh_previews(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    result = refresh_previews(cat, progress=_stderr_progress("refresh"))
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
    payload["shots"] = [shot_json(s) for s in shown]
    if ns.limit and len(shots) > ns.limit:
        payload["truncated"] = True
    return _out(True, **payload)


def cmd_set_verdict(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    shot = cat.update(ns.id, verdict=ns.verdict)
    if not shot:
        return _out(False, error="unknown id")
    return _out(True, id=shot.id, verdict=shot.verdict)


def cmd_get(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    shot = cat.get(ns.id)
    if not shot:
        return _out(False, error="unknown id")
    return _out(True, shot=shot_json(shot))


def cmd_set(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    fields: dict[str, object] = {}
    if ns.stars is not None:
        fields["stars"] = ns.stars
    if ns.favorite is not None:
        fields["favorite"] = bool(ns.favorite)
    if ns.color is not None:
        fields["color"] = None if ns.color in ("", "none", "clear") else ns.color
    if ns.location is not None:
        fields["location"] = ns.location
    if ns.animal_type is not None:
        fields["animal_type"] = ns.animal_type or None
    if ns.field_marks is not None:
        marks = [m.strip() for m in ns.field_marks.replace("\n", "|").split("|") if m.strip()]
        if "," in ns.field_marks and "|" not in ns.field_marks:
            marks = [m.strip() for m in ns.field_marks.split(",") if m.strip()]
        fields["field_marks"] = json.dumps(marks)
    if not fields:
        return _out(False, error="nothing to set")
    shot = cat.update(ns.id, **fields)
    if not shot:
        return _out(False, error="unknown id")
    return _out(True, shot=shot_json(shot))


def cmd_set_location(ns: argparse.Namespace) -> int:
    from .geocode import GeocodeError, apply_location, geocode_label

    cat = _catalog(ns)
    shot = cat.get(ns.id)
    if not shot:
        return _out(False, error="unknown id")
    try:
        fields = apply_location(
            bool(shot.gps_from_file),
            shot.lat,
            shot.lon,
            ns.location,
            geocode=lambda q: geocode_label(q, library=cat.library),
        )
    except GeocodeError as e:
        return _out(False, error=str(e), shot=shot_json(shot))
    updated = cat.update(ns.id, **fields)
    return _out(True, shot=shot_json(updated) if updated else shot_json(shot))


def cmd_set_location_by_date(ns: argparse.Namespace) -> int:
    from .geocode import GeocodeError, capture_day, geocode_label

    cat = _catalog(ns)
    day = capture_day(ns.date)
    if len(day) < 10:
        return _out(False, error="date must be YYYY-MM-DD")
    shots = [s for s in cat.list() if capture_day(s.captured_at) == day]
    if not shots:
        return _out(False, error=f"no shots captured on {day}", count=0, date=day)
    label = ns.location
    geo = None
    geo_error = None
    if any(not s.gps_from_file for s in shots) and (label or "").strip():
        try:
            geo = geocode_label(label, library=cat.library)
        except GeocodeError as e:
            geo_error = str(e)
    # Two groups, two statements -- shots carrying their own GPS keep it and
    # only take the label. One committed UPDATE per shot was the old cost here.
    pinned = [s.id for s in shots if geo and not s.gps_from_file]
    label_only = [s.id for s in shots if not (geo and not s.gps_from_file)]
    updated = cat.update_many(label_only, location=label)
    if geo:
        updated += cat.update_many(pinned, location=label, lat=geo[0], lon=geo[1])
    payload = {
        "count": updated,
        "date": day,
        "location": label,
        "geocoded": geo is not None,
    }
    if geo_error:
        payload["geocode_error"] = geo_error
    return _out(True, **payload)


def cmd_identify(ns: argparse.Namespace) -> int:
    from .animal import infer_animal_type
    from .vision import IdentifyError, identify_preview

    cat = _catalog(ns)
    shot = cat.get(ns.id)
    if not shot:
        return _out(False, error="unknown id")
    if ns.common_name:
        animal = ns.animal_type or infer_animal_type(ns.common_name, ns.scientific_name)
        marks = [m.strip() for m in (ns.field_marks or "").replace("\n", "|").split("|") if m.strip()]
        fields: dict[str, object] = {
            "common_name": ns.common_name,
            "scientific_name": ns.scientific_name or None,
            "animal_type": animal,
        }
        if ns.confidence is not None:
            fields["confidence"] = ns.confidence
        if ns.field_marks is not None:
            fields["field_marks"] = json.dumps(marks)
        updated = cat.update(ns.id, **fields)
        if not updated:
            return _out(False, error="unknown id")
        return _out(True, shot=shot_json(updated))
    try:
        result = identify_preview(shot.preview_path, library=cat.library)
    except IdentifyError as e:
        return _out(False, error=str(e))
    updated = cat.update(
        ns.id,
        common_name=result["common_name"],
        scientific_name=result["scientific_name"],
        animal_type=result["animal_type"],
        confidence=result["confidence"],
        field_marks=json.dumps(result["field_marks"]),
        similar_species=json.dumps(result["similar_species"]),
        notes=result["notes"],
    )
    return _out(True, shot=shot_json(updated) if updated else shot_json(shot))


def cmd_set_key(ns: argparse.Namespace) -> int:
    from .vision import save_api_key

    cat = _catalog(ns)
    save_api_key(cat.library, ns.value)
    return _out(True, has_xai_key=bool((ns.value or "").strip()))


def cmd_key_status(ns: argparse.Namespace) -> int:
    from .vision import load_api_key, load_config

    cat = _catalog(ns)
    cfg = load_config(cat.library)
    return _out(
        True,
        has_xai_key=bool(load_api_key(cat.library)),
        backend=cfg["backend"],
        ollama_model=cfg["ollama_model"],
        ollama_url=cfg["ollama_url"],
    )


def cmd_set_identify(ns: argparse.Namespace) -> int:
    from .vision import load_api_key, save_config

    cat = _catalog(ns)
    cfg = save_config(
        cat.library,
        backend=ns.backend,
        ollama_model=ns.model,
        ollama_url=ns.url,
    )
    return _out(
        True,
        has_xai_key=bool(load_api_key(cat.library)),
        **cfg,
    )


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
                "member_ids": [m.id for m in members],
                "reject_ids": [m.id for m in members if m.id != pick.id],
            }
        )
    return _out(True, bursts=picks)


def cmd_pending_deletes(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    items = pending(cat, verdict=ns.verdict, all_verdicts=ns.all)
    return _out(True, count=len(items), bytes=sum(i["bytes"] for i in items), files=items)


def _unlink_cmd(ns: argparse.Namespace, action: str) -> int:
    cat = _catalog(ns)
    ids = [i.strip() for i in ns.ids.split(",") if i.strip()]
    try:
        result = unlink_originals(
            cat,
            ids,
            action=action,
            confirm=ns.confirm or "",
            execute=ns.execute,
            allow_any_verdict=ns.allow_any_verdict,
            permanent=ns.permanent,
        )
    except DiskError as e:
        return _out(False, error=str(e))
    return _out(True, **result)


def cmd_delete(ns: argparse.Namespace) -> int:
    return _unlink_cmd(ns, "delete")


def cmd_offload(ns: argparse.Namespace) -> int:
    return _unlink_cmd(ns, "offload")



def cmd_field_marks(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    marks = cat.distinct_field_marks(limit=ns.limit)
    return _out(True, marks=marks)



def cmd_audit(ns: argparse.Namespace) -> int:
    from pathlib import Path
    lib = Path(ns.library).expanduser()
    log_path = lib / "audit.jsonl"
    entries = []
    if log_path.is_file():
        import json
        with open(log_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    continue
    entries = entries[-ns.limit:] if ns.limit else entries
    return _out(True, entries=entries)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="fieldcatalog", description="Field Catalog local worker")
    p.add_argument("--library", default="~/FieldCatalog", help="catalog root (previews + sqlite)")
    p.add_argument("--pretty", action="store_true", help="indent the JSON output for reading by hand")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create library folders").set_defaults(func=cmd_init)

    im = sub.add_parser("import", help="import a folder or file; originals stay put")
    im.add_argument("--source", required=True)
    im.set_defaults(func=cmd_import)

    rp = sub.add_parser("refresh-previews", help="rewrite previews from originals (fixes orientation)")
    rp.set_defaults(func=cmd_refresh_previews)

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

    gt = sub.add_parser("get", help="one shot by id")
    gt.add_argument("--id", required=True)
    gt.set_defaults(func=cmd_get)

    st = sub.add_parser("set", help="stars, favorite, color, location label; never writes lat/lon")
    st.add_argument("--id", required=True)
    st.add_argument("--stars", type=int, choices=range(0, 6))
    st.add_argument("--favorite", type=int, choices=[0, 1])
    st.add_argument("--color", default=None)
    st.add_argument("--location", default=None, help="place-name label only; does not move GPS")
    st.add_argument(
        "--animal-type",
        dest="animal_type",
        choices=["bird", "mammal", "herp", "fish", "invertebrate", "other"],
    )
    st.add_argument("--field-marks", dest="field_marks", default=None)
    st.set_defaults(func=cmd_set)

    loc = sub.add_parser("set-location", help="place-name label; geocodes only if file has no GPS")
    loc.add_argument("--id", required=True)
    loc.add_argument("--location", required=True)
    loc.set_defaults(func=cmd_set_location)

    lbd = sub.add_parser("set-location-by-date", help="set place label for every shot captured on a calendar day")
    lbd.add_argument("--date", required=True, help="YYYY-MM-DD from captured_at")
    lbd.add_argument("--location", required=True)
    lbd.set_defaults(func=cmd_set_location_by_date)

    ident = sub.add_parser("identify")
    ident.add_argument("--id", required=True)
    ident.add_argument("--common-name", default="")
    ident.add_argument("--scientific-name", default="")
    ident.add_argument("--confidence", type=float, default=None)
    ident.add_argument("--field-marks", dest="field_marks", default=None)
    ident.add_argument(
        "--animal-type",
        dest="animal_type",
        choices=["bird", "mammal", "herp", "fish", "invertebrate", "other"],
    )
    ident.set_defaults(func=cmd_identify)

    sk = sub.add_parser("set-key", help="save XAI_API_KEY into the library folder (not the repo)")
    sk.add_argument("--value", required=True)
    sk.set_defaults(func=cmd_set_key)

    sub.add_parser("key-status", help="identify backend + whether an xAI key is saved").set_defaults(
        func=cmd_key_status
    )

    si = sub.add_parser("set-identify", help="choose local Ollama or xAI for Identify")
    si.add_argument("--backend", choices=["ollama", "xai"])
    si.add_argument("--model", default=None, help="Ollama model name, e.g. muse-glimmer:30b")
    si.add_argument("--url", default=None, help="Ollama base URL")
    si.set_defaults(func=cmd_set_identify)

    sub.add_parser("bursts", help="recommended keep per burst").set_defaults(func=cmd_bursts)

    pd = sub.add_parser("pending-deletes", help="list originals that would be unlinked")
    pd.add_argument("--verdict", default="reject")
    pd.add_argument("--all", action="store_true", help="list every present original, not just --verdict")
    pd.set_defaults(func=cmd_pending_deletes)

    for name, helptext, confirm_word, handler in (
        ("delete-originals", "unlink rejected originals; previews stay", CONFIRM_DELETE, cmd_delete),
        ("offload-originals", "unlink keepers after cloud copy; previews stay", CONFIRM_OFFLOAD, cmd_offload),
    ):
        sp = sub.add_parser(name, help=helptext)
        sp.add_argument("--ids", required=True, help="comma-separated shot ids")
        sp.add_argument("--confirm", default="", help=f"must be {confirm_word}")
        sp.add_argument("--execute", action="store_true", help="actually unlink; omit for dry-run")
        sp.add_argument(
            "--allow-any-verdict",
            action="store_true",
            help="skip the verdict check (delete expects reject, offload expects keep)",
        )
        sp.add_argument(
            "--permanent",
            action="store_true",
            help="bypass the recycle bin and unlink outright",
        )
        sp.set_defaults(func=handler)

    fm = sub.add_parser("field-marks", help="list distinct field marks")
    fm.add_argument("--limit", type=int, default=200)
    fm.set_defaults(func=cmd_field_marks)

    au = sub.add_parser("audit", help="read audit log")
    au.add_argument("--limit", type=int, default=200)
    au.set_defaults(func=cmd_audit)
    return p


def main(argv: list[str] | None = None) -> None:
    global _PRETTY
    parser = build_parser()
    ns = parser.parse_args(argv)
    _PRETTY = getattr(ns, "pretty", False)
    try:
        code = ns.func(ns)
    except Exception as e:
        code = _out(False, error=str(e))
    sys.exit(code)


if __name__ == "__main__":
    main()
