from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime

from .models import Shot

MAX_GAP_S = 8.0
MAX_DIST_M = 250.0


def _ts(shot: Shot) -> float:
    try:
        return datetime.fromisoformat(shot.captured_at).timestamp()
    except ValueError:
        return 0.0


def _meters(a: Shot, b: Shot) -> float:
    if a.lat is None or a.lon is None or b.lat is None or b.lon is None:
        return 0.0
    r = 6371000.0
    dlat = math.radians(b.lat - a.lat)
    dlon = math.radians(b.lon - a.lon)
    la1, la2 = math.radians(a.lat), math.radians(b.lat)
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def assign_bursts(shots: list[Shot]) -> list[Shot]:
    # fromisoformat is not free and the loop below compares every neighbour, so
    # parse each shot's timestamp once rather than on every comparison.
    ts = {s.id: _ts(s) for s in shots}
    ordered = sorted(shots, key=lambda s: (ts[s.id], s.id))
    burst_of: dict[str, str] = {}
    cluster: list[Shot] = []
    burst_id = ""

    def flush() -> None:
        for s in cluster:
            burst_of[s.id] = burst_id

    for s in ordered:
        if not cluster:
            burst_id = f"burst-{s.id}"
            cluster = [s]
            continue
        prev = cluster[-1]
        if abs(ts[s.id] - ts[prev.id]) <= MAX_GAP_S and _meters(prev, s) <= MAX_DIST_M:
            cluster.append(s)
        else:
            flush()
            burst_id = f"burst-{s.id}"
            cluster = [s]
    flush()
    for s in shots:
        s.burst_id = burst_of.get(s.id, f"burst-{s.id}")
    return shots


def burst_pick(members: list[Shot]) -> Shot | None:
    if len(members) < 2:
        return None
    return max(
        members,
        key=lambda s: (s.sharpness or -1, s.quality or -1, s.stars, int(s.favorite)),
    )


def grouped(shots: list[Shot]) -> dict[str, list[Shot]]:
    g: dict[str, list[Shot]] = defaultdict(list)
    for s in shots:
        g[s.burst_id or s.id].append(s)
    return dict(g)
