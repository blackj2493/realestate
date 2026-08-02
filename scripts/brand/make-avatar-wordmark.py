"""
Generates square profile-picture PNGs of the FULL PureProperty.ca lockup
(chevron + PUREPROPERTY.ca wordmark), rendered via headless Chromium so the
typography matches the site header.

Twitter/X crops avatars to a circle inscribed in the square, so the lockup is
laid out inside a circular safe zone rather than a square one.

Layouts:
  stacked  - chevron above, PURE over PROPERTY.ca (mark-led)
  header   - "< PURE" on one line over PROPERTY.ca (mirrors the site header)

Usage: python3 scripts/brand/make-avatar-wordmark.py
Output: public/brand/pureproperty-wordmark-<layout>[-accent]-{1000,400}.png
"""

import os
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "brand")

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
RENDER = 1000          # CSS px canvas
SCALE = 2              # device scale factor -> 2000px master

# (solid fallback, gradient image). The solid colour matters: the gradient only
# paints the body box, and the screenshot canvas can be a hair taller, which
# leaves a black strip along the bottom edge without it.
SOLID_BG = ("#0A1828", "none")
ACCENT_BG = ("#060F1C", "linear-gradient(180deg, #11263C 0%, #060F1C 100%)")

# Widest line, as a fraction of the canvas. The circular crop leaves a chord of
# 2*sqrt(500^2 - dy^2) px at vertical offset dy; 0.70 keeps the wordmark clear
# of the crop even on the outermost line.
TARGET_W = 0.70

# viewBox is 0 0 30 48, not the 32 of favicon.svg: the stroked mark spans
# x = 3.5..26.5, so a 30-wide box puts its optical centre on the box centre.
CHEVRON = (
    '<svg viewBox="0 0 30 48" xmlns="http://www.w3.org/2000/svg">'
    '<polyline points="24,4 6,24 24,44" fill="none" stroke="#FFFFFF" '
    'stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)

# Auto-fit: size PROPERTY.ca to the target width, then letter-space PURE so its
# row -- including an inline chevron, if the layout has one -- matches. The
# negative marginRight cancels the trailing letter-space so the glyphs, not the
# box, end up centred.
FIT_JS = """
const target = %(target)f * %(render)d;
const prop = document.querySelector('.prop');
const pure = document.querySelector('.pure');

// binary-search the font-size that makes PROPERTY.ca exactly `target` wide
let lo = 10, hi = 400;
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2;
  prop.style.fontSize = mid + 'px';
  if (prop.getBoundingClientRect().width < target) lo = mid; else hi = mid;
}
prop.style.fontSize = lo + 'px';

// reserve room for a chevron sharing PURE's row (the `header` layout)
let reserved = 0;
const inlineMark = pure.parentElement.querySelector('svg');
if (inlineMark) {
  reserved = inlineMark.getBoundingClientRect().width
           + parseFloat(getComputedStyle(inlineMark).marginRight);
}

pure.style.letterSpacing = '0px';
pure.style.marginRight = '0px';
const base = pure.getBoundingClientRect().width;
const gaps = pure.textContent.length - 1;
const ls = (target - reserved - base) / gaps;
pure.style.letterSpacing = ls + 'px';
pure.style.marginRight = (-ls) + 'px';
"""

PAGE = """<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; height: 100%%; }
  body {
    width: %(render)dpx; height: %(render)dpx;
    background-color: %(bg_solid)s;
    background-image: %(bg_image)s;
    font-family: 'Liberation Sans', Arial, Helvetica, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .lockup { display: flex; flex-direction: column; align-items: center; }
  .row { display: flex; align-items: center; justify-content: center; }
  svg { display: block; }
  .pure {
    display: inline-block; white-space: nowrap;
    font-size: %(pure_size)dpx; font-weight: 700; color: #FFFFFF; line-height: 1;
  }
  .prop {
    display: inline-block; white-space: nowrap;
    font-weight: 400; color: #8FA4B8; line-height: 1;
  }
  .prop .ca { color: #6B7E92; }
  %(layout_css)s
</style>
<div class="lockup">%(body)s</div>
<script>%(js)s</script>
"""

LAYOUTS = {
    # chevron above a two-line wordmark
    "stacked": {
        "pure_size": 168,
        "body": (
            '<div class="row mark">' + CHEVRON + "</div>"
            '<div class="row"><span class="pure">PURE</span></div>'
            '<div class="row"><span class="prop">PROPERTY<span class="ca">.ca</span></span></div>'
        ),
        "css": """
          .mark svg { width: 150px; }
          .mark { margin-bottom: 54px; }
          .row + .row { margin-top: 26px; }
        """,
    },
    # chevron inline before PURE, mirroring the site header lockup
    "header": {
        "pure_size": 150,
        "body": (
            '<div class="row">' + CHEVRON
            + '<span class="pure">PURE</span></div>'
            '<div class="row"><span class="prop">PROPERTY<span class="ca">.ca</span></span></div>'
        ),
        "css": """
          svg { width: 96px; margin-right: 44px; }
          .row + .row { margin-top: 38px; }
        """,
    },
}


def render(layout, accent):
    spec = LAYOUTS[layout]
    bg_solid, bg_image = ACCENT_BG if accent else SOLID_BG
    html = PAGE % {
        "render": RENDER,
        "bg_solid": bg_solid,
        "bg_image": bg_image,
        "pure_size": spec["pure_size"],
        "layout_css": spec["css"],
        "body": spec["body"],
        "js": FIT_JS % {"target": TARGET_W, "render": RENDER},
    }
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "page.html")
        shot = os.path.join(tmp, "shot.png")
        with open(page, "w") as fh:
            fh.write(html)
        subprocess.run(
            [
                CHROME, "--headless", "--disable-gpu", "--no-sandbox",
                "--hide-scrollbars", "--default-background-color=00000000",
                f"--force-device-scale-factor={SCALE}",
                f"--window-size={RENDER},{RENDER}",
                f"--screenshot={shot}", f"file://{page}",
            ],
            check=True, capture_output=True,
        )
        return Image.open(shot).convert("RGB")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for layout in LAYOUTS:
        for accent in (False, True):
            master = render(layout, accent)
            suffix = "-accent" if accent else ""
            for px in (1000, 400):
                out = master.resize((px, px), Image.LANCZOS)
                name = f"pureproperty-wordmark-{layout}{suffix}-{px}.png"
                out.save(os.path.join(OUT_DIR, name), "PNG", optimize=True)
                print("wrote public/brand/" + name)


if __name__ == "__main__":
    main()
