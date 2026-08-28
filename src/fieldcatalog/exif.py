from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ExifTags


def _rational(val: Any) -> float | None:
    try:
        if hasattr(val, "numerator"):
            return float(val.numerator) / float(val.denominator or 1)
        if isinstance(val, tuple) and len(val) == 2:
            return float(val[0]) / float(val[1] or 1)
        return float(val)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _dms(values: Any, ref: str | None) -> float | None:
    try:
        d, m, s = values
        deg = (_rational(d) or 0) + (_rational(m) or 0) / 60 + (_rational(s) or 0) / 3600
        if ref in ("S", "W"):
            deg = -deg
        return deg
    except Exception:
        return None


def _shutter(value: Any) -> str:
    """Format an exposure time the same way whether it came from exiftool or PIL.

    exiftool runs with -n, so it hands back a bare float like 0.008 where PIL
    yields a rational. Both must render as "1/125".
    """
    seconds = _rational(value)
    if seconds is None or seconds <= 0:
        return str(value)
    if seconds < 1:
        return f"1/{round(1 / seconds)}"
    return f"{seconds:g}"


def _empty() -> dict[str, Any]:
    return {
        "captured_at": None,
        "lat": None,
        "lon": None,
        "camera": "",
        "lens": "",
        "iso": None,
        "shutter": None,
        "aperture": None,
        "focal_length": None,
        "location": "",
    }


TAGS = (
    "-DateTimeOriginal",
    "-CreateDate",
    "-GPSLatitude",
    "-GPSLongitude",
    "-Make",
    "-Model",
    "-LensModel",
    "-ISO",
    "-ShutterSpeed",
    "-FNumber",
    "-FocalLength",
    "-City",
    "-Location",
    "-Country",
)

# exiftool is a large Perl program; starting it costs far more than reading any
# one file. Ask it about a whole batch per spawn.
EXIFTOOL_BATCH = 200


def _exiftool_rows(paths: list[Path]) -> dict[str, dict[str, Any]] | None:
    """Run exiftool once over many files. None means exiftool is unavailable."""
    bin_path = shutil.which("exiftool")
    if not bin_path:
        return None
    rows: dict[str, dict[str, Any]] = {}
    for i in range(0, len(paths), EXIFTOOL_BATCH):
        chunk = paths[i : i + EXIFTOOL_BATCH]
        proc = subprocess.run(
            [bin_path, "-json", "-n", *TAGS, *[str(p) for p in chunk]],
            capture_output=True,
            text=True,
            check=False,
        )
        if not proc.stdout.strip():
            continue
        try:
            parsed = json.loads(proc.stdout)
        except Exception:
            continue
        for row in parsed:
            source = row.get("SourceFile")
            if source:
                rows[str(Path(source).resolve())] = _from_row(row)
    return rows


def _exiftool(path: Path) -> dict[str, Any] | None:
    rows = _exiftool_rows([path])
    if rows is None:
        return None
    return rows.get(str(path.resolve()))


def _from_row(row: dict[str, Any]) -> dict[str, Any]:
    out = _empty()
    dt = row.get("DateTimeOriginal") or row.get("CreateDate")
    if dt:
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                out["captured_at"] = datetime.strptime(str(dt)[:19], fmt).isoformat()
                break
            except ValueError:
                out["captured_at"] = str(dt)
    lat, lon = row.get("GPSLatitude"), row.get("GPSLongitude")
    try:
        out["lat"] = float(lat) if lat is not None else None
        out["lon"] = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        pass
    make, model = str(row.get("Make") or "").strip(), str(row.get("Model") or "").strip()
    out["camera"] = " ".join(p for p in (make, model) if p)
    out["lens"] = str(row.get("LensModel") or "").strip()
    try:
        out["iso"] = int(row["ISO"]) if row.get("ISO") is not None else None
    except (TypeError, ValueError):
        pass
    if row.get("ShutterSpeed") is not None:
        out["shutter"] = _shutter(row["ShutterSpeed"])
    if row.get("FNumber") is not None:
        out["aperture"] = f"f/{row['FNumber']}"
    if row.get("FocalLength") is not None:
        fl = row["FocalLength"]
        out["focal_length"] = f"{fl}mm" if not str(fl).endswith("mm") else str(fl)
    place = " ".join(str(row[k]) for k in ("Location", "City", "Country") if row.get(k)).strip()
    out["location"] = place
    return out


def _pil(path: Path) -> dict[str, Any]:
    out = _empty()
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            if not exif:
                return out
            named = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
            try:
                ifd = exif.get_ifd(ExifTags.IFD.Exif)  # type: ignore[attr-defined]
                named.update({ExifTags.TAGS.get(k, k): v for k, v in ifd.items()})
            except Exception:
                pass
            make = str(named.get("Make") or "").strip()
            model = str(named.get("Model") or "").strip()
            out["camera"] = " ".join(p for p in (make, model) if p)
            out["lens"] = str(named.get("LensModel") or "").strip()
            iso = named.get("ISOSpeedRatings") or named.get("PhotographicSensitivity")
            if isinstance(iso, (tuple, list)):
                iso = iso[0]
            if iso is not None:
                try:
                    out["iso"] = int(iso)
                except (TypeError, ValueError):
                    pass
            r = _rational(named.get("ExposureTime"))
            if r:
                out["shutter"] = _shutter(r)
            fnum = _rational(named.get("FNumber"))
            if fnum:
                out["aperture"] = f"f/{fnum:g}"
            fl = _rational(named.get("FocalLength"))
            if fl:
                out["focal_length"] = f"{fl:g}mm"
            dt = named.get("DateTimeOriginal") or named.get("DateTime")
            if dt:
                try:
                    out["captured_at"] = datetime.strptime(str(dt), "%Y:%m:%d %H:%M:%S").isoformat()
                except ValueError:
                    pass
            try:
                gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)  # type: ignore[attr-defined]
                gps = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}
                out["lat"] = _dms(gps.get("GPSLatitude"), str(gps.get("GPSLatitudeRef") or ""))
                out["lon"] = _dms(gps.get("GPSLongitude"), str(gps.get("GPSLongitudeRef") or ""))
            except Exception:
                pass
    except Exception:
        return out
    return out


def parse_exif(path: Path) -> dict[str, Any]:
    """Read GPS/time/camera from the file. Never invents coordinates or a place name."""
    return parse_exif_many([path])[path]


def _complete(meta: dict[str, Any]) -> bool:
    """Did exiftool actually understand the file? GPS is legitimately absent on
    most frames, so it is not part of the test -- requiring it would run PIL a
    second time over the whole library for nothing."""
    return all(meta.get(k) not in (None, "") for k in ("captured_at", "camera"))


def parse_exif_many(paths: list[Path]) -> dict[Path, dict[str, Any]]:
    """parse_exif over a list, with one exiftool spawn per batch instead of per file.

    Starting exiftool costs far more than reading a single file, so importing a
    card used to spend most of its time in process startup.
    """
    if not paths:
        return {}
    rows = _exiftool_rows(paths)
    out: dict[Path, dict[str, Any]] = {}
    for path in paths:
        meta = None if rows is None else rows.get(str(path.resolve()))
        if meta is None:
            meta = _pil(path)
        elif not _complete(meta):
            for key, value in _pil(path).items():
                if meta.get(key) in (None, "") and value not in (None, ""):
                    meta[key] = value
        if not meta.get("captured_at"):
            meta["captured_at"] = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
        out[path] = meta
    return out
