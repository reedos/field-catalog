from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps

RAW_SUFFIXES = {".nef", ".cr2", ".cr3", ".arw", ".raf", ".orf", ".rw2", ".dng"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"} | RAW_SUFFIXES
MIN_EMBEDDED_JPEG = 20_000


def is_photo(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_SUFFIXES


def extract_embedded_jpeg(path: Path) -> bytes | None:
    """Largest JPEG inside a RAW container. No demosaic — cull from the camera preview."""
    data = path.read_bytes()
    best: bytes | None = None
    start = 0
    while True:
        i = data.find(b"\xff\xd8\xff", start)
        if i < 0:
            break
        j = data.find(b"\xff\xd9", i + 3)
        if j < 0:
            break
        blob = data[i : j + 2]
        if best is None or len(blob) > len(best):
            best = blob
        start = i + 3
    # Below ~20KB this is a contact-sheet thumbnail, not something you can cull
    # from. Better to fail the import than to file a 160x120 preview.
    return best if best and len(best) > MIN_EMBEDDED_JPEG else None


def apply_orientation(img: Image.Image) -> Image.Image:
    """Honor EXIF Orientation so portrait D850 frames stay portrait."""
    transposed = ImageOps.exif_transpose(img)
    return transposed if transposed is not None else img


def open_for_preview(path: Path) -> Image.Image:
    suffix = path.suffix.lower()
    if suffix in RAW_SUFFIXES:
        try:
            import rawpy  # type: ignore

            with rawpy.imread(str(path)) as raw:
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    from io import BytesIO

                    return Image.open(BytesIO(thumb.data))
        except Exception:
            pass
        embedded = extract_embedded_jpeg(path)
        if not embedded:
            raise RuntimeError(f"No JPEG preview in {path.name}")
        from io import BytesIO

        return Image.open(BytesIO(embedded))
    img = Image.open(path)
    img.load()
    return img


def write_preview(src: Path, dest: Path, max_edge: int = 1600, quality: int = 82) -> tuple[int, int]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open_for_preview(src) as img:
        img = apply_orientation(img).convert("RGB")
        w, h = img.size
        scale = min(1.0, max_edge / max(w, h))
        if scale < 1:
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        img.save(dest, "JPEG", quality=quality, optimize=True)
        return img.size
