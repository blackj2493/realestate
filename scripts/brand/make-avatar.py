"""
Generates square profile-picture PNGs from the PureProperty.ca brand mark.

The mark is the same chevron used in public/favicon.svg and src/app/icon.svg,
recentred and scaled into a circle-safe zone (Twitter/X crops avatars to a
circle inscribed in the square, so nothing may sit in the corners).

Usage: python3 scripts/brand/make-avatar.py
Output: public/brand/pureproperty-avatar-{1000,400}.png (+ -accent variants)
"""

import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "public", "brand")
SS = 4  # supersample factor for antialiasing

NAVY = (10, 24, 40)          # #0A1828 - brand background
NAVY_TOP = (17, 38, 60)      # subtle gradient top
NAVY_BOTTOM = (6, 15, 26)    # subtle gradient bottom
WHITE = (255, 255, 255)
CYAN = (29, 211, 224)        # #1DD3E0 - brand accent

# Chevron geometry, normalised to a 0..1 square, taken from icon.svg
# (points 20,7 -> 11,16 -> 20,25 on a 32x32 viewBox, stroke-width 3)
# then recentred and scaled to 0.85 so it clears the circular crop.
BASE = [(20 / 32, 7 / 32), (11 / 32, 16 / 32), (20 / 32, 25 / 32)]
BASE_STROKE = 3 / 32
SCALE = 0.85


def chevron_points():
    xs = [p[0] for p in BASE]
    ys = [p[1] for p in BASE]
    stroke = BASE_STROKE * SCALE
    # centre on the visual bounding box including the round caps
    cx = ((min(xs) - BASE_STROKE / 2) + (max(xs) + BASE_STROKE / 2)) / 2
    cy = ((min(ys) - BASE_STROKE / 2) + (max(ys) + BASE_STROKE / 2)) / 2
    pts = [(0.5 + (x - cx) * SCALE, 0.5 + (y - cy) * SCALE) for x, y in BASE]
    return pts, stroke


def gradient_background(size, top, bottom):
    img = Image.new("RGB", (1, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.NEAREST)


def stroke_polyline(draw, pts, width, colour):
    """Polyline with round joins and round caps (PIL has no stroke-linecap)."""
    draw.line(pts, fill=colour, width=int(round(width)), joint="curve")
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)


def render(size, accent=False):
    n = size * SS
    if accent:
        img = gradient_background(n, NAVY_TOP, NAVY_BOTTOM)
    else:
        img = Image.new("RGB", (n, n), NAVY)
    draw = ImageDraw.Draw(img)

    pts, stroke = chevron_points()
    px = [(x * n, y * n) for x, y in pts]
    width = stroke * n

    if accent:
        # cyan echo of the mark, offset right, sitting behind the white chevron
        offset = 0.085 * n
        stroke_polyline(
            draw,
            [(x + offset, y) for x, y in px],
            width * 0.62,
            CYAN,
        )

    stroke_polyline(draw, px, width, WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for accent in (False, True):
        suffix = "-accent" if accent else ""
        master = render(1000 * SS // SS, accent=accent)
        for px in (1000, 400):
            out = master if px == 1000 else master.resize((px, px), Image.LANCZOS)
            path = os.path.join(OUT_DIR, f"pureproperty-avatar{suffix}-{px}.png")
            out.save(path, "PNG", optimize=True)
            print("wrote", os.path.relpath(path, os.path.join(OUT_DIR, "..", "..")))


if __name__ == "__main__":
    main()
