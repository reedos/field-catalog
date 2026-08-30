from __future__ import annotations

import argparse
import io
import json
import queue
import sys
import threading
from pathlib import Path

from .bursts import burst_pick, grouped
from .catalog import Catalog
from .disk import CONFIRM_DELETE, CONFIRM_OFFLOAD, DiskError, pending, unlink_originals
from .importer import backfill_dimensions, import_paths, refresh_previews, walk_photos
from .models import Shot


# Set from --pretty. A full list is thousands of rows crossing the Tauri IPC
# boundary as one string, so indentation is off unless a human asked for it.
_PRETTY = False


_CAPTURE = threading.local()


def _out(ok: bool, **payload) -> int:
    text = json.dumps({"ok": ok, **payload}, indent=2 if _PRETTY else None, default=str)
    buf = getattr(_CAPTURE, "buf", None)
    if buf is not None:
        buf.write(text)
    else:
        print(text)
    return 0 if ok else 1


def _stderr_progress(label: str, every: int = 50):
    """Progress callback that prints '<label> i/total' to stderr, never stdout."""
    last = {"i": 0}

    def progress(i: int, total: int) -> None:
        if i == total or i - last["i"] >= every:
            last["i"] = i
            print(f"{label} {i}/{total}", file=sys.stderr)

    return progress


def parse_field_marks(raw: str | None) -> list[str]:
    """Split a field-marks string.

    Pipes and newlines always separate. Commas separate too, but only when no
    pipe is present, so a mark that contains a comma can still be written as
    "white eyering, thin|chestnut nape".
    """
    if not raw:
        return []
    if "|" in raw or "\n" in raw:
        parts = raw.replace("\n", "|").split("|")
    else:
        parts = raw.split(",")
    return [p.strip() for p in parts if p.strip()]


_CATALOGS = threading.local()

# The active identify's cancel token, shared across serve lanes. A cancel that
# arrives moments before the identify registers is kept as `pending` briefly,
# so "Stop" clicked as the next item starts still lands.
_IDENTIFY = {"lock": threading.Lock(), "token": None, "pending_until": 0.0}


def _identify_begin(token) -> bool:
    """Register the active token. Returns False if a recent cancel is waiting."""
    import time

    with _IDENTIFY["lock"]:
        if _IDENTIFY["pending_until"] > time.monotonic():
            _IDENTIFY["pending_until"] = 0.0
            return False
        _IDENTIFY["token"] = token
        return True


def _identify_end() -> None:
    with _IDENTIFY["lock"]:
        _IDENTIFY["token"] = None


def _identify_cancel() -> bool:
    """Cancel the in-flight identify, or arm a short-lived pending cancel."""
    import time

    with _IDENTIFY["lock"]:
        token = _IDENTIFY["token"]
        if token is not None:
            token.cancel()
            return True
        _IDENTIFY["pending_until"] = time.monotonic() + 5.0
        return False


def _catalog(ns: argparse.Namespace) -> Catalog:
    cache = getattr(_CATALOGS, "cache", None)
    if cache is None:
        cache = _CATALOGS.cache = {}
    key = str(Path(ns.library).expanduser().resolve())
    cat = cache.get(key)
    if cat is None:
        cat = cache[key] = Catalog(Path(ns.library))
    return cat


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
        "subject_box": s.subject_box,
        "subject_sharpness": s.subject_sharpness,
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
        "life_list_pick": bool(s.life_list_pick),
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


def cmd_export(ns: argparse.Namespace) -> int:
    from .export import ExportError, export_originals

    cat = _catalog(ns)
    ids = [i.strip() for i in ns.ids.split(",") if i.strip()] if ns.ids else None
    try:
        result = export_originals(
            cat,
            Path(ns.dest),
            ids=ids,
            verdict=ns.verdict,
            progress=_stderr_progress("export", every=10),
        )
    except ExportError as e:
        return _out(False, error=str(e))
    return _out(True, **result)


