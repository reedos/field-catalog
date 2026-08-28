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
    if min(g.shape) < 3:
        return 0.0
    # 4-neighbour Laplacian over the interior. Written out rather than convolved:
    # the kernel is five non-zero cells and the borders are simply dropped.
    acc = (
        g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4.0 * g[1:-1, 1:-1]
    )
    return float(acc.var())
