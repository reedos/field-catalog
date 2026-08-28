import json
from datetime import datetime
from fractions import Fraction
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from fieldcatalog.animal import infer_animal_type
from fieldcatalog.bursts import assign_bursts, burst_pick
from fieldcatalog.catalog import Catalog
from fieldcatalog.disk import (
    CONFIRM_DELETE,
    CONFIRM_OFFLOAD,
    DiskError,
    pending,
    unlink_originals,
)
from fieldcatalog.importer import import_paths
from fieldcatalog.geocode import apply_location, capture_day
from fieldcatalog.models import Shot
from fieldcatalog.sharpness import score_sharpness
from fieldcatalog.vision import load_config, parse_identity


def test_animal_type():
    assert infer_animal_type("House Sparrow") == "bird"
    assert infer_animal_type("American Robin") == "bird"
    assert infer_animal_type("Mule Deer") == "mammal"
    assert infer_animal_type("Great Blue Heron") == "bird"


def test_burst_pick_sharpest():
    a = Shot(id="a", original_path="a", preview_path="a", captured_at="2026-01-01T10:00:00", sharpness=10)
    b = Shot(id="b", original_path="b", preview_path="b", captured_at="2026-01-01T10:00:04", sharpness=40)
    c = Shot(id="c", original_path="c", preview_path="c", captured_at="2026-01-01T10:00:07", sharpness=20)
    assign_bursts([a, b, c])
    assert a.burst_id == b.burst_id == c.burst_id
    assert burst_pick([a, b, c]).id == "b"


def test_import_and_delete_keeps_preview(tmp_path: Path):
    src = tmp_path / "card"
    src.mkdir()
    original = src / "DSC_0001.jpg"
    Image.new("RGB", (400, 300), (40, 80, 40)).save(original, "JPEG")
    lib = tmp_path / "library"
    cat = Catalog(lib)
    result = import_paths(cat, [original])
    assert result["imported"] == 1
    shot = cat.get(result["ids"][0])
    assert shot is not None
    assert Path(shot.preview_path).is_file()
    assert original.is_file()

    cat.update(shot.id, verdict="reject")
    try:
        unlink_originals(cat, [shot.id], action="delete", confirm="nope", execute=True)
        assert False, "should require confirm"
    except DiskError:
        pass
    assert original.is_file()

    dry = unlink_originals(cat, [shot.id], action="delete", confirm=CONFIRM_DELETE, execute=False)
    assert dry["dry_run"] is True
    assert original.is_file()

    done = unlink_originals(
        cat, [shot.id], action="delete", confirm=CONFIRM_DELETE, execute=True, permanent=True
    )
    assert done["count"] == 1
    assert not original.is_file()
    assert Path(shot.preview_path).is_file()
    assert cat.get(shot.id).original_status == "deleted"


def test_set_location_does_not_move_gps(tmp_path: Path):
    lib = tmp_path / "library"
    cat = Catalog(lib)
    shot = Shot(
        id="gps1",
        original_path=str(tmp_path / "a.jpg"),
        preview_path=str(lib / "previews" / "gps1.jpg"),
        lat=12.34,
        lon=56.78,
        location="",
        gps_from_file=True,
    )
    cat.upsert(shot)
    updated = cat.update("gps1", location="ridge trail")
    assert updated is not None
    assert updated.location == "ridge trail"
    assert updated.lat == 12.34
    assert updated.lon == 56.78


def test_sharpness_ranks(tmp_path: Path):
    sharp = tmp_path / "s.jpg"
    blur = tmp_path / "b.jpg"
    Image.new("RGB", (200, 200), (0, 0, 0)).save(blur, "JPEG")
    img = Image.new("RGB", (200, 200), (0, 0, 0))
    px = img.load()
    for x in range(200):
        px[x, 100] = (255, 255, 255)
    img.save(sharp, "JPEG")
    assert score_sharpness(sharp) > score_sharpness(blur)


