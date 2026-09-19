"""A second opinion on culling, from the local model. It never decides anything.

Reed culls 4,000 frames by hand. This looks at every one of them first and says what
it would do -- keep or reject, in a few words, and for a burst of near-identical
frames, which single one it would pick. Nothing here writes a verdict, a star or a
name: advice lands in its own table and the photographer stays the one who decides.

The unit of judgement is the burst, shown to the model as one numbered contact sheet.
That is deliberate. Asked about a frame alone, "is this sharp enough" has no answer;
asked about twelve frames of the same bird, "which of these" has a good one, and the
frames that lose are exactly the ones worth rejecting.

Two things the model is told and cannot see: which frames measured sharpest (a number
cannot see a turned head, a branch across the face, or clipped wings -- and the model
cannot reliably see fine focus in a thumbnail, so each covers the other's blind spot),
and that a burst may hold more than one photograph worth having. A bird that lands,
looks up and flies off is three pictures, not one; a bird that sits still for thirty
frames is one. The model is asked which it is looking at, because a pixel measure
cannot tell those apart -- both are "frames that differ".
"""
from __future__ import annotations

import base64
import io
import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw

from .vision import CancelToken, IdentifyError, _post_json, load_config

SHEET_MAX = 12          # frames on one sheet; 12 reads well and judges in ~12s
TILE = 460              # pixels on the long edge of each tile
MIN_TILE_SOURCE = 64    # a preview smaller than this is not worth showing

PROMPT = """You help a wildlife photographer cull frames shot seconds apart.

You are shown one numbered contact sheet. Judge only what a photograph can be judged
on: is the animal sharp where it matters (the eye), is it whole in the frame, is its
head turned towards the camera, is anything in the way, is the pose worth keeping.

You are told which frames measured sharpest. That measurement cannot see a turned
head, a branch across the face or clipped wings, and you cannot see fine focus in a
small tile. Weigh both.

Answer with JSON only, no prose around it:
{"best": <number>,
 "why_best": "<up to 12 words>",
 "also_keep": [<numbers showing a DIFFERENT moment worth keeping on its own -- a
   different pose, action or subject, never a near-copy of the best>],
 "frames": [{"n": <number>, "verdict": "keep"|"reject", "why": "<up to 8 words>"}]}

Every number on the sheet appears exactly once in "frames". If every frame is the same
moment, "also_keep" is empty. Rejecting most of a burst is normal and expected. If
there is only one frame, judge it on its own merits and make it "best"."""


@dataclass
class Advice:
    shot_id: str
    verdict: str
    reason: str
    pick: bool = False
    distinct: bool = False
    burst_id: str = ""
    model: str = ""


@dataclass
class Report:
    looked_at: int = 0
    sheets: int = 0
    advised: int = 0
    keep: int = 0
    reject: int = 0
    picks: int = 0
    skipped: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


SCHEMA = """
CREATE TABLE IF NOT EXISTS advice (
  shot_id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  pick INTEGER NOT NULL DEFAULT 0,
  distinct_moment INTEGER NOT NULL DEFAULT 0,
  burst_id TEXT,
  model TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advice_verdict ON advice(verdict);
"""


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def save(conn: sqlite3.Connection, rows: list[Advice]) -> int:
    """Write advice, and only advice. This module never touches the shots table."""
    ensure_table(conn)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn.executemany(
        "INSERT INTO advice (shot_id, verdict, reason, pick, distinct_moment, burst_id, model, at) "
        "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(shot_id) DO UPDATE SET "
        "verdict=excluded.verdict, reason=excluded.reason, pick=excluded.pick, "
        "distinct_moment=excluded.distinct_moment, burst_id=excluded.burst_id, "
        "model=excluded.model, at=excluded.at",
        [(r.shot_id, r.verdict, r.reason[:160], int(r.pick), int(r.distinct),
          r.burst_id or None, r.model, now) for r in rows])
    conn.commit()
    return len(rows)


def already_advised(conn: sqlite3.Connection) -> set[str]:
    ensure_table(conn)
    return {r[0] for r in conn.execute("SELECT shot_id FROM advice")}


# --- grouping -----------------------------------------------------------------


def dhash(path: str | Path, size: int = 8) -> int:
    """64-bit difference hash: each bit says "this pixel is brighter than the next"."""
    im = Image.open(path).convert("L").resize((size + 1, size), Image.LANCZOS)
    raw = im.tobytes()
    bits = 0
    for row in range(size):
        base = row * (size + 1)
        for col in range(size):
            bits = (bits << 1) | (raw[base + col] > raw[base + col + 1])
    return bits


