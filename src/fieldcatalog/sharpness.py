from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


def score_sharpness(path: Path, edge: int = 256) -> float:
    """Laplacian variance on luma. Higher = sharper. Local, no API."""
    with Image.open(path) as img:
        img = img.convert("L")
        w, h = img.size
        scale = edge / max(w, h)
        if scale < 1:
            img = img.resize((max(24, int(w * scale)), max(24, int(h * scale))), Image.Resampling.BILINEAR)
        g = np.asarray(img, dtype=np.float32)
    k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    padded = g
    acc = (
        k[1, 1] * padded[1:-1, 1:-1]
        + k[1, 0] * padded[1:-1, :-2]
        + k[1, 2] * padded[1:-1, 2:]
        + k[0, 1] * padded[:-2, 1:-1]
        + k[2, 1] * padded[2:, 1:-1]
    )
    return float(acc.var())
