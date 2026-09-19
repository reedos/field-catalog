"""The model advises; the photographer decides.

The rule this file exists to hold: `advise` writes to the advice table and to nothing
else. Everything about a shot -- its verdict, its stars, its name -- is Reed's.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from PIL import Image

from fieldcatalog import advise
from fieldcatalog.vision import IdentifyError


@pytest.fixture()
def library(tmp_path):
    """A catalogue with two bursts and a single frame, and previews to match."""
    from fieldcatalog.catalog import Catalog

    cat = Catalog(tmp_path / "lib")
    previews = tmp_path / "lib" / "previews"
    rows = []
    for i in range(14):
        burst = "burst-a" if i < 12 else ("burst-b" if i < 13 else "")
        path = previews / f"p{i}.jpg"
        Image.new("RGB", (240, 160), (20 + i * 4, 90, 40)).save(path, "JPEG")
        rows.append((f"id{i:02d}", str(tmp_path / f"o{i}.NEF"), str(path), f"DSC_{i:04d}",
                     "Osprey", f"2026-05-29T10:00:{i:02d}", burst, float(i), float(i * 2)))
    cat.conn.executemany(
        "INSERT INTO shots (id, original_path, preview_path, display_name, common_name, "
        "captured_at, burst_id, sharpness, subject_sharpness, verdict) "
        "VALUES (?,?,?,?,?,?,?,?,?,'unrated')", rows)
    cat.conn.commit()
    return cat


def frames_of(cat, where="1=1"):
    return [dict(r) for r in cat.conn.execute(
        "SELECT id, burst_id, preview_path, display_name, common_name, captured_at, "
        f"sharpness, subject_sharpness FROM shots WHERE {where} ORDER BY captured_at")]


def fingerprint(cat) -> str:
    # tuple(), not the rows themselves: a sqlite3.Row reprs with its memory address,
    # which changes between two reads of an identical table.
    rows = [tuple(r) for r in cat.conn.execute("SELECT * FROM shots ORDER BY id")]
    return hashlib.sha256(repr(rows).encode()).hexdigest()


def answer(best, keeps=(), also=(), n=12):
    return {"best": best, "why_best": "eye sharp, head to camera", "also_keep": list(also),
            "frames": [{"n": i, "verdict": "keep" if i in keeps or i == best else "reject",
                        "why": "near copy"} for i in range(1, n + 1)]}


# --- the hard rule -------------------------------------------------------------


def test_advising_never_touches_a_single_thing_about_a_shot(library, monkeypatch):
    before = fingerprint(library)
    monkeypatch.setattr(advise, "load_config",
                        lambda lib=None: {"backend": "ollama", "ollama_model": "m"})
    monkeypatch.setattr(advise, "ask_model",
                        lambda sheet, note, cfg, cancel=None: answer(2, keeps={5}, n=12))
    report = advise.run(library.conn, frames_of(library))
    assert report.advised == 14
    assert fingerprint(library) == before
    assert library.conn.execute("SELECT count(*) FROM advice").fetchone()[0] == 14
    assert library.conn.execute(
        "SELECT count(*) FROM shots WHERE verdict <> 'unrated'").fetchone()[0] == 0


def test_it_refuses_to_run_on_a_cloud_model(library, monkeypatch):
    monkeypatch.setattr(advise, "load_config", lambda lib=None: {"backend": "xai"})
    with pytest.raises(IdentifyError) as refused:
        advise.run(library.conn, frames_of(library))
    assert "local model" in str(refused.value)


# --- reading what the model said ----------------------------------------------


def test_the_best_frame_is_kept_whatever_the_model_said_about_it():
    frames = [{"id": f"id{i}", "burst_id": "b"} for i in range(3)]
    data = {"best": 2, "why_best": "clean profile",
            "frames": [{"n": 1, "verdict": "reject", "why": "soft"},
                       {"n": 2, "verdict": "reject", "why": "contradicts itself"},
                       {"n": 3, "verdict": "reject", "why": "soft"}]}
    rows = advise.read_advice(data, frames, "m")
    assert [r.verdict for r in rows] == ["reject", "keep", "reject"]
    assert rows[1].pick and rows[1].reason == "clean profile"


def test_a_frame_the_model_forgot_is_kept_not_dropped():
    """Silence is not a reason to reject somebody's photograph."""
    frames = [{"id": f"id{i}", "burst_id": "b"} for i in range(3)]
    rows = advise.read_advice({"best": 1, "frames": [{"n": 1, "verdict": "keep"}]}, frames, "m")
    assert len(rows) == 3
    assert [r.verdict for r in rows] == ["keep", "keep", "keep"]
    assert "did not say" in rows[2].reason


def test_a_different_moment_is_kept_and_marked_as_its_own(library):
    frames = [{"id": f"id{i}", "burst_id": "b"} for i in range(4)]
    rows = advise.read_advice(answer(1, also=[3], n=4), frames, "m")
    assert rows[2].verdict == "keep" and rows[2].distinct and not rows[2].pick
    assert rows[0].pick and not rows[0].distinct


def test_numbers_the_sheet_never_had_are_ignored():
    frames = [{"id": "id0", "burst_id": "b"}, {"id": "id1", "burst_id": "b"}]
    rows = advise.read_advice({"best": 99, "also_keep": [0, 7, "x"],
                               "frames": [{"n": 1, "verdict": "reject", "why": "soft"},
                                          {"n": 2, "verdict": "keep", "why": "sharp"}]}, frames, "m")
    assert [r.pick for r in rows] == [False, False]
    assert [r.verdict for r in rows] == ["reject", "keep"]


