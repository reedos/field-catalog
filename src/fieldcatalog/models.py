from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

Verdict = Literal["keep", "reject", "unrated"]
OriginalStatus = Literal["present", "deleted", "offloaded"]
AnimalType = Literal["bird", "mammal", "herp", "fish", "invertebrate", "other"]


@dataclass
class Shot:
    id: str
    original_path: str
    preview_path: str
    original_status: OriginalStatus = "present"
    display_name: str = ""
    common_name: Optional[str] = None
    scientific_name: Optional[str] = None
    animal_type: Optional[AnimalType] = None
    captured_at: str = ""
    created_at: str = ""
    location: str = ""
    lat: Optional[float] = None
    lon: Optional[float] = None
    camera: str = ""
    lens: str = ""
    iso: Optional[int] = None
    shutter: Optional[str] = None
    aperture: Optional[str] = None
    focal_length: Optional[str] = None
    verdict: Verdict = "unrated"
    stars: int = 0
    color: Optional[str] = None
    favorite: bool = False
    sharpness: Optional[float] = None
    # [x, y, w, h] as fractions of the preview, or None when unknown.
    subject_box: Optional[list[float]] = None
    subject_sharpness: Optional[float] = None
    quality: Optional[float] = None
    burst_id: str = ""
    tags: list[str] = field(default_factory=list)
    caption: str = ""
    bytes_original: int = 0
    confidence: Optional[float] = None
    field_marks: list[str] = field(default_factory=list)
    similar_species: list[str] = field(default_factory=list)
    notes: str = ""
    gps_from_file: bool = False
    preview_width: Optional[int] = None
    preview_height: Optional[int] = None
    content_hash: Optional[str] = None
    life_list_pick: bool = False

    def to_row(self) -> dict[str, Any]:
        d = asdict(self)
        d["favorite"] = int(self.favorite)
        d["gps_from_file"] = int(self.gps_from_file)
        d["life_list_pick"] = int(self.life_list_pick)
        d["tags"] = ",".join(self.tags)
        d["field_marks"] = json.dumps(self.field_marks)
        d["similar_species"] = json.dumps(self.similar_species)
        d["subject_box"] = json.dumps(self.subject_box) if self.subject_box else None
        return d

    @classmethod
    def from_row(cls, row: Any) -> "Shot":
        tags = [t for t in (row["tags"] or "").split(",") if t]
        return cls(
            id=row["id"],
            original_path=row["original_path"],
            preview_path=row["preview_path"],
            original_status=row["original_status"],
            display_name=row["display_name"] or "",
            common_name=row["common_name"],
            scientific_name=row["scientific_name"],
            animal_type=row["animal_type"],
            captured_at=row["captured_at"] or "",
            created_at=row["created_at"] or "",
            location=row["location"] or "",
            lat=row["lat"],
            lon=row["lon"],
            camera=row["camera"] or "",
            lens=row["lens"] or "",
            iso=row["iso"],
            shutter=row["shutter"],
            aperture=row["aperture"],
            focal_length=row["focal_length"],
            verdict=row["verdict"] or "unrated",
            stars=row["stars"] or 0,
            color=row["color"],
            favorite=bool(row["favorite"]),
            sharpness=row["sharpness"],
            subject_box=_box(_col(row, "subject_box")),
            subject_sharpness=_col(row, "subject_sharpness"),
            quality=row["quality"],
            burst_id=row["burst_id"] or "",
            tags=tags,
            caption=row["caption"] or "",
            bytes_original=row["bytes_original"] or 0,
            confidence=_col(row, "confidence"),
            field_marks=_marks(_col(row, "field_marks")),
            similar_species=_marks(_col(row, "similar_species")),
            notes=_col(row, "notes") or "",
            gps_from_file=bool(_col(row, "gps_from_file") or 0),
            preview_width=_col(row, "preview_width"),
            preview_height=_col(row, "preview_height"),
            content_hash=_col(row, "content_hash"),
            life_list_pick=bool(_col(row, "life_list_pick") or 0),
        )


def _col(row: Any, key: str, default: Any = None) -> Any:
    try:
        if key in row.keys():
            return row[key]
    except Exception:
        pass
    return default


def _box(raw: Any) -> Optional[list[float]]:
    """A stored [x, y, w, h]; anything else reads as absent."""
    if not raw:
        return None
    if isinstance(raw, (list, tuple)):
        vals = list(raw)
    else:
        try:
            vals = json.loads(str(raw))
        except json.JSONDecodeError:
            return None
    if not isinstance(vals, list) or len(vals) != 4:
        return None
    try:
        return [float(v) for v in vals]
    except (TypeError, ValueError):
        return None


def _marks(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw if str(x).strip()]
    text = str(raw).strip()
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if str(x).strip()]
        except json.JSONDecodeError:
            pass
    return [p.strip() for p in text.replace("\n", "|").split("|") if p.strip()]
