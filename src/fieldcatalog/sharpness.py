from __future__ import annotations

from pathlib import Path

import numpy as np
from collections.abc import Sequence

from PIL import Image


def score_region(path: Path, box: Sequence[float] | None, edge: int = 256) -> float | None:
    """Sharpness measured inside `box` only, as [x, y, w, h] in 0-1 fractions.

    The whole-frame score is a variance over everything, so a soft subject in
    front of a crisp branch still scores well. Cropping first asks the question
    that actually decides a wildlife frame: is the animal sharp?

    Returns None when the box is missing or too small to measure, so callers
    can fall back to the whole-frame number rather than trusting a crop of
    nine pixels.
    """
    if not box or len(box) != 4:
        return None
    x, y, w, h = (float(v) for v in box)
    if not all(0.0 <= v <= 1.0 for v in (x, y)) or w <= 0 or h <= 0:
        return None
    with Image.open(path) as img:
        W, H = img.size
        left, top = int(x * W), int(y * H)
        right, bottom = int(min(1.0, x + w) * W), int(min(1.0, y + h) * H)
        if right - left < 16 or bottom - top < 16:
            return None
        crop = img.convert("L").crop((left, top, right, bottom))
        cw, ch = crop.size
        scale = edge / max(cw, ch)
        if scale < 1:
            crop = crop.resize((max(24, int(cw * scale)), max(24, int(ch * scale))), Image.Resampling.BILINEAR)
        g = np.asarray(crop, dtype=np.float32)
    if min(g.shape) < 3:
        return None
    acc = g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4.0 * g[1:-1, 1:-1]
    return float(acc.var())


def score_sharpness(path: Path, edge: int = 256) -> float:
    """Laplacian variance on luma. Higher = sharper. Local, no API."""
    with Image.open(path) as img:
        img = img.convert("L")
        w, h = img.size
        scale = edge / max(w, h)
        if scale < 1:
            img = img.resize((max(24, int(w * scale)), max(24, int(h * scale))), Image.Resampling.BILINEAR)
        g = np.asarray(img, dtype=np.float32)
    if min(g.shape) < 3:
        return 0.0
    # 4-neighbour Laplacian over the interior. Written out rather than convolved:
    # the kernel is five non-zero cells and the borders are simply dropped.
    acc = (
        g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4.0 * g[1:-1, 1:-1]
    )
    return float(acc.var())
