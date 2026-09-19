"""`fieldcatalog web`: the app served to a phone. What it must never let a network do."""
import gzip
import http.client
import io
import json
import threading
from pathlib import Path

import pytest
from PIL import Image

from fieldcatalog import web
from fieldcatalog.catalog import Catalog
from fieldcatalog.models import Shot


@pytest.fixture()
def site(tmp_path: Path):
    """A library with one keeper, a built-UI stand-in, and the server on a free port."""
    lib = tmp_path / "library"
    cat = Catalog(lib)
    previews = lib / "previews"
    previews.mkdir(parents=True, exist_ok=True)
    original = tmp_path / "card" / "DSC_0001.JPG"
    original.parent.mkdir()
    exif = Image.Exif()
    exif[0x010F] = "NIKON CORPORATION"
    Image.new("RGB", (3000, 2000), (40, 90, 60)).save(original, "JPEG", exif=exif)
    preview = previews / "a.jpg"
    Image.new("RGB", (1600, 1066), (40, 90, 60)).save(preview, "JPEG")
    cat.upsert(Shot(id="a", original_path=str(original), preview_path=str(preview),
                    common_name="Osprey", verdict="unrated"))
    cat.upsert(Shot(id="gone", original_path=str(tmp_path / "card" / "missing.JPG"),
                    preview_path=str(preview), original_status="deleted"))

    ui = tmp_path / "dist"
    (ui / "assets").mkdir(parents=True)
    (ui / "index.html").write_text("<!doctype html><title>Field Catalog</title>" + "x" * 2000, encoding="utf-8")
    (ui / "assets" / "app-abc123.js").write_text("console.log(1)" * 200, encoding="utf-8")

    server = web.make_server(str(lib), "127.0.0.1", 0, ui, extra_hosts=["my-pc"])
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield {"port": server.server_address[1], "lib": lib, "cat": cat, "original": original,
           "preview": preview, "app": server.RequestHandlerClass.app}
    server.shutdown()
    server.server_close()


