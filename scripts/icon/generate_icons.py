"""
Generate the Android launcher icon set from the processed artwork.

Input : assets/icon/icon-square.png   (squircle artwork, transparent outside)
Output: android/app/src/main/res/mipmap-*/ic_launcher{,_round,_background}.png
        android/app/src/main/res/drawable-nodpi/splash_icon.png
        assets/icon/icon-mask-preview.png   (how it survives launcher masks)

Layout notes (these are the bits that are easy to get wrong):

  * Adaptive icon canvas is 108dp; only the central 72dp is guaranteed visible.
    Scaling the artwork to the full 108dp would therefore throw away a third of
    the composition. Instead we scale it to FOREGROUND_DP (74dp) and centre it:
    the artwork's outline sits at 36dp along the axes and ~42dp on the diagonal,
    so it still covers the whole 72dp window under every launcher mask, while
    the visible circle shows the complete scene rather than a tight crop.
  * The background layer is the same 74dp artwork with its transparent surround
    edge-extended outward. Same scale means it lines up seamlessly with the
    foreground if a launcher ever reveals more than 72dp.
  * The splash icon is a circle, because Android 12+ shows it inside a circular
    area. Matching that shape means the result is identical whether or not the
    system applies its own mask.
"""

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ART_DIR = ROOT / "assets" / "icon"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

SRC = ART_DIR / "icon-square.png"

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}
LEGACY_DP = 48     # legacy launcher icon size
ADAPTIVE_DP = 108  # adaptive icon layer size
FOREGROUND_DP = 74  # artwork size inside the 108dp adaptive canvas
# Splash icon. The platform sizes the splash icon box to
# `splashscreen_icon_size_no_background` = 288dp (verified in the built APK's
# core-splashscreen resources), and the design spec puts the artwork inside the
# inner 192dp of it. A full-bleed circle therefore renders as a 288dp disc, which
# is 2.25x the in-app splash mark and makes the hand-off jump. So the canvas is
# 288 units with the circle inscribed at 192 units (2/3), and the React splash is
# set to the matching 192px.
SPLASH_CANVAS_PX = 768
SPLASH_CONTENT_RATIO = 2.0 / 3.0
SPLASH_CONTENT_DP = 192
WEB_MARK_PX = 576   # the React splash shows it at 192px; 3x for a 3x screen
SPLASH_WEBP_Q = 92


def edge_extend(im: Image.Image) -> Image.Image:
    """Fill transparent regions with the nearest opaque colour.

    A plain 4-connected BFS from every opaque pixel; used for the adaptive
    background layer so it is opaque everywhere.
    """
    a = np.asarray(im).astype(np.uint8)
    rgb = a[:, :, :3].astype(np.float32)
    alpha = a[:, :, 3]
    h, w = alpha.shape

    filled = alpha > 8
    out = rgb.copy()
    if filled.all():
        return Image.fromarray(np.dstack([out, np.full((h, w), 255)]).astype(np.uint8), "RGBA")

    q = deque()
    seen = filled.copy()
    ys, xs = np.where(filled)
    for y, x in zip(ys.tolist(), xs.tolist()):
        q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                seen[ny, nx] = True
                out[ny, nx] = out[y, x]
                q.append((ny, nx))

    return Image.fromarray(np.dstack([out, np.full((h, w), 255)]).astype(np.uint8), "RGBA")