def cmd_backup(ns: argparse.Namespace) -> int:
    from .maintenance import backup_catalog

    return _out(True, **backup_catalog(_catalog(ns)))


def cmd_doctor(ns: argparse.Namespace) -> int:
    from .maintenance import run_doctor

    result = run_doctor(_catalog(ns), fix=ns.fix, progress=_stderr_progress("doctor", every=200))
    return _out(True, **result)


def cmd_backfill_dimensions(ns: argparse.Namespace) -> int:
    cat = _catalog(ns)
    result = backfill_dimensions(cat, progress=_stderr_progress("dimensions", every=500))
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
    # Counts come from aggregates so --summary never hydrates a Shot, and the
    # limit reaches SQL instead of slicing a fully built list.
    total, verdicts, statuses = cat.counts(**where)
    payload = {
        "count": total,
        "verdicts": verdicts,
        "original_status": statuses,
        "previews": str(cat.previews),
    }
    if ns.summary:
        return _out(True, **payload)
    payload["shots"] = [shot_json(s) for s in cat.list(limit=ns.limit or None, **where)]
    if ns.limit and total > ns.limit:
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
        fields["animal_type"] = ns.animal_type
    if ns.field_marks is not None:
        fields["field_marks"] = json.dumps(parse_field_marks(ns.field_marks))
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
        from .animal import title_common, title_scientific

        ns.common_name = title_common(ns.common_name)
        ns.scientific_name = title_scientific(ns.scientific_name)
        animal = ns.animal_type or infer_animal_type(ns.common_name, ns.scientific_name)
        marks = parse_field_marks(ns.field_marks)
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
    from .vision import CancelToken

    token = CancelToken()
    if not _identify_begin(token):
        return _out(False, error="identify cancelled")
    try:
        result = identify_preview(shot.preview_path, library=cat.library, cancel=token)
    except IdentifyError as e:
        return _out(False, error=str(e))
    finally:
        _identify_end()
    from .animal import title_common, title_scientific
    from .sharpness import score_region

    # The model places the animal; we measure the frame there ourselves. A
    # box it declined to give, or gave badly enough to be rejected upstream,
    # leaves both fields null and the whole-frame score stands.
    box = result.get("subject_box")
    subject_sharpness = None
    if box:
        try:
            subject_sharpness = score_region(Path(shot.preview_path), box)
        except OSError:
            subject_sharpness = None
        if subject_sharpness is None:
            box = None

    fields = {
        "subject_box": json.dumps(box) if box else None,
        "subject_sharpness": subject_sharpness,
    }
    # --subject-only exists so a library whose names were curated by hand can
    # gain subject boxes without handing every species back to the model.
    if not getattr(ns, "subject_only", False):
        fields.update(
            common_name=title_common(result["common_name"]),
            scientific_name=title_scientific(result["scientific_name"]),
            animal_type=result["animal_type"],
            confidence=result["confidence"],
            field_marks=json.dumps(result["field_marks"]),
            similar_species=json.dumps(result["similar_species"]),
            notes=result["notes"],
        )
    updated = cat.update(ns.id, **fields)
    return _out(True, shot=shot_json(updated) if updated else shot_json(shot))


# Names that mean "there is nothing here to locate".
NO_SUBJECT = {"no animal identifiable", "no animal visible", "unidentifiable",
              "unidentified seabird", "unknown"}


def _pad_box(box: list[float], grow: float = 0.2) -> list[float]:
    """Grow a box outward, clamped to the frame.

    One detection is reused across a whole burst, and the animal does not hold
    still for it -- framing is shared between burst frames, the subject inside
    that framing is not. Padding trades tightness for still containing the
    animal on the last frame, which is the trade worth making: a loose box
    around the bird beats a tight box around where the bird used to be.
    """
    x, y, w, h = box
    dx, dy = w * grow / 2, h * grow / 2
    nx, ny = max(0.0, x - dx), max(0.0, y - dy)
    return [round(nx, 4), round(ny, 4),
            round(min(w + 2 * dx, 1.0 - nx), 4), round(min(h + 2 * dy, 1.0 - ny), 4)]


