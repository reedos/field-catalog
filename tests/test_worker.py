from pathlib import Path

from PIL import Image

from fieldcatalog.animal import infer_animal_type
from fieldcatalog.bursts import assign_bursts, burst_pick
from fieldcatalog.catalog import Catalog
from fieldcatalog.disk import CONFIRM_DELETE, DiskError, unlink_originals
from fieldcatalog.importer import import_paths
from fieldcatalog.models import Shot
from fieldcatalog.sharpness import score_sharpness


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