def test_set_location_by_date_one_geocode(tmp_path: Path):
    from fieldcatalog.cli import cmd_set_location_by_date
    from argparse import Namespace

    lib = tmp_path / "library"
    cat = Catalog(lib)
    a = Shot(id="a", original_path="a.jpg", preview_path="a.jpg", captured_at="2026-08-23T09:00:00", gps_from_file=False)
    b = Shot(id="b", original_path="b.jpg", preview_path="b.jpg", captured_at="2026-08-23T11:00:00", gps_from_file=True, lat=1.0, lon=2.0)
    c = Shot(id="c", original_path="c.jpg", preview_path="c.jpg", captured_at="2026-07-04T08:00:00")
    cat.upsert(a)
    cat.upsert(b)
    cat.upsert(c)
    ns = Namespace(library=str(lib), date="2026-08-23", location="ridge trail")
    import fieldcatalog.geocode as geo

    orig = geo.geocode_label
    geo.geocode_label = lambda _label, **_kw: (10.0, -20.0)
    try:
        code = cmd_set_location_by_date(ns)
    finally:
        geo.geocode_label = orig
    assert code == 0
    assert cat.get("a").location == "ridge trail"
    assert cat.get("a").lat == 10.0
    assert cat.get("b").location == "ridge trail"
    assert cat.get("b").lat == 1.0
    assert cat.get("c").location == ""


def test_capture_day_from_iso():
    assert capture_day("2026-08-23T09:18:08") == "2026-08-23"
    assert capture_day("2026-08-23") == "2026-08-23"


def test_apply_location_keeps_file_gps():
    fields = apply_location(True, 12.34, 56.78, "ridge trail", geocode=lambda _: (1.0, 2.0))
    assert fields == {"location": "ridge trail"}


def test_apply_location_geocodes_when_no_file_gps():
    fields = apply_location(False, None, None, "ridge trail", geocode=lambda _: (10.5, -20.25))
    assert fields["location"] == "ridge trail"
    assert fields["lat"] == 10.5
    assert fields["lon"] == -20.25


def test_apply_location_clears_pin_when_label_empty():
    fields = apply_location(False, 10.5, -20.25, "", geocode=lambda _: (0.0, 0.0))
    assert fields["lat"] is None
    assert fields["lon"] is None


def test_parse_identity_factual():
    raw = '{"commonName":"House Sparrow","scientificName":"Passer domesticus","animalType":"bird","confidence":0.91,"fieldMarks":["black bib","chestnut nape"],"similarSpecies":["Harris\'s Sparrow"],"notes":"Adult male in breeding plumage."}'
    got = parse_identity(raw)
    assert got["common_name"] == "House Sparrow"
    assert got["scientific_name"] == "Passer domesticus"
    assert got["animal_type"] == "bird"
    assert got["confidence"] == 0.91
    assert got["field_marks"] == ["black bib", "chestnut nape"]
    assert got["similar_species"] == ["Harris's Sparrow"]
    assert got["notes"] == "Adult male in breeding plumage."
    assert "you spotted" not in got["notes"].lower()


def test_identify_defaults_to_local_ollama(tmp_path: Path):
    cfg = load_config(tmp_path)
    assert cfg["backend"] == "ollama"
    assert cfg["ollama_model"] == "muse-glimmer:30b"


# --- delete / offload safety -------------------------------------------------


def _library_with_shots(tmp_path: Path, n: int, verdict: str = "reject"):
    """Build a library with n imported JPEGs, all set to the given verdict."""
    src = tmp_path / "card"
    src.mkdir()
    originals = []
    for i in range(n):
        p = src / f"DSC_{i:04d}.jpg"
        Image.new("RGB", (80, 60), (10 * i, 80, 40)).save(p, "JPEG")
        originals.append(p)
    cat = Catalog(tmp_path / "library")
    result = import_paths(cat, originals)
    assert result["imported"] == n
    for sid in result["ids"]:
        cat.update(sid, verdict=verdict)
    return cat, result["ids"], originals


def test_dry_run_lists_every_file(tmp_path: Path):
    """A dry run must describe all planned files -- it is what the user confirms."""
    cat, ids, originals = _library_with_shots(tmp_path, 4)
    dry = unlink_originals(cat, ids, action="delete", confirm=CONFIRM_DELETE, execute=False)
    assert dry["dry_run"] is True
    assert dry["count"] == 4
    assert len(dry["files"]) == 4
    assert {f["id"] for f in dry["files"]} == set(ids)
    assert dry["bytes"] == sum(p.stat().st_size for p in originals)
    assert all(p.is_file() for p in originals)