def cmd_detect_subjects(ns: argparse.Namespace) -> int:
    """Locate the animal once per burst, and score every frame on that region.

    Detecting per shot would be twelve times the model calls for a worse
    answer: each frame would get its own slightly different box, so the scores
    would not be comparable -- and comparing frames of one burst is the whole
    reason to want them.
    """
    from .bursts import burst_pick, grouped
    from .sharpness import score_region
    from .vision import IdentifyError, identify_preview

    cat = _catalog(ns)
    groups = grouped(cat.list())
    todo: list[tuple[str, object, list]] = []
    for bid, members in groups.items():
        named = [m for m in members if (m.common_name or "").strip().lower() not in NO_SUBJECT
                 and (m.common_name or "").strip()]
        if not named:
            continue
        if not ns.redo and all(m.subject_box for m in named):
            continue
        lead = burst_pick(named) or named[0]
        todo.append((bid, lead, named))
    if ns.limit:
        todo = todo[: ns.limit]

    done = boxed = scored = failed = adrift = 0
    for i, (bid, lead, members) in enumerate(todo, 1):
        print(f"subject {i}/{len(todo)}", file=sys.stderr, flush=True)
        try:
            res = identify_preview(lead.preview_path, library=cat.library)
        except IdentifyError:
            failed += 1
            continue
        box = res.get("subject_box")
        done += 1
        if not box:
            continue
        box = _pad_box(box, ns.pad)
        # After padding a box can cover most of the frame, at which point
        # "sharpness on the animal" is just the whole-frame score wearing a
        # different label. Storing that would be worse than storing nothing,
        # because the panel would present it as the more specific number.
        if box[2] * box[3] > 0.75:
            continue
        boxed += 1
        # One box reused across a burst assumes the animal stays inside it. When
        # it does not -- a sea lion swimming out of frame, a bird in flight --
        # the box ends up on whatever is left there, and water spray scores far
        # higher than an animal ever does. A region scoring several times the
        # whole frame is that, not a sharp subject, so the whole burst is left
        # unscored rather than scored wrongly.
        measured = []
        for m in members:
            try:
                sh = score_region(Path(m.preview_path), box)
            except OSError:
                sh = None
            if sh is None:
                continue
            measured.append((m.id, sh, m.sharpness or 0.0))
        drifted = any(sh > 3 * whole for _, sh, whole in measured if whole > 0)
        if drifted:
            adrift += 1
            continue
        for mid, sh, _ in measured:
            cat.update(mid, subject_box=json.dumps(box), subject_sharpness=sh)
            scored += 1
    return _out(True, groups=len(todo), detected=done, with_box=boxed,
                shots_scored=scored, failed=failed, subject_moved=adrift)


def cmd_identify_cancel(ns: argparse.Namespace) -> int:
    return _out(True, cancelled=_identify_cancel())


# Fields an identification writes. Clearing one means clearing all of them:
# if the species is wrong, the notes and field marks written about it are too.
IDENTITY_FIELDS = ("common_name", "scientific_name", "confidence",
                   "field_marks", "similar_species", "notes",
                   "subject_box", "subject_sharpness")


def cmd_life_list_pick(ns: argparse.Namespace) -> int:
    """Choose which frame represents a species on the life list."""
    cat = _catalog(ns)
    if ns.clear:
        shot = cat.update(ns.id, life_list_pick=False)
        return _out(True, shot=shot_json(shot)) if shot else _out(False, error="unknown id")
    shot = cat.set_life_list_pick(ns.id)
    return _out(True, shot=shot_json(shot)) if shot else _out(False, error="unknown id")


