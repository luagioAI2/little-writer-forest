"""Zoom the four corners and the edge midpoints at 1:1 over dark green,
so any residual white sliver or over-eager bite is obvious."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "assets" / "icon" / "icon-transparent.png"

BG = (16, 26, 22)
PATCH = 190      # crop size
SCALE = 2        # display magnification

im = Image.open(ART).convert("RGBA")
w, h = im.size
alpha = np.asarray(im.getchannel("A"))
ys, xs = np.where(alpha > 8)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print(f"artwork {im.size}, content bbox ({x0},{y0})-({x1},{y1})")

spots = {
    "TL": (x0, y0),
    "TR": (x1 - PATCH, y0),
    "BL": (x0, y1 - PATCH),
    "BR": (x1 - PATCH, y1 - PATCH),
    "top-mid": ((x0 + x1) // 2 - PATCH // 2, y0 - 10),
    "left-mid": (x0 - 10, (y0 + y1) // 2 - PATCH // 2),
    "right-mid": (x1 - PATCH + 10, (y0 + y1) // 2 - PATCH // 2),
    "bottom-mid": ((x0 + x1) // 2 - PATCH // 2, y1 - PATCH + 10),
}

cols = 4
rows = 2
sheet = Image.new("RGB", (PATCH * SCALE * cols, PATCH * SCALE * rows), BG)
d = ImageDraw.Draw(sheet)

for i, (name, (cx, cy)) in enumerate(spots.items()):
    cx = max(0, min(w - PATCH, cx))
    cy = max(0, min(h - PATCH, cy))
    patch = im.crop((cx, cy, cx + PATCH, cy + PATCH))
    tile = Image.new("RGB", (PATCH, PATCH), BG)
    tile.paste(patch, (0, 0), patch)
    tile = tile.resize((PATCH * SCALE, PATCH * SCALE), Image.NEAREST)
    px = (i % cols) * PATCH * SCALE
    py = (i // cols) * PATCH * SCALE
    sheet.paste(tile, (px, py))
    d.text((px + 6, py + 6), name, fill=(255, 220, 120))
    d.rectangle([px, py, px + PATCH * SCALE - 1, py + PATCH * SCALE - 1],
                outline=(90, 90, 90))

out = ROOT / "assets" / "icon" / "icon-edge-zoom.png"
sheet.save(out)
print("wrote", out, sheet.size)

# Numeric edge audit: walk the alpha profile across the boundary and report
# how many pixels are partial (a healthy AA edge has a thin, monotonic ramp).
partial = ((alpha > 8) & (alpha < 247)).sum()
print(f"partial-alpha pixels: {partial:,}  "
      f"({100.0 * partial / alpha.size:.3f}% of canvas)")
perimeter = 2 * np.pi * np.sqrt(((x1 - x0) / 2) * ((y1 - y0) / 2))
print(f"approx perimeter {perimeter:.0f}px -> mean ramp width "
      f"{partial / perimeter:.2f}px")

# Any pixel that is nearly opaque white right at the boundary == leftover sliver
rgb = np.asarray(im.convert("RGB")).astype(np.int16)
near_white = (rgb > 246).all(axis=2) & (alpha > 200) & (alpha < 255)
edge_zone = np.zeros_like(alpha, bool)
edge_zone[y0:y1 + 1, x0:x1 + 1] = True
# only count white pixels that touch transparency
touch = np.zeros_like(alpha, bool)
t = alpha < 8
touch[1:, :] |= t[:-1, :]
touch[:-1, :] |= t[1:, :]
touch[:, 1:] |= t[:, :-1]
touch[:, :-1] |= t[:, 1:]
bad = near_white & touch
print(f"suspicious white pixels adjacent to transparency: {int(bad.sum())}")
if bad.any():
    bys, bxs = np.where(bad)
    print("  sample:", list(zip(bxs[:8].tolist(), bys[:8].tolist())))