def test_delete_refuses_non_rejects(tmp_path: Path):
    cat, ids, originals = _library_with_shots(tmp_path, 2, verdict="keep")
    dry = unlink_originals(cat, ids, action="delete", confirm=CONFIRM_DELETE, execute=False)
    assert dry["count"] == 0
    assert len(dry["errors"]) == 2
    assert all("verdict" in e["error"] for e in dry["errors"])

    forced = unlink_originals(
        cat, ids, action="delete", confirm=CONFIRM_DELETE, execute=False, allow_any_verdict=True
    )
    assert forced["count"] == 2


def test_offload_requires_keep_and_keeps_previews(tmp_path: Path):
    cat, ids, originals = _library_with_shots(tmp_path, 2, verdict="keep")
    try:
        unlink_originals(cat, ids, action="offload", confirm=CONFIRM_DELETE, execute=True)
        assert False, "offload must reject the delete confirm string"
    except DiskError:
        pass

    done = unlink_originals(
        cat, ids, action="offload", confirm=CONFIRM_OFFLOAD, execute=True, permanent=True
    )
    assert done["count"] == 2
    assert not any(p.is_file() for p in originals)
    for sid in ids:
        shot = cat.get(sid)
        assert shot.original_status == "offloaded"
        assert Path(shot.preview_path).is_file()


def test_offload_refuses_rejects(tmp_path: Path):
    cat, ids, _ = _library_with_shots(tmp_path, 1, verdict="reject")
    dry = unlink_originals(cat, ids, action="offload", confirm=CONFIRM_OFFLOAD, execute=False)
    assert dry["count"] == 0
    assert "verdict" in dry["errors"][0]["error"]


def test_guard_refuses_catalog_files(tmp_path: Path):
    cat, ids, _ = _library_with_shots(tmp_path, 1)
    shot = cat.get(ids[0])

    # An original that points at the preview itself.
    cat.update(shot.id, original_path=shot.preview_path)
    dry = unlink_originals(cat, [shot.id], action="delete", confirm=CONFIRM_DELETE, execute=False)
    assert dry["count"] == 0
    assert "preview" in dry["errors"][0]["error"]

    # An original that points at the sqlite database.
    cat.update(shot.id, original_path=str(cat.db_path))
    dry = unlink_originals(cat, [shot.id], action="delete", confirm=CONFIRM_DELETE, execute=False)
    assert dry["count"] == 0
    assert "database" in dry["errors"][0]["error"]


def test_guard_refuses_missing_and_already_deleted(tmp_path: Path):
    cat, ids, originals = _library_with_shots(tmp_path, 2)

    cat.update(ids[0], original_path=str(tmp_path / "gone.jpg"))
    cat.update(ids[1], original_status="deleted")
    dry = unlink_originals(cat, ids, action="delete", confirm=CONFIRM_DELETE, execute=False)
    assert dry["count"] == 0
    errors = " ".join(e["error"] for e in dry["errors"])
    assert "missing on disk" in errors
    assert "already deleted" in errors


def test_unknown_id_does_not_stop_the_batch(tmp_path: Path):
    cat, ids, originals = _library_with_shots(tmp_path, 2)
    dry = unlink_originals(
        cat, [ids[0], "no-such-id", ids[1]], action="delete", confirm=CONFIRM_DELETE, execute=False
    )
    assert dry["count"] == 2
    assert dry["errors"] == [{"id": "no-such-id", "error": "unknown id"}]


def test_audit_failure_does_not_report_a_failed_delete(tmp_path: Path, monkeypatch):
    cat, ids, originals = _library_with_shots(tmp_path, 1)
    monkeypatch.setattr(
        "fieldcatalog.disk.audit_log",
        lambda *a, **k: (_ for _ in ()).throw(OSError("log is read-only")),
    )
    done = unlink_originals(
        cat, ids, action="delete", confirm=CONFIRM_DELETE, execute=True, permanent=True
    )
    assert done["count"] == 1
    assert not originals[0].is_file()
    assert "log is read-only" in done["audit_error"]


