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


def _exiftool(path: Path) -> dict[str, Any] | None:
    bin_path = shutil.which("exiftool")
    if not bin_path:
        return None
    proc = subprocess.run(
        [
            bin_path,
            "-json",
            "-n",
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
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        row = json.loads(proc.stdout)[0]
    except Exception:
        return None
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
    out = _exiftool(path)
    if out is None:
        out = _pil(path)
    elif not _complete(out):
        # exiftool returning a dict does not mean it filled it in. Merge PIL in
        # field by field rather than letting a sparse exiftool result win.
        for key, value in _pil(path).items():
            if out.get(key) in (None, "") and value not in (None, ""):
                out[key] = value
    if not out.get("captured_at"):
        # EXIF timestamps are naive local time, so the mtime fallback has to be
        # local too -- a UTC value here would shift the shot into another day
        # and out of its burst.
        out["captured_at"] = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    return out


def _complete(meta: dict[str, Any]) -> bool:
    """Did exiftool actually understand the file? GPS is legitimately absent on
    most frames, so it is not part of the test -- requiring it would run PIL a
    second time over the whole library for nothing."""
    return all(meta.get(k) not in (None, "") for k in ("captured_at", "camera"))