def test_one_frame_alone_is_not_the_best_of_anything():
    rows = advise.read_advice({"best": 1, "frames": [{"n": 1, "verdict": "keep", "why": "fine"}]},
                              [{"id": "id0", "burst_id": ""}], "m")
    assert rows[0].verdict == "keep" and not rows[0].pick


# --- the model's JSON, however it arrives --------------------------------------


@pytest.mark.parametrize("wrapper", [
    '{body}',
    'Here is my answer:\n{body}\nHope that helps.',
    '```json\n{body}\n```',
    '```\n{body}\n```',
])
def test_the_json_is_found_however_it_is_wrapped(wrapper):
    body = json.dumps({"best": 1, "frames": []})
    assert advise.parse(wrapper.format(body=body))["best"] == 1


@pytest.mark.parametrize("junk", ["", "no json here", "[1, 2, 3]", "{not json}"])
def test_an_answer_that_is_not_json_is_an_error_not_a_guess(junk):
    with pytest.raises(IdentifyError):
        advise.parse(junk)


# --- grouping and sheets -------------------------------------------------------


def test_a_long_burst_is_cut_into_readable_sheets_in_shooting_order(library):
    frames = frames_of(library, "burst_id = 'burst-a'")
    sheets = advise.in_sheets(frames, cap=5)
    assert [len(s) for s in sheets] == [5, 5, 2]
    assert [f["id"] for f in sheets[0]] == ["id00", "id01", "id02", "id03", "id04"]


def test_bursts_group_together_and_loose_frames_stand_alone(library):
    groups = advise.group_shots(frames_of(library))
    assert sorted(len(g) for g in groups) == [1, 1, 12]


def test_the_run_off_leaves_one_pick_across_a_burst_of_many_sheets(library, monkeypatch):
    """Each sheet names a winner; only one of them stays the pick for the burst."""
    monkeypatch.setattr(advise, "load_config",
                        lambda lib=None: {"backend": "ollama", "ollama_model": "m"})
    seen = []

    def stub(sheet, note, cfg, cancel=None):
        seen.append(note)
        return answer(1, n=12 if "of one burst" in note and "best frame of each" not in note else 2)

    monkeypatch.setattr(advise, "ask_model", stub)
    monkeypatch.setattr(advise, "SHEET_MAX", 5)       # 12 frames -> 3 sheets -> 3 winners
    frames = frames_of(library, "burst_id = 'burst-a'")
    rows = advise.advise_group(frames, {"ollama_model": "m"}, "m")
    assert len(seen) == 4                             # three sheets, then the run-off
    assert "best frame of each part" in seen[-1]
    assert sum(r.pick for r in rows) == 1             # one pick for the whole burst
    # The two that won a sheet but lost the run-off are still worth keeping.
    beaten = [r for r in rows if r.distinct and not r.pick]
    assert len(beaten) == 2 and all(r.verdict == "keep" for r in beaten)


def test_the_sheet_is_numbered_and_holds_every_frame(library):
    frames = frames_of(library, "burst_id = 'burst-a'")[:4]
    sheet = advise.contact_sheet([f["preview_path"] for f in frames], tile=120)
    assert sheet.width > 120 and sheet.height > 120
    assert sheet.mode == "RGB"


def test_the_note_tells_the_model_what_measured_sharpest(library):
    frames = frames_of(library, "burst_id = 'burst-a'")[:4]
    note = advise.note_for(frames, 1, 1)
    assert "Osprey" in note and "Sharpest measured" in note
    assert note.split("best first: ")[1].startswith("4")      # subject_sharpness rises with index


# --- storing it ----------------------------------------------------------------


def test_advice_is_written_once_per_shot_and_updated_in_place(library):
    first = [advise.Advice("id00", "keep", "sharp", pick=True, burst_id="b", model="m")]
    advise.save(library.conn, first)
    advise.save(library.conn, [advise.Advice("id00", "reject", "changed my mind", model="m")])
    rows = [tuple(r) for r in library.conn.execute("SELECT verdict, reason, pick FROM advice")]
    assert rows == [("reject", "changed my mind", 0)]


def test_a_second_pass_skips_what_was_already_advised(library, monkeypatch):
    monkeypatch.setattr(advise, "load_config",
                        lambda lib=None: {"backend": "ollama", "ollama_model": "m"})
    calls = []
    monkeypatch.setattr(advise, "ask_model",
                        lambda sheet, note, cfg, cancel=None: calls.append(note) or answer(1, n=12))
    advise.run(library.conn, frames_of(library))
    again = len(calls)
    advise.run(library.conn, frames_of(library))
    assert len(calls) == again                      # nothing new to ask about
    advise.run(library.conn, frames_of(library), redo=True)
    assert len(calls) > again


def test_a_burst_the_model_chokes_on_does_not_stop_the_pass(library, monkeypatch):
    monkeypatch.setattr(advise, "load_config",
                        lambda lib=None: {"backend": "ollama", "ollama_model": "m"})
    calls = []

    def stub(sheet, note, cfg, cancel=None):
        calls.append(note)
        if len(calls) == 1:
            raise IdentifyError("the model fell over")
        return answer(1, n=12)

    monkeypatch.setattr(advise, "ask_model", stub)
    report = advise.run(library.conn, frames_of(library))
    assert report.errors and "fell over" in report.errors[0]["error"]
    assert report.advised > 0                       # the rest still got advice
