from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Keyed by library so two libraries in one process cannot pool their pins --
# the on-disk cache is per library and writing a shared dict into it would
# scatter one library's places through another's.
_CACHE: dict[str, dict[str, tuple[float, float]]] = {}


class GeocodeError(RuntimeError):
    pass


def _cache_key(library: Path | None) -> str:
    return "" if library is None else str(Path(library).expanduser().resolve())


def _cache_for(library: Path | None) -> dict[str, tuple[float, float]]:
    return _CACHE.setdefault(_cache_key(library), {})


def _cache_path(library: Path | None) -> Path | None:
    if library is None:
        return None
    return Path(library).expanduser() / "geocode-cache.json"


def _load_disk_cache(library: Path | None) -> None:
    p = _cache_path(library)
    if not p or not p.is_file():
        return
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if isinstance(data, dict):
        cache = _cache_for(library)
        for k, v in data.items():
            if isinstance(v, (list, tuple)) and len(v) == 2:
                cache[str(k).lower()] = (float(v[0]), float(v[1]))


def _save_disk_cache(library: Path | None) -> None:
    p = _cache_path(library)
    if not p:
        return
    try:
        p.write_text(json.dumps(_cache_for(library), indent=2), encoding="utf-8")
    except OSError:
        # A read-only library must not throw away a lookup we already paid for.
        pass


def geocode_label(label: str, library: Path | None = None) -> tuple[float, float]:
    q = (label or "").strip()
    if not q:
        raise GeocodeError("empty place name")
    key = q.lower()
    cache = _cache_for(library)
    if key in cache:
        return cache[key]
    _load_disk_cache(library)
    if key in cache:
        return cache[key]
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": "1"}
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "FieldCatalog/0.1 (local wildlife catalog)"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise GeocodeError(f"geocode HTTP {e.code}") from e
        except Exception as e:
            raise GeocodeError(str(e)) from e
    if not payload:
        raise GeocodeError(f"no geocode match for {q!r}")
    pair = (float(payload[0]["lat"]), float(payload[0]["lon"]))
    cache[key] = pair
    _save_disk_cache(library)
    return pair


def capture_day(captured_at: str) -> str:
    s = (captured_at or "").replace("/", "-").replace(" ", "T")
    return s[:10] if len(s) >= 10 else s


def apply_location(shot_gps_from_file: bool, shot_lat, shot_lon, label: str, geocode=geocode_label) -> dict:
    fields: dict[str, object] = {"location": label}
    if shot_gps_from_file:
        return fields
    text = (label or "").strip()
    if not text:
        fields["lat"] = None
        fields["lon"] = None
        return fields
    lat, lon = geocode(text)
    fields["lat"] = lat
    fields["lon"] = lon
    return fields
