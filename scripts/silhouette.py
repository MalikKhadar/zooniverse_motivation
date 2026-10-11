"""Turn a galaxy cutout into a soft silhouette, like the Tidal Tales class icons.

The galaxy and its connected faint structure are masked out from the sky and
any unconnected stars or neighbours, then drawn as a blurred dark shape on a
transparent background. The page tints it to match the theme.
"""
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SIZE = 128


def _blur(array, radius):
    image = Image.fromarray(np.uint8(np.clip(array, 0, 1) * 255))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), dtype=float) / 255


def _component(mask, seed):
    """Pixels of `mask` 8-connected to `seed`."""
    h, w = mask.shape
    keep = np.zeros_like(mask)
    if not mask[seed]:
        return keep
    queue = deque([seed])
    keep[seed] = True
    while queue:
        y, x = queue.popleft()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not keep[ny, nx]:
                    keep[ny, nx] = True
                    queue.append((ny, nx))
    return keep


def silhouette(path, threshold=5):
    gray = np.asarray(Image.open(path).convert("L"), dtype=float) / 255
    h, w = gray.shape
    sky = np.median(gray)
    noise = np.median(np.abs(gray - sky)) * 1.4826 or 1 / 255
    signal = np.clip((gray - sky) / noise, 0, None)
    smooth = _blur(signal / max(signal.max(), 1e-6), max(h, w) / 80) * max(signal.max(), 1e-6)

    yy, xx = np.mgrid[0:h, 0:w]
    centred = np.exp(-(np.hypot(yy - h / 2, xx - w / 2) / (0.2 * max(h, w))) ** 2)
    seed = np.unravel_index(np.argmax(smooth * centred), smooth.shape)
    region = _component(smooth > threshold, seed)

    # Shade by brightness rank inside the region (histogram equalisation), so
    # arms, rings and shells show as darker structure over a lighter halo.
    detail = _blur(signal / max(signal.max(), 1e-6), max(h, w) / 200)
    shade = np.zeros_like(detail)
    if region.any():
        values = detail[region]
        shade[region] = np.searchsorted(np.sort(values), values) / len(values)
    edge = _blur(region.astype(float), max(h, w) / 90)
    alpha = (0.15 + 0.85 * shade ** 1.6) * np.clip(edge * 1.8, 0, 1)
    alpha = _blur(alpha, max(h, w) / 160)

    # Crop to the shape, square, with a margin.
    ys, xs = np.nonzero(alpha > 0.05)
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    half = max(ys.max() - ys.min(), xs.max() - xs.min()) / 2 * 1.15 + 2
    box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    shape = Image.fromarray(np.uint8(alpha * 255)).crop(box).resize((SIZE, SIZE), Image.LANCZOS)
    shape = shape.filter(ImageFilter.GaussianBlur(0.8))
    black = Image.new("RGBA", shape.size, (0, 0, 0, 0))
    black.putalpha(shape)
    return black
