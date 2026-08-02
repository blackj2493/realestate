"""
Renders the TRUE horizontal lockup -- chevron + PUREPROPERTY.ca on one line,
exactly as in public/logo.svg -- into the two places a 5.7:1 logo can go:

  avatar  1000/400 square, lockup fitted across the circular crop
  banner  1500x500 X/Twitter header, where a horizontal logo actually belongs

Proportions are taken from logo.svg (viewBox 0 0 320 56, text font-size 28):
  chevron stroked bbox  x 2.75..15.25, y 10.75..45.25  -> 0.446em x 1.232em
  gap chevron -> text   26 - 15.25 = 10.75            -> 0.384em
Vertical alignment relies on Liberation Sans' metrics: with line-height normal
the text box centre lands within 0.003em of the cap-height centre, so a plain
`align-items: center` puts the chevron's centre on the cap centre, matching how
logo.svg positions it (chevron centre y=28, cap centre y=27.97).

Usage: python3 scripts/brand/make-horizontal-lockup.py
"""

import os
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "brand")

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCALE = 2

SOLID_BG = ("#0A1828", "none")
ACCENT_BG = ("#060F1C", "linear-gradient(180deg, #11263C 0%, #060F1C 100%)")

# viewBox is cropped to the stroked chevron's exact bbox so the em sizing below
# maps to visible ink rather than to logo.svg's surrounding whitespace.
CHEVRON = (
    '<svg class="mark" viewBox="2.75 10.75 12.5 34.5" xmlns="http://www.w3.org/2000/svg">'
    '<polyline points="14,12 4,28 14,44" fill="none" stroke="#FFFFFF" '
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)

PAGE = """<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; height: 100%%; }
  body {
    width: %(w)dpx; height: %(h)dpx;
    background-color: %(bg_solid)s;
    background-image: %(bg_image)s;
    font-family: 'Liberation Sans', Arial, Helvetica, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex; align-items: center; justify-content: center;
  }
  .lockup { display: flex; align-items: center; font-size: 100px; }
  .mark { display: block; width: 0.4464em; height: 1.2321em; margin-right: 0.3839em; }
  .wm { white-space: nowrap; line-height: normal; }
  .wm .pure { font-weight: 700; color: #FFFFFF; }
  .wm .prop { font-weight: 400; color: #8FA4B8; }
  .wm .ca   { font-weight: 400; color: #6B7E92; }
</style>
<div class="lockup">
  %(chevron)s
  <span class="wm"><span class="pure">PURE</span><span class="prop">PROPERTY</span><span class="ca">.ca</span></span>
</div>
<script>
// binary-search the font-size that makes the whole lockup exactly `target` wide
const target = %(target)f;
const lockup = document.querySelector('.lockup');
let lo = 4, hi = 600;
for (let i = 0; i < 44; i++) {
  const mid = (lo + hi) / 2;
  lockup.style.fontSize = mid + 'px';
  if (lockup.getBoundingClientRect().width < target) lo = mid; else hi = mid;
}
lockup.style.fontSize = lo + 'px';
</script>
"""


def render(w, h, target, accent):
    bg_solid, bg_image = ACCENT_BG if accent else SOLID_BG
    html = PAGE % {
        "w": w, "h": h, "bg_solid": bg_solid, "bg_image": bg_image,
        "chevron": CHEVRON, "target": target,
    }
    with tempfile.TemporaryDirectory() as tmp:
        page, shot = os.path.join(tmp, "p.html"), os.path.join(tmp, "s.png")
        with open(page, "w") as fh:
            fh.write(html)
        subprocess.run(
            [CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
             f"--force-device-scale-factor={SCALE}", f"--window-size={w},{h}",
             f"--screenshot={shot}", f"file://{page}"],
            check=True, capture_output=True,
        )
        return Image.open(shot).convert("RGB").resize((w * SCALE, h * SCALE), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for accent in (False, True):
        suffix = "-accent" if accent else ""

        # Square avatar: one line across the circle. 0.86 of the width keeps the
        # ends inside the crop given the lockup's ~1.23em height.
        master = render(1000, 1000, 0.86 * 1000, accent)
        for px in (1000, 400):
            name = f"pureproperty-avatar-inline{suffix}-{px}.png"
            master.resize((px, px), Image.LANCZOS).save(
                os.path.join(OUT_DIR, name), "PNG", optimize=True)
            print("wrote public/brand/" + name)

        # X/Twitter header. Centred, so the avatar overlapping the lower-left
        # corner of the profile page never covers it.
        banner = render(1500, 500, 720, accent)
        name = f"pureproperty-x-banner{suffix}-1500x500.png"
        banner.resize((1500, 500), Image.LANCZOS).save(
            os.path.join(OUT_DIR, name), "PNG", optimize=True)
        print("wrote public/brand/" + name)


if __name__ == "__main__":
    main()
