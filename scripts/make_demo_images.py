"""Generate the synthetic galaxy images and saliency maps used by demo mode.

The images are toy renderings, not real data. They exist so the interface can
be developed and tested without a live Zooniverse project.

    python3 scripts/make_demo_images.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "demo"
SIZE = 400
RNG = np.random.default_rng(42)

yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(float)
cx = cy = SIZE / 2


def gaussian(x0, y0, sx, sy=None, angle=0.0):
    sy = sx if sy is None else sy
    c, s = np.cos(angle), np.sin(angle)
    dx, dy = xx - x0, yy - y0
    u = c * dx + s * dy
    v = -s * dx + c * dy
    return np.exp(-(u**2 / (2 * sx**2) + v**2 / (2 * sy**2)))


def stars(count=40):
    field = np.zeros((SIZE, SIZE))
    for _ in range(count):
        x, y = RNG.uniform(0, SIZE, 2)
        field += RNG.uniform(0.2, 0.9) * gaussian(x, y, RNG.uniform(0.6, 1.4))
    return field


def spiral(arms=2, tightness=0.35, angle=0.0):
    r = np.hypot(xx - cx, yy - cy)
    theta = np.arctan2(yy - cy, xx - cx) + angle
    pattern = np.cos(arms * (theta - np.log(r + 1) / tightness)) ** 8
    disk = np.exp(-r / 60)
    img = 0.9 * gaussian(cx, cy, 12) + 0.8 * pattern * disk * (r > 15)
    return img


def elliptical():
    return gaussian(cx, cy, 55, 38, 0.5) * 0.9 + gaussian(cx, cy, 10) * 0.3


def edge_on():
    return 0.9 * gaussian(cx, cy, 120, 9, -0.3) + 0.6 * gaussian(cx, cy, 20, 14, -0.3)


def merger():
    return (
        0.8 * gaussian(cx - 50, cy + 10, 30, 22, 0.4)
        + 0.7 * gaussian(cx + 55, cy - 20, 24, 18, -0.2)
        + 0.25 * gaussian(cx, cy - 5, 90, 12, -0.25)
    )


def tint(img, rgb=(1.0, 0.92, 0.82)):
    img = np.clip(img / max(img.max(), 1e-6), 0, 1) ** 0.7
    img = img + stars() + RNG.normal(0, 0.015, img.shape)
    rgb_img = np.clip(np.stack([img * c for c in rgb], axis=-1), 0, 1)
    return Image.fromarray((rgb_img * 255).astype(np.uint8))


def heatmap(weights):
    """Turn a [0, 1] attribution map into a transparent 'inferno-ish' overlay."""
    w = np.clip(weights / max(weights.max(), 1e-6), 0, 1)
    r = np.clip(1.5 * w, 0, 1)
    g = np.clip(1.5 * w - 0.5, 0, 1)
    b = np.clip(0.6 - np.abs(w - 0.3) * 2, 0, 1) * 0.6
    a = np.clip(w * 1.1, 0, 1) ** 0.8
    rgba = np.stack([r, g, b, a], axis=-1)
    return Image.fromarray((rgba * 255).astype(np.uint8), mode="RGBA")


def save(name, subject, saliency):
    tint(subject).save(OUT / f"{name}.jpg", quality=85)
    if saliency is not None:
        heatmap(saliency).save(OUT / f"{name}-saliency.png", optimize=True)


def main():
    OUT.mkdir(exist_ok=True)
    r = np.hypot(xx - cx, yy - cy)

    s = spiral()
    save("subject-spiral", s, s * (r > 12) * np.exp(-r / 160))

    save("subject-elliptical", elliptical(), gaussian(cx, cy, 45, 32, 0.5))

    # The model attends to the bright central bulge and misreads the disk.
    save("subject-edge-on", edge_on(), gaussian(cx, cy, 30, 14, -0.3)
         + 0.5 * gaussian(cx + 60, cy - 18, 25, 10, -0.3))

    save("subject-merger", merger(), gaussian(cx - 50, cy + 10, 26)
         + 0.4 * gaussian(cx, cy - 5, 50, 12, -0.25))

    # Reference examples for the example-based explanation.
    for i, angle in enumerate((1.2, 2.4)):
        tint(spiral(arms=2 + i, tightness=0.3 + 0.1 * i, angle=angle)).resize((160, 160)).save(
            OUT / f"example-spiral-{i + 1}.jpg", quality=80)
    tint(elliptical()).resize((160, 160)).save(OUT / "example-elliptical-1.jpg", quality=80)
    tint(edge_on()).resize((160, 160)).save(OUT / "example-edge-on-1.jpg", quality=80)


if __name__ == "__main__":
    main()
