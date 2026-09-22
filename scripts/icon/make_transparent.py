"""
Fit the artwork's squircle outline and use it to build a clean alpha channel.

Why not a colour threshold for the edge band: the backdrop is a very light warm
off-white (~253,252,250) and the sky in the artwork is a pale blue that is also
"close to white". Any distance-from-white band wide enough to cover the
anti-aliased edge therefore also swallows the sky, punching semi-transparent
holes through it. The edge has to be decided geometrically.

So: flood-fill the backdrop from the border (safe, small tolerance, never
reaches the artwork), fit a superellipse to the resulting outline, and derive
alpha analytically from that fit. The fitted shape is hole-free by construction
and its anti-aliasing is exact rather than sampled from noisy pixels.

Outputs (assets/icon/):
  icon-transparent.png  full canvas, backdrop -> alpha 0
  icon-square.png       trimmed to the artwork bounds
  icon-preview.png      over light / dark / checker, to eyeball the edge
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "icon"
SRC = OUT / "source.png"

TOL_CORE = 25.0   # backdrop tolerance; far below the palest artwork colour
PROPAGATE = 6     # dilation steps used to reach a solid content colour


def flood(candidate: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """4-connected flood fill restricted to `candidate`, starting at `seeds`."""
    cur = seeds & candidate
    while True:
        nxt = cur.copy()
        nxt[1:, :] |= cur[:-1, :]
        nxt[:-1, :] |= cur[1:, :]
        nxt[:, 1:] |= cur[:, :-1]
        nxt[:, :-1] |= cur[:, 1:]
        nxt &= candidate
        if not (nxt ^ cur).any():
            return cur
        cur = nxt


def border_seeds(mask: np.ndarray) -> np.ndarray:
    s = np.zeros_like(mask)
    s[0, :] = mask[0, :]
    s[-1, :] = mask[-1, :]
    s[:, 0] = mask[:, 0]
    s[:, -1] = mask[:, -1]
    return s


def outline_points(content: np.ndarray):
    """Collect the outermost content pixel per row and per column."""
    h, w = content.shape
    pts = []
    ys = np.arange(h)
    for y in range(h):
        row = np.flatnonzero(content[y])
        if row.size:
            pts.append((row[0], y))
            pts.append((row[-1], y))
    for x in range(w):
        col = np.flatnonzero(content[:, x])
        if col.size:
            pts.append((x, col[0]))
            pts.append((x, col[-1]))
    return np.array(pts, dtype=np.float64)


def fit_exponent(pts, cx, cy, a, b, rounds: int = 6, tol_px: float = 3.0):
    """Robust least-squares fit of the superellipse exponent n.

    A handful of outline points are unreliable: where the artwork's own edge is
    a white seagull or a pale cloud, the flood fill walks straight through into
    the artwork and reports an interior point as boundary. Those outliers are
    ~1% of the points but they dominate a plain least-squares fit, so we fit,
    drop everything beyond `tol_px`, and refit until the inlier set is stable.
    """
    X = np.abs((pts[:, 0] - cx) / a)
    Y = np.abs((pts[:, 1] - cy) / b)
    keep = (X > 1e-9) | (Y > 1e-9)
    X, Y = X[keep], Y[keep]
    scale = np.sqrt(a * b)

    alive = np.ones(X.shape, bool)
    best_n = 2.0
    for _ in range(rounds):
        best_n, best_err = None, None
        for n in np.arange(1.6, 9.0, 0.01):
            r = (X[alive] ** n + Y[alive] ** n) ** (1.0 / n)
            err = np.mean((r - 1.0) ** 2)
            if best_err is None or err < best_err:
                best_n, best_err = n, err
        r = (X**best_n + Y**best_n) ** (1.0 / best_n)
        resid = np.abs(r - 1.0) * scale
        new_alive = resid <= tol_px
        if new_alive.sum() < 100 or np.array_equal(new_alive, alive):
            alive = new_alive if new_alive.sum() >= 100 else alive
            break
        alive = new_alive

    r = (X[alive] ** best_n + Y[alive] ** best_n) ** (1.0 / best_n)
    inlier_px = (r - 1.0) * scale
    stats = dict(
        n=best_n, inliers=int(alive.sum()), total=int(X.size),
        mean_px=float(inlier_px.mean()),
        p95_px=float(np.percentile(np.abs(inlier_px), 95)),
        max_px=float(np.abs(inlier_px).max()),
    )
    return stats


def propagate_colour(colour: np.ndarray, known: np.ndarray, steps: int):
    """Grow `known` outward, averaging neighbouring colours into new pixels."""
    h, w = known.shape
    for _ in range(steps):
        acc = np.zeros_like(colour)
        cnt = np.zeros((h, w), np.float32)
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            k = np.roll(known, shift, axis=axis)
            c = np.roll(colour, shift, axis=axis)
            # np.roll wraps around; drop the wrapped row/column so colours
            # never leak in from the opposite edge of the image.
            if axis == 0:
                k[0 if shift > 0 else -1, :] = False
            else:
                k[:, 0 if shift > 0 else -1] = False
            m = k & ~known
            acc[m] += c[m]
            cnt[m] += 1
        upd = (cnt > 0) & ~known
        if not upd.any():
            break
        colour[upd] = acc[upd] / cnt[upd][:, None]
        known = known | upd
    return colour, known


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    im = Image.open(SRC).convert("RGB")
    arr = np.asarray(im).astype(np.float32)
    h, w = arr.shape[:2]
    print(f"source: {w}x{h}")

    ring = np.concatenate([
        arr[:3].reshape(-1, 3), arr[-3:].reshape(-1, 3),
        arr[:, :3].reshape(-1, 3), arr[:, -3:].reshape(-1, 3),
    ])
    bg = np.median(ring, axis=0).astype(np.float32)
    print("backdrop colour:", bg)

    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    core = dist < TOL_CORE
    bg_core = flood(core, border_seeds(core))
    content = ~bg_core
    print(f"backdrop {bg_core.sum():,} px | content {content.sum():,} px")

    pts = outline_points(content)
    x0, y0 = pts[:, 0].min(), pts[:, 1].min()
    x1, y1 = pts[:, 0].max(), pts[:, 1].max()
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    a, b = (x1 - x0) / 2.0, (y1 - y0) / 2.0
    print(f"outline bbox ({x0:.0f},{y0:.0f})-({x1:.0f},{y1:.0f})  "
          f"centre ({cx:.1f},{cy:.1f})  semi-axes ({a:.1f},{b:.1f})")

    stats = fit_exponent(pts, cx, cy, a, b)
    n = stats["n"]
    print(f"fitted superellipse n={n:.2f}  "
          f"inliers {stats['inliers']}/{stats['total']}  "
          f"mean {stats['mean_px']:+.3f}px  p95 {stats['p95_px']:.3f}px  "
          f"max {stats['max_px']:.3f}px")

    # Analytic anti-aliased coverage from the fitted implicit surface.
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)
    Xf = (xs[None, :] + 0.5 - cx) / a
    Yf = (ys[:, None] + 0.5 - cy) / b
    absX = np.abs(Xf)
    absY = np.abs(Yf)
    F = absX**n + absY**n - 1.0
    gx = (n / a) * absX ** (n - 1.0)
    gy = (n / b) * absY ** (n - 1.0)
    grad = np.sqrt(gx**2 + gy**2)
    signed = F / np.maximum(grad, 1e-6)   # approx. signed distance, pixels
    alpha = np.clip(0.5 - signed, 0.0, 1.0).astype(np.float32)

    # Sanity check against the flood fill. bg_core is trusted everywhere except
    # where it leaked through a white edge (seagulls, pale cloud); a large
    # disagreement means the fit is wrong and we should not trust the output.
    leak = bg_core & (alpha > 0.5)
    print(f"flood-fill / fit disagreement: {leak.sum():,} px "
          f"({100.0 * leak.sum() / max(1, int((~bg_core).sum())):.2f}% of content)")

    # Colour decontamination: semi-transparent edge pixels still carry white
    # bleed; un-premultiply against the nearest solid content colour.
    band = (alpha > 0.02) & (alpha < 0.985)
    solid = alpha >= 0.985
    colour, _ = propagate_colour(arr.copy(), solid.copy(), PROPAGATE)
    fix = band & (alpha > 0.02)
    a_fix = alpha[fix][:, None]
    out_rgb = arr.copy()
    out_rgb[fix] = np.clip((arr[fix] - (1.0 - a_fix) * bg[None, :]) / a_fix, 0, 255)
    print(f"edge band {band.sum():,} px decontaminated")

    out = np.dstack([out_rgb, alpha * 255.0]).astype(np.uint8)
    full = Image.fromarray(out, "RGBA")
    full.save(OUT / "icon-transparent.png")
    print("wrote icon-transparent.png", full.size)

    bbox = full.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    trimmed = full.crop(bbox)
    side = max(trimmed.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(trimmed, ((side - trimmed.width) // 2, (side - trimmed.height) // 2))
    sq.save(OUT / "icon-square.png")
    print("wrote icon-square.png", sq.size, "from bbox", bbox)

    cell = 320
    checker = Image.new("RGB", (cell, cell), (235, 235, 235))
    dc = ImageDraw.Draw(checker)
    for yy in range(0, cell, 16):
        for xx in range(0, cell, 16):
            if (xx // 16 + yy // 16) % 2:
                dc.rectangle([xx, yy, xx + 15, yy + 15], fill=(205, 205, 205))
    art = sq.resize((cell - 32, cell - 32), Image.LANCZOS)
    sheet = Image.new("RGB", (cell * 3, cell), (255, 255, 255))
    for i, back in enumerate((Image.new("RGB", (cell, cell), (255, 255, 255)),
                              Image.new("RGB", (cell, cell), (16, 26, 22)),
                              checker)):
        tile = back.copy()
        tile.paste(art, (16, 16), art)
        sheet.paste(tile, (cell * i, 0))
    sheet.save(OUT / "icon-preview.png")
    print("wrote icon-preview.png")


if __name__ == "__main__":
    main()