def cmd_clear_identity(ns: argparse.Namespace) -> int:
    """Remove an identification -- one shot, or every shot of a species.

    A shot with no name drops out of the life list, which is how a species that
    should never have been listed is removed.
    """
    cat = _catalog(ns)
    if ns.species:
        targets = cat.shots_of_species(ns.species)
        if not targets:
            return _out(False, error=f"no shots identified as {ns.species!r}")
    elif ns.id:
        shot = cat.get(ns.id)
        if not shot:
            return _out(False, error="unknown id")
        targets = [shot]
    else:
        return _out(False, error="pass --id or --species")

    blanks = {f: None for f in IDENTITY_FIELDS}
    blanks["life_list_pick"] = False
    cat.update_many([s.id for s in targets], **blanks)
    return _out(True, cleared=len(targets),
                ids=[s.id for s in targets],
                species=ns.species or None)


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
    """Bursts still awaiting a decision. A burst with nothing unrated has been
    dealt with, so it drops out of the queue unless --all asks for it."""
    cat = _catalog(ns)
    groups = grouped(cat.list())
    picks = []
    resolved = 0
    for bid, members in groups.items():
        pick = burst_pick(members)
        if not pick:
            continue
        unrated = sum(1 for m in members if m.verdict == "unrated")
        if not unrated:
            resolved += 1
            if not ns.all:
                continue
        picks.append(
            {
                "burst_id": bid,
                "count": len(members),
                "unrated": unrated,
                "keep": sum(1 for m in members if m.verdict == "keep"),
                "reject": sum(1 for m in members if m.verdict == "reject"),
                "keep_id": pick.id,
                "sharpness": pick.sharpness,
                "member_ids": [m.id for m in members],
                "reject_ids": [m.id for m in members if m.id != pick.id],
            }
        )
    return _out(True, bursts=picks, resolved=resolved)


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
            skip_backup=ns.no_backup,
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
    ident.add_argument(
        "--subject-only",
        dest="subject_only",
        action="store_true",
        help="write only the subject box and its sharpness; leave the identity alone",
    )
    ident.set_defaults(func=cmd_identify)

    ds = sub.add_parser(
        "detect-subjects",
        help="locate the animal once per burst and score every frame on that region",
    )
    ds.add_argument("--limit", type=int, default=0, help="stop after this many bursts")
    ds.add_argument("--pad", type=float, default=0.2, help="grow each box by this fraction")
    ds.add_argument("--redo", action="store_true", help="include bursts that already have boxes")
    ds.set_defaults(func=cmd_detect_subjects)

    sk = sub.add_parser("set-key", help="save XAI_API_KEY into the library folder (not the repo)")
    sk.add_argument("--value", required=True)
    sk.set_defaults(func=cmd_set_key)

    sub.add_parser("key-status", help="identify backend + whether an xAI key is saved").set_defaults(
        func=cmd_key_status
    )

    si = sub.add_parser("set-identify", help="choose local Ollama or xAI for Identify")
    si.add_argument("--backend", choices=["ollama", "xai"])
    si.add_argument("--model", default=None, help="Ollama vision model name, e.g. llama3.2-vision")
    si.add_argument("--url", default=None, help="Ollama base URL")
    si.set_defaults(func=cmd_set_identify)

    br = sub.add_parser("bursts", help="bursts awaiting a decision; --all includes resolved ones")
    br.add_argument("--all", action="store_true", help="include bursts already culled")
    br.set_defaults(func=cmd_bursts)

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
        sp.add_argument(
            "--no-backup",
            action="store_true",
            help="skip the automatic catalog backup before --execute",
        )
        sp.set_defaults(func=handler)

    fm = sub.add_parser("field-marks", help="list distinct field marks")
    fm.add_argument("--limit", type=int, default=200)
    fm.set_defaults(func=cmd_field_marks)

    lp = sub.add_parser("life-list-pick", help="choose which frame represents a species")
    lp.add_argument("--id", required=True)
    lp.add_argument("--clear", action="store_true", help="unset the pick, back to automatic")
    lp.set_defaults(func=cmd_life_list_pick)

    ci = sub.add_parser("clear-identity", help="remove an identification from a shot or a whole species")
    ci.add_argument("--id", default="", help="a single shot")
    ci.add_argument("--species", default="", help="every shot identified as this species")
    ci.set_defaults(func=cmd_clear_identity)

    ic = sub.add_parser("identify-cancel", help="abort the in-flight identify (serve mode)")
    ic.set_defaults(func=cmd_identify_cancel)

    ex = sub.add_parser("export-originals", help="copy originals (keepers by default) to a folder with a metadata CSV")
    ex.add_argument("--dest", required=True, help="destination folder")
    ex.add_argument("--verdict", default="keep")
    ex.add_argument("--ids", default="", help="comma-separated shot ids; overrides --verdict")
    ex.set_defaults(func=cmd_export)

    bk = sub.add_parser("backup", help="copy the catalog into library/backups, keeping the newest few")
    bk.set_defaults(func=cmd_backup)

    dr = sub.add_parser("doctor", help="library integrity report; --fix runs the safe backfills")
    dr.add_argument("--fix", action="store_true", help="backfill missing dimensions and content hashes")
    dr.set_defaults(func=cmd_doctor)

    bd = sub.add_parser("backfill-dimensions", help="fill preview sizes for rows imported before they were stored")
    bd.set_defaults(func=cmd_backfill_dimensions)

    sv = sub.add_parser("serve", help="persistent worker: JSON requests on stdin, responses on stdout")
    sv.set_defaults(func=cmd_serve)

    au = sub.add_parser("audit", help="read audit log")
    au.add_argument("--limit", type=int, default=200)
    au.set_defaults(func=cmd_audit)
    return p