def test_delete_uses_the_recycle_bin_by_default(tmp_path: Path, monkeypatch):
    cat, ids, originals = _library_with_shots(tmp_path, 1)
    trashed = []
    monkeypatch.setattr("send2trash.send2trash", lambda p: trashed.append(p) or Path(p).unlink())
    done = unlink_originals(cat, ids, action="delete", confirm=CONFIRM_DELETE, execute=True)
    assert done["disposal"] == ["trash"]
    assert trashed == [str(originals[0].resolve())]


def test_pending_defaults_to_rejects_only(tmp_path: Path):
    cat, ids, _ = _library_with_shots(tmp_path, 3)
    cat.update(ids[0], verdict="keep")

    assert len(pending(cat)) == 2
    assert len(pending(cat, verdict="")) == 2       # empty means reject, not everything
    assert len(pending(cat, verdict="keep")) == 1
    assert len(pending(cat, all_verdicts=True)) == 3


# --- exif / preview correctness ---------------------------------------------


def test_shutter_formats_the_same_from_either_source():
    """exiftool -n hands back a float where PIL hands back a rational."""
    from fieldcatalog.exif import _shutter

    assert _shutter(0.008) == "1/125"
    assert _shutter(Fraction(1, 125)) == "1/125"
    assert _shutter(2.0) == "2"
    assert _shutter(0) == "0"


def test_mtime_fallback_is_local_not_utc(tmp_path: Path):
    """A UTC fallback would shift the shot into another capture day."""
    from fieldcatalog.exif import parse_exif

    p = tmp_path / "no_exif.png"
    Image.new("RGB", (10, 10), (1, 2, 3)).save(p, "PNG")
    meta = parse_exif(p)
    expected = datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")
    assert meta["captured_at"] == expected


def test_tiny_embedded_jpeg_is_rejected(tmp_path: Path):
    """The size floor was inert: both branches of the ternary returned `best`."""
    from fieldcatalog.preview import MIN_EMBEDDED_JPEG, extract_embedded_jpeg

    tiny = tmp_path / "tiny.nef"
    buf = BytesIO()
    Image.new("RGB", (16, 16), (9, 9, 9)).save(buf, "JPEG")
    assert len(buf.getvalue()) < MIN_EMBEDDED_JPEG
    tiny.write_bytes(b"\x00" * 64 + buf.getvalue())
    assert extract_embedded_jpeg(tiny) is None

    big = tmp_path / "big.nef"
    buf2 = BytesIO()
    # Noise, not flat colour -- a solid image compresses below the threshold.
    noise = np.random.default_rng(0).integers(0, 256, (400, 400, 3), dtype=np.uint8)
    Image.fromarray(noise, "RGB").save(buf2, "JPEG", quality=95)
    assert len(buf2.getvalue()) > MIN_EMBEDDED_JPEG
    big.write_bytes(b"\x00" * 64 + buf2.getvalue())
    assert extract_embedded_jpeg(big) is not None


def test_geocode_cache_is_per_library(tmp_path: Path):
    """One library's pins must not leak into another's cache file."""
    import fieldcatalog.geocode as geo

    lib_a, lib_b = tmp_path / "a", tmp_path / "b"
    lib_a.mkdir()
    lib_b.mkdir()
    geo._cache_for(lib_a)["ridge trail"] = (1.0, 2.0)
    geo._cache_for(lib_b)["other place"] = (3.0, 4.0)
    geo._save_disk_cache(lib_a)
    geo._save_disk_cache(lib_b)

    written_a = json.loads((lib_a / "geocode-cache.json").read_text())
    written_b = json.loads((lib_b / "geocode-cache.json").read_text())
    assert list(written_a) == ["ridge trail"]
    assert list(written_b) == ["other place"]


def test_save_cache_survives_a_read_only_library(tmp_path: Path, monkeypatch):
    import fieldcatalog.geocode as geo

    monkeypatch.setattr(
        Path, "write_text", lambda *a, **k: (_ for _ in ()).throw(OSError("read-only"))
    )
    geo._save_disk_cache(tmp_path)  # must not raise


