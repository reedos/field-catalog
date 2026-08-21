from __future__ import annotations

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
    quality: Optional[float] = None
    burst_id: str = ""
    tags: list[str] = field(default_factory=list)
    caption: str = ""
    bytes_original: int = 0

    def to_row(self) -> dict[str, Any]:
        d = asdict(self)
        d["favorite"] = int(self.favorite)
        d["tags"] = ",".join(self.tags)
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
            quality=row["quality"],
            burst_id=row["burst_id"] or "",
            tags=tags,
            caption=row["caption"] or "",
            bytes_original=row["bytes_original"] or 0,
        )