def call(site, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", site["port"], timeout=30)
    hdrs = dict(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    conn.request(method, path, body=data, headers=hdrs)
    res = conn.getresponse()
    raw = res.read()
    conn.close()
    if res.getheader("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return res, raw


def worker(site, args, **headers):
    res, raw = call(site, "POST", "/api/worker", {"args": args}, headers)
    return res.status, json.loads(raw)


# --- it is the same app ---------------------------------------------------------


def test_the_ui_can_cull_through_it(site):
    status, got = worker(site, ["list"])
    assert status == 200 and got["ok"] and {s["id"] for s in got["shots"]} == {"a", "gone"}
    status, got = worker(site, ["set-verdict", "--id", "a", "--verdict", "keep"])
    assert status == 200 and got["ok"]
    assert site["cat"].get("a").verdict == "keep"
    status, got = worker(site, ["identify", "--id", "a", "--common-name", "bald eagle"])
    assert got["shot"]["common_name"] == "Bald Eagle" and got["shot"]["confidence"] == 1.0


def test_a_failing_command_is_an_answer_not_a_crash(site):
    assert worker(site, ["set-verdict", "--id", "nope", "--verdict", "keep"]) == (200, {"ok": False, "error": "unknown id"})
    status, got = worker(site, ["set-verdict", "--id", "a"])
    assert status == 400 and not got["ok"]


# --- what a network may not ask ---------------------------------------------------


@pytest.mark.parametrize("command", ["serve", "web", "backup", "doctor", "detect-subjects", "rm -rf", ""])
def test_only_what_the_ui_sends_is_accepted(site, command):
    status, got = worker(site, [command])
    assert status in (400, 403) and not got["ok"]


@pytest.mark.parametrize("flag", ["--permanent", "--perm", "--no-backup", "--no-b", "--allow-any-verdict", "--allow"])
def test_flags_that_lift_a_safety_rule_are_refused_even_abbreviated(site, flag):
    """argparse takes any unambiguous prefix, so the check has to read the parsed request."""
    status, got = worker(site, ["delete-originals", "--ids", "a", "--confirm", "DELETE_ORIGINALS", flag])
    assert status == 403, got
    assert "not accepted over the network" in got["error"]


def test_the_library_cannot_be_switched(site):
    status, got = worker(site, ["list", "--library", "C:/somewhere/else"])
    assert status == 400 and not got["ok"]


def test_args_must_be_a_list_of_strings(site):
    for bad in ("list", ["list", 5], [], None, {"0": "list"}):
        res, raw = call(site, "POST", "/api/worker", {"args": bad})
        assert res.status == 400, bad
    res, raw = call(site, "POST", "/api/worker", b"{not json")
    assert res.status == 400


# --- hard rule 3, enforced here as well --------------------------------------------


@pytest.fixture()
def gate(site, monkeypatch):
    """The disk gate with the worker stubbed out: nothing is ever actually removed."""
    ran = []

    def run(argv, timeout=900):
        ran.append(argv)
        ids = argv[argv.index("--ids") + 1].split(",")
        return {"ok": True, "files": [{"id": i} for i in ids if i not in GONE]}   # a dry run lists what is on disk

    monkeypatch.setattr(site["app"].lanes, "run", run)
    return site["app"], ran


GONE = {"gone1", "gone2"}                                     # rejected long ago, already off the disk


DELETE = ["delete-originals", "--ids", "a,b", "--confirm", "DELETE_ORIGINALS"]


def test_an_execute_needs_its_own_dry_run_first(gate):
    app, ran = gate
    with pytest.raises(web.Refused) as refused:
        app.worker("100.1.1.1", DELETE + ["--execute"])
    assert refused.value.status == 409 and ran == []
    app.worker("100.1.1.1", DELETE)                          # the list is shown ...
    app.worker("100.1.1.1", DELETE + ["--execute"])          # ... then it may go
    assert [a[-1] for a in ran] == ["DELETE_ORIGINALS", "--execute"]


@pytest.mark.parametrize("spelling", ["--execute", "--exec", "--e"])
def test_an_abbreviated_execute_is_still_an_execute(gate, spelling):
    app, ran = gate
    with pytest.raises(web.Refused):
        app.worker("100.1.1.1", DELETE + [spelling])
    assert ran == []


def test_the_dry_run_has_to_be_for_these_ids_this_action_this_device_and_recent(gate, monkeypatch):
    app, ran = gate
    app.worker("100.1.1.1", DELETE)
    for client, argv in (("100.2.2.2", DELETE + ["--execute"]),                                 # another device
                         ("100.1.1.1", ["delete-originals", "--ids", "a,b,c", "--confirm", "DELETE_ORIGINALS", "--execute"]),
                         ("100.1.1.1", ["offload-originals", "--ids", "a,b", "--confirm", "OFFLOAD_ORIGINALS", "--execute"])):
        with pytest.raises(web.Refused):
            app.worker(client, argv)
    app.worker("100.1.1.1", ["delete-originals", "--ids", "b,a", "--confirm", "DELETE_ORIGINALS", "--execute"])  # same set
    with pytest.raises(web.Refused):                          # one look, one removal
        app.worker("100.1.1.1", DELETE + ["--execute"])

    app.worker("100.1.1.1", DELETE)
    real = web.time.time
    monkeypatch.setattr(web.time, "time", lambda: real() + web.DRY_RUN_TTL + 1)
    with pytest.raises(web.Refused):                          # looked at too long ago
        app.worker("100.1.1.1", DELETE + ["--execute"])


def test_what_may_go_is_what_the_dry_run_listed_not_what_it_was_asked_about(gate):
    """The app asks about every reject, the dry run lists the ones still on disk, and those are
    the ids the execute names. That has to pass; the full asked-about list does not."""
    app, ran = gate
    asked = ["delete-originals", "--ids", "a,gone1,b,gone2", "--confirm", "DELETE_ORIGINALS"]
    app.worker("100.1.1.1", asked)
    with pytest.raises(web.Refused):                          # never listed, so never shown
        app.worker("100.1.1.1", asked + ["--execute"])
    app.worker("100.1.1.1", asked)
    app.worker("100.1.1.1", DELETE + ["--execute"])          # a,b: exactly what was listed
    assert ran[-1][-1] == "--execute"


def test_a_dry_run_that_lists_nothing_allows_nothing(gate):
    app, ran = gate
    nothing = ["delete-originals", "--ids", "gone1", "--confirm", "DELETE_ORIGINALS"]
    app.worker("100.1.1.1", nothing)
    with pytest.raises(web.Refused):
        app.worker("100.1.1.1", nothing + ["--execute"])


# --- a web page in the same browser cannot drive it ---------------------------------


def test_requests_must_be_json_from_this_origin_to_a_name_we_answer_to(site):
    ok = {"args": ["key-status"]}
    assert call(site, "POST", "/api/worker", ok)[0].status == 200
    assert call(site, "POST", "/api/worker", ok, {"Host": "my-pc:8795"})[0].status == 200
    # a cross-site form post: no preflight needed for text/plain, so it must be refused here
    assert call(site, "POST", "/api/worker", json.dumps(ok).encode(), {"Content-Type": "text/plain"})[0].status == 403
    assert call(site, "POST", "/api/worker", ok, {"Origin": "https://evil.example"})[0].status == 403
    assert call(site, "POST", "/api/worker", ok, {"Origin": f"http://127.0.0.1:{site['port']}"})[0].status == 200
    # DNS rebinding: the attacker's name resolves here, but we do not answer to it
    assert call(site, "POST", "/api/worker", ok, {"Host": "evil.example"})[0].status == 421
    assert call(site, "GET", "/api/paths", headers={"Host": "evil.example"})[0].status == 421
    assert call(site, "POST", "/api/worker", b"x" * (web.MAX_BODY + 1))[0].status == 413
    assert call(site, "POST", "/api/other", ok)[0].status == 404


# --- starting at logon, before the tailnet is up ----------------------------------------


def test_it_waits_for_tailscale_instead_of_dying_at_boot():
    answers = iter([None, None, "127.0.0.1"])              # no address yet, twice; then one
    naps = []
    got = web.wait_for_tailnet(0, ip=lambda: next(answers), sleep=naps.append, log=lambda *a, **k: None)
    assert got == "127.0.0.1" and naps == [5, 5]


def test_it_waits_while_the_address_exists_but_cannot_be_bound_yet():
    answers = iter(["203.0.113.7", "127.0.0.1"])           # first one is not ours to bind
    naps = []
    assert web.wait_for_tailnet(0, ip=lambda: next(answers), sleep=naps.append, log=lambda *a, **k: None) == "127.0.0.1"
    assert naps == [5]


def test_it_gives_up_eventually_with_a_reason():
    with pytest.raises(SystemExit) as stop:
        web.wait_for_tailnet(0, patience=10, ip=lambda: None, sleep=lambda s: None, log=lambda *a, **k: None)
    assert "tailscale did not come up" in str(stop.value)


# --- files ---------------------------------------------------------------------------


def test_only_previews_are_served(site):
    from urllib.parse import quote

    res, raw = call(site, "GET", "/api/file?path=" + quote(str(site["preview"])))
    assert res.status == 200 and res.getheader("Content-Type") == "image/jpeg"
    assert Image.open(io.BytesIO(raw)).size == (1600, 1066)
    for path in (site["original"], site["lib"] / "catalog.sqlite",
                 site["lib"] / "previews" / ".." / "catalog.sqlite", Path("C:/Windows/win.ini"), ""):
        assert call(site, "GET", "/api/file?path=" + quote(str(path)))[0].status == 404, path


def test_thumbnails_are_smaller_cached_and_leave_the_preview_alone(site):
    from urllib.parse import quote

    before = site["preview"].read_bytes()
    res, raw = call(site, "GET", f"/api/file?path={quote(str(site['preview']))}&w=480")
    assert res.status == 200 and Image.open(io.BytesIO(raw)).size == (480, 320)
    assert (site["lib"] / "web-cache" / "thumbs" / "a_480.jpg").is_file()
    assert site["preview"].read_bytes() == before
    assert call(site, "GET", f"/api/file?path={quote(str(site['preview']))}&w=9999")[0].status == 400


def test_the_loupe_sends_a_region_never_the_file(site):
    res, raw = call(site, "GET", "/api/loupe?id=a&cx=0.5&cy=0.5&size=800")
    assert res.status == 200 and res.getheader("Content-Type") == "image/jpeg"
    im = Image.open(io.BytesIO(raw))
    assert im.size == (800, 800) and len(im.getexif()) == 0 and b"NIKON" not in raw
    assert Image.open(io.BytesIO(call(site, "GET", "/api/loupe?id=a&cx=1&cy=1&size=99999")[1])).size == (1600, 1600)
    assert call(site, "GET", "/api/loupe?id=gone&cx=0.5&cy=0.5")[0].status == 404       # original not on disk
    assert call(site, "GET", "/api/loupe?id=nope&cx=0.5&cy=0.5")[0].status == 404
    assert call(site, "GET", "/api/loupe?id=a&cx=2&cy=0.5")[0].status == 400
    assert call(site, "GET", "/api/loupe?id=a&cx=x&cy=y")[0].status == 400


def test_the_ui_is_a_single_page_with_long_lived_assets(site):
    res, raw = call(site, "GET", "/", headers={"Accept-Encoding": "gzip"})
    assert res.status == 200 and b"Field Catalog" in raw and res.getheader("Content-Encoding") == "gzip"
    assert res.getheader("Cache-Control") == "no-cache"
    assert b"Field Catalog" in call(site, "GET", "/cull/anything")[1]                   # the app routes itself
    res, raw = call(site, "GET", "/assets/app-abc123.js")
    assert res.status == 200 and "immutable" in res.getheader("Cache-Control")
    assert b"Field Catalog" in call(site, "GET", "/../../catalog.sqlite")[1]            # never a file outside dist
    assert call(site, "GET", "/api/nothing")[0].status == 404


def test_a_big_list_is_compressed_for_the_phone(site):
    res, raw = call(site, "POST", "/api/worker", {"args": ["list"]}, {"Accept-Encoding": "gzip"})
    assert res.status == 200 and json.loads(raw)["ok"]
    for n in range(40):
        site["cat"].upsert(Shot(id=f"s{n}", original_path=f"{n}.jpg", preview_path=f"{n}.jpg", notes="n" * 200))
    res, raw = call(site, "POST", "/api/worker", {"args": ["list"]}, {"Accept-Encoding": "gzip"})
    assert res.getheader("Content-Encoding") == "gzip" and len(json.loads(raw)["shots"]) == 42
