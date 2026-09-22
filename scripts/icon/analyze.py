"""Analyze the icon source: background purity, content bbox, corner radius."""
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(__file__).resolve().parents[2] / "assets" / "icon" / "source.png"

im = Image.open(SRC)
print("mode:", im.mode, "size:", im.size)
rgba = im.convert("RGBA")
a = np.asarray(rgba).astype(np.int16)
h, w = a.shape[:2]
rgb = a[:, :, :3]
alpha = a[:, :, 3]

print("alpha min/max:", alpha.min(), alpha.max())

# how far each pixel is from pure white
dist = np.sqrt(((255 - rgb.astype(np.float32)) ** 2).sum(axis=2))

print("\n-- corner samples (10x10 mean) --")
for name, sl in [
    ("TL", (slice(0, 10), slice(0, 10))),
    ("TR", (slice(0, 10), slice(w - 10, w))),
    ("BL", (slice(h - 10, h), slice(0, 10))),
    ("BR", (slice(h - 10, h), slice(w - 10, w))),
]:
    print(name, rgb[sl].reshape(-1, 3).mean(axis=0).round(2), "dist=%.2f" % dist[sl].mean())

print("\n-- edge midpoints (10x10 mean) --")
for name, sl in [
    ("top-mid", (slice(0, 10), slice(w // 2 - 5, w // 2 + 5))),
    ("bot-mid", (slice(h - 10, h), slice(w // 2 - 5, w // 2 + 5))),
    ("left-mid", (slice(h // 2 - 5, h // 2 + 5), slice(0, 10))),
    ("right-mid", (slice(h // 2 - 5, h // 2 + 5), slice(w - 10, w))),
]:
    print(name, rgb[sl].reshape(-1, 3).mean(axis=0).round(2), "dist=%.2f" % dist[sl].mean())

# content = not near white
for tol in (8, 12, 18, 25, 35, 50):
    mask = dist > tol
    ys, xs = np.where(mask)
    if len(ys) == 0:
        print("tol", tol, "empty")
        continue
    print(
        "tol=%2d  bbox=(%d,%d)-(%d,%d)  w=%d h=%d  coverage=%.3f%%"
        % (tol, xs.min(), ys.min(), xs.max(), ys.max(),
           xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, 100 * mask.mean())
    )

# row/column profiles of the "solid" mask to estimate corner radius
tol = 25
mask = dist > tol
ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print("\nbbox from tol=25:", (x0, y0, x1, y1), "size", (x1 - x0 + 1, y1 - y0 + 1))

# For each row near the top, find first opaque x -> gives the corner curve
print("\n-- top-left corner curve (row -> first content x) --")
for dy in range(0, 60, 4):
    y = y0 + dy
    row = np.where(mask[y])[0]
    if len(row):
        print("  dy=%2d  x0_offset=%3d" % (dy, row.min() - x0))