def circle_mask(size: int) -> Image.Image:
    """Anti-aliased circular mask (4x supersampled)."""
    s = size * 4
    m = Image.new("L", (s, s), 0)
    ImageDraw.Draw(m).ellipse((0, 0, s - 1, s - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def round_icon(art: Image.Image, size: int) -> Image.Image:
    sq = art.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(sq, (0, 0), circle_mask(size))
    return out


def padded_round_icon(art: Image.Image, canvas: int, ratio: float) -> Image.Image:
    """Circular artwork inscribed in a larger transparent square canvas.

    For the splash icon: the platform scales the drawable to fill its icon box, so
    padding the canvas is how the visible disc is made smaller than that box.
    """
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    inner = int(round(canvas * ratio))
    off = (canvas - inner) // 2
    disc = round_icon(art, inner)
    out.paste(disc, (off, off), disc)
    return out


def save(im: Image.Image, folder: str, name: str) -> None:
    d = RES / folder
    d.mkdir(parents=True, exist_ok=True)
    path = d / name
    im.save(path, optimize=True)
    print(f"  {folder}/{name:34s} {im.size[0]:>4}px  {path.stat().st_size / 1024:7.1f} KB")


def adaptive_layers(size: int):
    """Return (foreground, background) RGBA images of the 108dp canvas.

    `size` is the full canvas in pixels. The artwork is scaled to
    FOREGROUND_DP/ADAPTIVE_DP of it and centred; the background is that same
    composite with the transparent surround edge-extended outward.
    """
    fg_px = int(round(size * FOREGROUND_DP / ADAPTIVE_DP))
    fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    art = Image.open(SRC).convert("RGBA").resize((fg_px, fg_px), Image.LANCZOS)
    off = (size - fg_px) // 2
    fg.paste(art, (off, off), art)
    return fg, edge_extend(fg)


def main() -> None:
    art = Image.open(SRC).convert("RGBA")
    print(f"artwork {art.size}")

    print("\nlegacy launcher icons")
    for dens, scale in DENSITIES.items():
        px = int(round(LEGACY_DP * scale))
        save(art.resize((px, px), Image.LANCZOS), f"mipmap-{dens}", "ic_launcher.png")
        save(round_icon(art, px), f"mipmap-{dens}", "ic_launcher_round.png")

    print(f"\nadaptive layers ({FOREGROUND_DP}dp artwork in a {ADAPTIVE_DP}dp canvas)")
    for dens, scale in DENSITIES.items():
        px = int(round(ADAPTIVE_DP * scale))
        fg, bg = adaptive_layers(px)
        save(fg, f"mipmap-{dens}", "ic_launcher_foreground.png")
        save(bg, f"mipmap-{dens}", "ic_launcher_background.png")

    print("\nsplash icon (circular, nodpi)")
    d = RES / "drawable-nodpi"
    d.mkdir(parents=True, exist_ok=True)
    splash = padded_round_icon(art, SPLASH_CANVAS_PX, SPLASH_CONTENT_RATIO)
    # WebP, not PNG: the same canvas is ~769 KB as PNG and ~111 KB as lossy WebP.
    # The splash is on screen for half a second, so the loss is invisible, while
    # the launcher icons stay lossless PNG because they are the app's face and get
    # looked at all day.
    path = d / "splash_icon.webp"
    splash.save(path, "WEBP", quality=SPLASH_WEBP_Q, method=6)
    stale = d / "splash_icon.png"
    if stale.exists():
        stale.unlink()
    print(f"  drawable-nodpi/splash_icon.webp   {SPLASH_CANVAS_PX}px canvas  "
          f"disc {SPLASH_CONTENT_DP}dp  {path.stat().st_size / 1024:7.1f} KB")

    # The in-app splash screen shows the same mark, so the native splash and the
    # React one are the same image and the hand-off is invisible. Full-bleed disc
    # (CSS clips it with rounded-full), sized to match the native disc exactly.
    print("\nin-app splash mark")
    web = ROOT / "src" / "assets"
    web.mkdir(parents=True, exist_ok=True)
    mark = round_icon(art, WEB_MARK_PX)
    mpath = web / "splash-mark.webp"
    mark.save(mpath, "WEBP", quality=SPLASH_WEBP_Q, method=6)
    print(f"  src/assets/splash-mark.webp       {WEB_MARK_PX}px  "
          f"shown at {SPLASH_CONTENT_DP}px  {mpath.stat().st_size / 1024:7.1f} KB")

    print("\nfavicon / touch icon")
    pub = ROOT / "public"
    pub.mkdir(parents=True, exist_ok=True)
    for name, px in (("favicon.png", 64), ("apple-touch-icon.png", 180)):
        p = pub / name
        art.resize((px, px), Image.LANCZOS).save(p, optimize=True)
        print(f"  public/{name:24s} {px:>4}px  {p.stat().st_size / 1024:7.1f} KB")

    # Preview: how the icon survives the masks real launchers apply.
    print("\nmask preview")
    cell, pad = 220, 18
    sheet = Image.new("RGB", (cell * 4, cell), (250, 249, 246))
    d2 = ImageDraw.Draw(sheet)

    def draw_masked(kind: str, x: int, label: str) -> None:
        size = cell - pad * 2
        tile = Image.new("RGB", (cell, cell), (250, 249, 246))
        if kind == "legacy":
            ico = art.resize((size, size), Image.LANCZOS)
        elif kind == "legacy-round":
            ico = round_icon(art, size)
        else:
            fg, bg = adaptive_layers(size)
            # The mask only covers the central 72dp of the 108dp canvas; the
            # outer 18dp on each side is always cropped by the launcher.
            vis = int(round(size * 72 / ADAPTIVE_DP))
            off = (size - vis) // 2
            if kind == "adaptive-circle":
                small = circle_mask(vis)
            else:  # squircle mask, the shape most OEM launchers use
                m4 = Image.new("L", (vis * 4, vis * 4), 0)
                ImageDraw.Draw(m4).rounded_rectangle(
                    (0, 0, vis * 4 - 1, vis * 4 - 1),
                    radius=int(vis * 4 * 0.28), fill=255)
                small = m4.resize((vis, vis), Image.LANCZOS)
            m = Image.new("L", (size, size), 0)
            m.paste(small, (off, off))
            ico = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            ico.paste(bg, (0, 0))
            ico.paste(fg, (0, 0), fg)
            masked = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            masked.paste(ico, (0, 0), m)
            # Show only what the launcher actually reveals, blown back up to the
            # tile size, so the adaptive previews read at the same apparent size
            # as the legacy ones.
            ico = masked.crop((off, off, off + vis, off + vis)).resize(
                (size, size), Image.LANCZOS)
        tile.paste(ico, (pad, pad), ico)
        sheet.paste(tile, (x, 0))
        d2.text((x + pad, cell - 14), label, fill=(70, 70, 70))

    for i, (kind, label) in enumerate([
        ("legacy", "legacy square"),
        ("legacy-round", "legacy round"),
        ("adaptive-circle", "adaptive / circle"),
        ("adaptive-squircle", "adaptive / squircle"),
    ]):
        draw_masked(kind, i * cell, label)

    out = ART_DIR / "icon-mask-preview.png"
    sheet.save(out)
    print(f"  wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