def test_identify_reports_malformed_json_clearly():
    from fieldcatalog.vision import IdentifyError, parse_identity

    try:
        parse_identity('{"commonName": "House Sparrow",}')
        assert False, "should reject malformed JSON"
    except IdentifyError as e:
        assert "malformed JSON" in str(e)


def test_set_location_by_date_writes_in_two_statements(tmp_path: Path):
    """Shots with their own GPS take the label only; the rest also take the pin."""
    from argparse import Namespace

    import fieldcatalog.geocode as geo
    from fieldcatalog.cli import cmd_set_location_by_date

    lib = tmp_path / "library"
    cat = Catalog(lib)
    for i in range(5):
        cat.upsert(
            Shot(
                id=f"s{i}",
                original_path=f"{i}.jpg",
                preview_path=f"{i}.jpg",
                captured_at="2026-08-23T09:00:00",
                gps_from_file=(i == 0),
                lat=1.0 if i == 0 else None,
                lon=2.0 if i == 0 else None,
            )
        )
    orig = geo.geocode_label
    geo.geocode_label = lambda _label, **_kw: (10.0, -20.0)
    try:
        assert cmd_set_location_by_date(
            Namespace(library=str(lib), date="2026-08-23", location="ridge trail")
        ) == 0
    finally:
        geo.geocode_label = orig

    assert cat.get("s0").lat == 1.0  # file GPS untouched
    assert cat.get("s0").location == "ridge trail"
    for i in range(1, 5):
        assert cat.get(f"s{i}").lat == 10.0
        assert cat.get(f"s{i}").location == "ridge trail"


def test_update_many_is_one_transaction(tmp_path: Path):
    cat = Catalog(tmp_path / "library")
    ids = []
    for i in range(4):
        cat.upsert(Shot(id=f"u{i}", original_path=f"{i}.jpg", preview_path=f"{i}.jpg"))
        ids.append(f"u{i}")
    assert cat.update_many(ids, location="ridge trail") == 4
    assert all(cat.get(i).location == "ridge trail" for i in ids)
    assert cat.update_many([], location="x") == 0
    assert cat.update_many(ids) == 0


def test_import_stores_preview_dimensions(tmp_path: Path):
    """The grid lays out from these; without them every thumbnail load repacks."""
    src = tmp_path / "card"
    src.mkdir()
    Image.new("RGB", (3000, 2000), (40, 80, 40)).save(src / "land.jpg", "JPEG")
    Image.new("RGB", (2000, 3000), (40, 80, 40)).save(src / "port.jpg", "JPEG")
    cat = Catalog(tmp_path / "library")
    result = import_paths(cat, sorted(src.glob("*.jpg")))
    assert result["imported"] == 2

    by_name = {s.display_name: s for s in cat.list()}
    land, port = by_name["land"], by_name["port"]
    assert (land.preview_width, land.preview_height) == (1600, 1066)
    assert (port.preview_width, port.preview_height) == (1066, 1600)
    assert land.preview_width > land.preview_height
    assert port.preview_height > port.preview_width


def test_refresh_previews_backfills_dimensions(tmp_path: Path):
    """Existing libraries have NULL dimensions until previews are refreshed."""
    from fieldcatalog.importer import refresh_previews

    src = tmp_path / "card"
    src.mkdir()
    Image.new("RGB", (3000, 2000), (40, 80, 40)).save(src / "a.jpg", "JPEG")
    cat = Catalog(tmp_path / "library")
    sid = import_paths(cat, [src / "a.jpg"])["ids"][0]

    cat.update(sid, preview_width=None, preview_height=None)
    assert cat.get(sid).preview_width is None

    assert refresh_previews(cat)["refreshed"] == 1
    assert (cat.get(sid).preview_width, cat.get(sid).preview_height) == (1600, 1066)