def apart(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def in_sheets(frames: list, cap: int = SHEET_MAX) -> list[list]:
    """A burst, split into sheets small enough to read.

    Consecutive frames, never a sample: the sheet is how the model sees the burst,
    and two frames next to each other in time are what it is being asked to choose
    between. Sampling a long burst would hide exactly the near-copies it should reject.
    """
    return [frames[i:i + cap] for i in range(0, len(frames), cap)] or []


# --- the sheet ----------------------------------------------------------------


def contact_sheet(previews: list[str], tile: int = TILE) -> Image.Image:
    cols = 1 if len(previews) == 1 else (3 if len(previews) <= 6 else 4)
    rows = (len(previews) + cols - 1) // cols
    pad, foot = 8, 30
    sheet = Image.new("RGB", (cols * (tile + pad) + pad, rows * (tile + pad + foot) + pad),
                      (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(previews):
        thumb = Image.open(path).convert("RGB")
        thumb.thumbnail((tile, tile), Image.LANCZOS)
        x = pad + (i % cols) * (tile + pad)
        y = pad + (i // cols) * (tile + pad + foot)
        sheet.paste(thumb, (x + (tile - thumb.width) // 2, y + (tile - thumb.height) // 2))
        draw.text((x + tile // 2 - 6, y + tile + 8), str(i + 1), fill=(255, 235, 180))
    return sheet


def ask_model(sheet: Image.Image, note: str, cfg: dict, cancel: CancelToken | None = None) -> dict:
    buf = io.BytesIO()
    sheet.save(buf, "JPEG", quality=88)
    url = str(cfg.get("ollama_url") or "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
    body = {
        "model": str(cfg.get("ollama_model") or ""),
        "stream": False,
        "think": False,
        "options": {"temperature": 0.1},
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": note,
             "images": [base64.b64encode(buf.getvalue()).decode("ascii")]},
        ],
    }
    payload = _post_json(url, body, {}, timeout=600, cancel=cancel)
    text = ""
    if isinstance(payload, dict):
        text = str((payload.get("message") or {}).get("content") or payload.get("response") or "")
    if not text.strip():
        raise IdentifyError("the model returned nothing")
    return parse(text, "")


def parse(text: str, _unused: str = "") -> dict:
    """The model's JSON, however it wrapped it."""
    body = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", body, re.S)
    if fence:
        body = fence.group(1).strip()
    start, end = body.find("{"), body.rfind("}")
    if start < 0 or end < start:
        raise IdentifyError(f"no JSON in the model's answer: {text[:120]}")
    try:
        data = json.loads(body[start:end + 1])
    except ValueError as exc:
        raise IdentifyError(f"the model's JSON did not parse: {exc}") from exc
    if not isinstance(data, dict):
        raise IdentifyError("the model's answer was not an object")
    return data


def read_advice(data: dict, frames: list, model: str) -> list[Advice]:
    """Turn one sheet's answer into advice, one row per frame that was shown.

    A frame the model forgot is kept, not dropped: silence is not a reason to reject
    somebody's photograph. The same goes for a verdict that is not one of the two
    words -- the row still carries whatever reason the model gave.
    """
    said: dict[int, dict] = {}
    for row in data.get("frames") or []:
        if isinstance(row, dict):
            try:
                said[int(row.get("n"))] = row
            except (TypeError, ValueError):
                continue

    def number(value) -> int | None:
        try:
            n = int(value)
        except (TypeError, ValueError):
            return None
        return n if 1 <= n <= len(frames) else None

    best = number(data.get("best"))
    also = {n for n in (number(v) for v in (data.get("also_keep") or [])) if n and n != best}
    out = []
    for i, shot in enumerate(frames, start=1):
        row = said.get(i) or {}
        verdict = str(row.get("verdict") or "").strip().lower()
        reason = str(row.get("why") or "").strip()
        if i == best:
            verdict = "keep"
            reason = str(data.get("why_best") or reason or "the model's pick of this burst")
        elif i in also:
            verdict = "keep"
            reason = reason or "a different moment worth keeping"
        elif verdict not in ("keep", "reject"):
            verdict = "keep"
            reason = reason or "the model did not say; left for you"
        out.append(Advice(
            shot_id=shot["id"], verdict=verdict, reason=reason,
            # "the best of this burst" says nothing about a frame with no rivals.
            pick=(i == best and len(frames) > 1),
            distinct=(i in also), burst_id=shot["burst_id"] or "", model=model))
    return out


def sharpest_first(frames: list) -> list[int]:
    def score(f):
        return f["subject_sharpness"] if f["subject_sharpness"] is not None else (f["sharpness"] or 0)
    return [i + 1 for i in sorted(range(len(frames)), key=lambda i: -score(frames[i]))]


def note_for(frames: list, part: int, parts: int) -> str:
    names = {f["common_name"] for f in frames if (f["common_name"] or "").strip()}
    subject = ", ".join(sorted(names)) if names else "not identified"
    where = f" (frames {part} of {parts} of a longer burst)" if parts > 1 else ""
    rank = sharpest_first(frames)[:4]
    return (f"{len(frames)} frame(s) of one burst{where}. Subject: {subject}. "
            f"Sharpest measured, best first: {', '.join(str(n) for n in rank)}. JSON only.")


# --- the pass -----------------------------------------------------------------


def group_shots(shots: list) -> list[list]:
    """Bursts together in shooting order; everything else on its own."""
    bursts: dict[str, list] = {}
    singles = []
    for shot in shots:
        key = (shot["burst_id"] or "").strip()
        if key:
            bursts.setdefault(key, []).append(shot)
        else:
            singles.append([shot])
    for frames in bursts.values():
        frames.sort(key=lambda s: ((s["captured_at"] or ""), s["display_name"] or "", s["id"]))
    return sorted(bursts.values(), key=lambda g: (g[0]["captured_at"] or "")) + singles


def advise_group(frames: list, cfg: dict, model: str, cancel: CancelToken | None = None,
                 log=None) -> list[Advice]:
    """Advice for every frame of one burst, and one pick across the whole of it."""
    sheets = in_sheets(frames, SHEET_MAX)
    rows: list[Advice] = []
    winners: list = []
    for part, chunk in enumerate(sheets, start=1):
        answer = ask_model(contact_sheet([f["preview_path"] for f in chunk]),
                           note_for(chunk, part, len(sheets)), cfg, cancel)
        got = read_advice(answer, chunk, model)
        rows.extend(got)
        winners.extend(f for f, row in zip(chunk, got) if row.pick)
        if log:
            log(f"    sheet {part}/{len(sheets)}: {sum(r.verdict == 'keep' for r in got)} keep, "
                f"{sum(r.verdict == 'reject' for r in got)} reject")

    # A burst too long for one sheet has one winner per sheet. They are each other's
    # real competition, so they go back to the model together and only one stays the
    # pick. The losers keep their "keep": they were the best of their own stretch.
    if len(winners) > 1:
        answer = ask_model(contact_sheet([f["preview_path"] for f in winners]),
                           f"The best frame of each part of one long burst, {len(winners)} of them. "
                           f"Which single frame is the best photograph? JSON only.", cfg, cancel)
        final = read_advice(answer, winners, model)
        chosen = next((f["id"] for f, row in zip(winners, final) if row.pick), winners[0]["id"])
        for row in rows:
            if row.pick and row.shot_id != chosen:
                row.pick = False
                row.distinct = True          # still the best of its own stretch
        if log:
            log(f"    run-off among {len(winners)}: kept {chosen[:8]}")
    return rows


def run(conn: sqlite3.Connection, shots: list, *, redo: bool = False, limit: int = 0,
        cancel: CancelToken | None = None, log=None, library: Path | None = None) -> Report:
    """Advise on these shots. Writes to `advice` and to nothing else."""
    cfg = load_config(library)
    if cfg.get("backend") != "ollama":
        raise IdentifyError("advice runs on the local model; switch Identify to Ollama first")
    model = str(cfg.get("ollama_model") or "")
    report = Report()
    done = set() if redo else already_advised(conn)
    groups = group_shots(shots)
    for frames in groups:
        if cancel is not None and cancel.cancelled:
            break
        frames = [f for f in frames if f["id"] not in done]
        frames = [f for f in frames if Path(f["preview_path"] or "").is_file()]
        if not frames:
            continue
        if limit and report.advised >= limit:
            break
        if log:
            name = frames[0]["common_name"] or "not identified"
            log(f"  {name}: {len(frames)} frame(s)")
        try:
            rows = advise_group(frames, cfg, model, cancel, log)
        except IdentifyError as exc:
            report.errors.append({"burst": frames[0]["burst_id"] or frames[0]["id"],
                                  "error": str(exc)[:200]})
            continue
        save(conn, rows)
        report.sheets += len(in_sheets(frames, SHEET_MAX))
        report.advised += len(rows)
        report.keep += sum(r.verdict == "keep" for r in rows)
        report.reject += sum(r.verdict == "reject" for r in rows)
        report.picks += sum(r.pick for r in rows)
    report.looked_at = len(shots)
    return report
