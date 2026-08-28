from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_CACHE: dict[str, tuple[float, float]] = {}


class GeocodeError(RuntimeError):
    pass


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
        for k, v in data.items():
            if isinstance(v, (list, tuple)) and len(v) == 2:
                _CACHE[str(k).lower()] = (float(v[0]), float(v[1]))


def _save_disk_cache(library: Path | None) -> None:
    p = _cache_path(library)
    if not p:
        return
    p.write_text(json.dumps(_CACHE, indent=2), encoding="utf-8")


def geocode_label(label: str, library: Path | None = None) -> tuple[float, float]:
    q = (label or "").strip()
    if not q:
        raise GeocodeError("empty place name")
    key = q.lower()
    if key in _CACHE:
        return _CACHE[key]
    _load_disk_cache(library)
    if key in _CACHE:
        return _CACHE[key]
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": "1"}
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "FieldCatalog/0.1 (local wildlife catalog)"},
    )
    last_err = "geocode failed"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            last_err = f"geocode HTTP {e.code}"
            if e.code == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise GeocodeError(last_err) from e
        except Exception as e:
            raise GeocodeError(str(e)) from e
    else:
        raise GeocodeError(last_err)
    if not payload:
        raise GeocodeError(f"no geocode match for {q!r}")
    pair = (float(payload[0]["lat"]), float(payload[0]["lon"]))
    _CACHE[key] = pair
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