def test_exiftool_runs_once_per_batch_not_once_per_file(tmp_path: Path, monkeypatch):
    """Starting exiftool costs far more than reading a file; import must batch."""
    import subprocess as sp

    import fieldcatalog.exif as exif

    src = tmp_path / "card"
    src.mkdir()
    paths = []
    for i in range(25):
        p = src / f"DSC_{i:03d}.jpg"
        Image.new("RGB", (60, 40), (i * 5, 80, 40)).save(p, "JPEG")
        paths.append(p)

    spawns = []

    class FakeProc:
        returncode = 0

        def __init__(self, files):
            self.stdout = json.dumps(
                [
                    {
                        "SourceFile": f,
                        "DateTimeOriginal": "2026:08:23 09:00:00",
                        "Make": "NIKON",
                        "Model": "D850",
                        "ShutterSpeed": 0.008,
                    }
                    for f in files
                ]
            )

    def fake_run(argv, **kw):
        files = [a for a in argv[1:] if not a.startswith("-")]
        spawns.append(len(files))
        return FakeProc(files)

    monkeypatch.setattr(exif.shutil, "which", lambda _n: "exiftool")
    monkeypatch.setattr(sp, "run", fake_run)

    metas = exif.parse_exif_many(paths)
    assert len(spawns) == 1, f"expected one spawn, got {len(spawns)}"
    assert spawns[0] == 25
    assert all(m["camera"] == "NIKON D850" for m in metas.values())
    assert all(m["shutter"] == "1/125" for m in metas.values())


def test_exiftool_batches_are_chunked(tmp_path: Path, monkeypatch):
    """A very large card must not blow the command-line length limit."""
    import subprocess as sp

    import fieldcatalog.exif as exif

    spawns = []

    class FakeProc:
        returncode = 0
        stdout = "[]"

    def fake_run(argv, **kw):
        spawns.append(len([a for a in argv[1:] if not a.startswith("-")]))
        return FakeProc()

    monkeypatch.setattr(exif.shutil, "which", lambda _n: "exiftool")
    monkeypatch.setattr(sp, "run", fake_run)

    fake_paths = [tmp_path / f"{i}.jpg" for i in range(exif.EXIFTOOL_BATCH * 2 + 5)]
    exif._exiftool_rows(fake_paths)
    assert len(spawns) == 3
    assert spawns == [exif.EXIFTOOL_BATCH, exif.EXIFTOOL_BATCH, 5]


def test_import_skips_exif_for_already_imported_files(tmp_path: Path, monkeypatch):
    """Re-importing a known card should not re-read any EXIF."""
    import fieldcatalog.importer as importer

    src = tmp_path / "card"
    src.mkdir()
    for i in range(3):
        Image.new("RGB", (60, 40), (i * 5, 80, 40)).save(src / f"DSC_{i}.jpg", "JPEG")
    files = sorted(src.glob("*.jpg"))
    cat = Catalog(tmp_path / "library")
    assert import_paths(cat, files)["imported"] == 3

    asked = []
    real = importer.parse_exif_many
    monkeypatch.setattr(importer, "parse_exif_many", lambda ps: asked.append(len(ps)) or real(ps))
    assert import_paths(cat, files)["skipped"] == 3
    assert asked == [0]


def test_list_limit_reaches_sql_and_counts_are_aggregates(tmp_path: Path):
    cat = Catalog(tmp_path / "library")
    for i in range(7):
        cat.upsert(
            Shot(
                id=f"n{i}",
                original_path=f"{i}.jpg",
                preview_path=f"{i}.jpg",
                captured_at=f"2026-08-{10 + i:02d}T09:00:00",
                verdict="keep" if i < 3 else "reject",
            )
        )
    assert len(cat.list()) == 7
    assert len(cat.list(limit=3)) == 3
    assert len(cat.list(limit=3, verdict="keep")) == 3
    assert len(cat.list(verdict="keep")) == 3

    total, verdicts, statuses = cat.counts()
    assert total == 7
    assert verdicts == {"keep": 3, "reject": 4}
    assert statuses == {"present": 7}

    total, verdicts, _ = cat.counts(verdict="keep")
    assert (total, verdicts) == (3, {"keep": 3})

    # Newest first, and the limit takes the newest rather than an arbitrary slice.
    assert [s.id for s in cat.list(limit=2)] == ["n6", "n5"]

    empty = Catalog(tmp_path / "empty")
    assert empty.counts() == (0, {}, {})