# Commands that can run for minutes. They get their own lane so a verdict typed
# mid-import answers immediately instead of queueing behind it.
SLOW_COMMANDS = {"identify", "import", "refresh-previews", "backfill-dimensions", "doctor",
                 "export-originals", "detect-subjects"}


def serve_loop(library: str, stdin, stdout) -> None:
    """Persistent worker: one JSON request per stdin line, one response per line.

    Request:  {"id": <int>, "args": [<subcommand argv, no --library>]}
    Response: the same envelope the one-shot CLI prints, plus the request "id".
    Progress still goes to stderr, exactly as in one-shot mode. EOF on stdin is
    the shutdown signal -- the parent closing the pipe is how the app quits.
    """
    write_lock = threading.Lock()

    def respond(obj: dict) -> None:
        with write_lock:
            stdout.write(json.dumps(obj, default=str) + "\n")
            stdout.flush()

    def run_one(req_id, argv: list[str]) -> None:
        try:
            ns = build_parser().parse_args(["--library", str(library), *argv])
        except SystemExit:
            respond({"id": req_id, "ok": False, "error": f"bad arguments: {argv}"})
            return
        buf = io.StringIO()
        _CAPTURE.buf = buf
        try:
            ns.func(ns)
        except Exception as e:
            respond({"id": req_id, "ok": False, "error": str(e)})
            return
        finally:
            _CAPTURE.buf = None
        try:
            payload = json.loads(buf.getvalue())
        except (json.JSONDecodeError, ValueError):
            payload = {"ok": False, "error": "worker produced no JSON"}
        payload["id"] = req_id
        respond(payload)

    slow_q: queue.Queue = queue.Queue()

    def slow_worker() -> None:
        while True:
            item = slow_q.get()
            if item is None:
                return
            run_one(*item)

    slow_thread = threading.Thread(target=slow_worker, daemon=True)
    slow_thread.start()

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req["id"]
            argv = [str(a) for a in req["args"]]
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            respond({"id": None, "ok": False, "error": f"bad request: {e}"})
            continue
        if argv and argv[0] in SLOW_COMMANDS:
            slow_q.put((req_id, argv))
        else:
            run_one(req_id, argv)

    slow_q.put(None)
    slow_thread.join(timeout=5)


def cmd_serve(ns: argparse.Namespace) -> int:
    serve_loop(ns.library, sys.stdin, sys.stdout)
    return 0


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
