from pathlib import Path

from PIL import Image

from fieldcatalog.animal import infer_animal_type
from fieldcatalog.bursts import assign_bursts, burst_pick
from fieldcatalog.catalog import Catalog
from fieldcatalog.disk import CONFIRM_DELETE, DiskError, unlink_originals
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

    done = unlink_originals(cat, [shot.id], action="delete", confirm=CONFIRM_DELETE, execute=True)
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