def test_field_marks_split_the_same_way_everywhere():
    """`set` and `identify` used to parse this field with different rules."""
    from fieldcatalog.cli import parse_field_marks

    assert parse_field_marks("black bib, chestnut nape") == ["black bib", "chestnut nape"]
    assert parse_field_marks("black bib|chestnut nape") == ["black bib", "chestnut nape"]
    assert parse_field_marks("black bib\nchestnut nape") == ["black bib", "chestnut nape"]
    # A pipe present means commas are part of the mark, not separators.
    assert parse_field_marks("white eyering, thin|black bib") == ["white eyering, thin", "black bib"]
    assert parse_field_marks("") == []
    assert parse_field_marks(None) == []
    assert parse_field_marks("  ,, ") == []


# --- serve mode --------------------------------------------------------------


def _serve(lib, requests):
    from io import StringIO

    from fieldcatalog.cli import serve_loop

    stdin = StringIO("".join(json.dumps(r) + "\n" for r in requests))
    stdout = StringIO()
    serve_loop(str(lib), stdin, stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def test_serve_round_trip(tmp_path: Path):
    src = tmp_path / "card"
    src.mkdir()
    Image.new("RGB", (60, 40), (40, 80, 40)).save(src / "a.jpg", "JPEG")
    lib = tmp_path / "library"

    # import rides the slow lane, so a list sent in the same batch would race
    # it by design. Import first, then query in a second serve session.
    first = _serve(lib, [{"id": 1, "args": ["init"]}, {"id": 2, "args": ["import", "--source", str(src)]}])
    by_id = {r["id"]: r for r in first}
    assert by_id[1]["ok"] is True
    assert by_id[2]["ok"] is True and by_id[2]["imported"] == 1

    responses = _serve(
        lib,
        [
            {"id": 3, "args": ["list", "--summary"]},
            {"id": 4, "args": ["no-such-command"]},
            {"id": 5, "args": ["set-verdict", "--id", "nope", "--verdict", "keep"]},
        ],
    )
    by_id = {r["id"]: r for r in responses}
    assert by_id[3]["ok"] is True and by_id[3]["count"] == 1
    assert by_id[4]["ok"] is False and "bad arguments" in by_id[4]["error"]
    assert by_id[5]["ok"] is False and by_id[5]["error"] == "unknown id"


def test_serve_malformed_request_does_not_kill_the_loop(tmp_path: Path):
    from io import StringIO

    from fieldcatalog.cli import serve_loop

    stdin = StringIO('this is not json\n{"id": 9, "args": ["init"]}\n')
    stdout = StringIO()
    serve_loop(str(tmp_path / "library"), stdin, stdout)
    responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert responses[0]["ok"] is False and responses[0]["id"] is None
    assert responses[1] == {**responses[1], "id": 9, "ok": True}


def test_serve_slow_lane_does_not_block_fast_commands(tmp_path: Path, monkeypatch):
    """A verdict typed while identify is running must answer immediately."""
    import time

    import fieldcatalog.vision as vision

    src = tmp_path / "card"
    src.mkdir()
    Image.new("RGB", (60, 40), (40, 80, 40)).save(src / "a.jpg", "JPEG")
    lib = tmp_path / "library"
    cat = Catalog(lib)
    sid = import_paths(cat, [src / "a.jpg"])["ids"][0]

    def slow_identify(_preview, **_kw):
        time.sleep(0.3)
        return {
            "common_name": "House Sparrow",
            "scientific_name": "Passer domesticus",
            "animal_type": "bird",
            "confidence": 0.9,
            "field_marks": [],
            "similar_species": [],
            "notes": "",
        }

    monkeypatch.setattr(vision, "identify_preview", slow_identify)

    responses = _serve(
        lib,
        [
            {"id": 1, "args": ["identify", "--id", sid]},
            {"id": 2, "args": ["set-verdict", "--id", sid, "--verdict", "keep"]},
        ],
    )
    # The verdict must come back before the identify that was sent first.
    assert [r["id"] for r in responses] == [2, 1]
    assert all(r["ok"] for r in responses)
    assert responses[1]["shot"]["common_name"] == "House Sparrow"
    assert cat.get(sid).verdict == "keep"
