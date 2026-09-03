# Feature video series — inventory and plan

The problem this addresses: the terminal has 28 catalogued features and nine public
trackers, and a user who does not find a feature is a user for whom it does not exist.
The in-app half of that problem already has an answer — `src/lib/discovery/featureRegistry.ts`
backs the Feature Guide, the What's-New badge and the spotlights. This file is the
outbound half: one short vertical video per feature, posted to YouTube, Instagram and
TikTok.

Format is **faceless** — screen recording plus synthetic voiceover, no founder on
camera. The spec lives in `content-queue/ROUTINE.md` under `## Video (9:16)`; the
per-video format lives in `SCRIPT-TEMPLATE.md` next to this file.

---

## Read this before filming anything

Both feed agreements bar putting listing data into a social post. This is not a
grey area and it is not a display-formatting rule.

- **IDX §6.2(a)** — the subscriber shall not use the IDX System or any part of it
  "in connection with any website (other than display on Subscriber Website),
  wireless device, other electronic or digital devices, or any other means, or
  internet posting, advertising, unsolicited products or services, promotional
  material or any other display, distribution, publication or republication to the
  public or any group or third party".
- **VOW §6.2(a)** — same sentence, with "other than display on Member's VOW(s)",
  and it names AI explicitly: this "includes using an AI System to produce any
  content with such information ... or providing any content retrieved or derived
  from the Services or VOW Data Feed to any AI System for any purpose".
- **VOW §6.2(r)** — shall not "syndicate or redistribute by any means" any
  information transmitted through a VOW Datafeed.

Three consequences, in order of how much they cost us:

**1. The existing clip library cannot be reposted as-is.** `scripts/demos/README.md`
justifies the anon lane as "what an anon user may see (IDX only)". That reasoning is
sound for where those clips currently live — inside the Feature Guide, on our own
site, which is exactly the "display on Subscriber Website" carve-out. It does not
travel. Uploading the same file to YouTube is republication to the public off the
Subscriber Website, and the anon justification has nothing to say about it. Every
clip with a real pin, ledger row, address or price in frame — `rail-draw`,
`terminal-map-modes`, `rail-commute`, `rail-color`, `rail-compare` — must be
re-recorded against synthetic data before it leaves the site.

**2. `listing-unlocked` is already clean.** It drives the synthetic `PPDEMO001`
fixture on a local dev server, and `make-fixture.ts` refuses to write if a source
token survives. Nothing in that frame is MLS data, so it is publishable today. It is
the one product-depth clip that is.

**3. AI touches voice and edit, never data.** Do not upload a recording containing
feed data to an AI editor for auto-cutting or auto-captioning. Do not paste a listing
payload into a script generator. Scripts are hand-written; the synthetic voice reads
them. VOW §6.2(a) names this directly and CLAUDE.md §4 restates it.

The aggregate trackers are unaffected: publishing region-level statistics off-site is
the posture this repo already runs on X and LinkedIn, and video inherits it unchanged
— including "never an individual listing, address, or sold price".

---

## Three lanes

| Lane | What it is | Status |
| :--- | :--- | :--- |
| **A — Aggregate** | The public `/data/*` trackers, `/glossary`, `/data/for-journalists`, tracker embeds. Region-level figures only. | Filmable now |
| **B — Synthetic** | The `PPDEMO001` listing page, served locally with `DEMO_FIXTURES=1`. Covers the whole listing-analysis stack. | Filmable now |
| **C — Blocked** | Anything driven by the live search index: the terminal, dashboard, compare. | Needs the unlock below |

Lane C is blocked for a specific, fixable reason. `src/lib/demo/demoListing.ts`
shadows `ListingDetail` **by listing key** — it substitutes one property's detail
page. The map, the ledger and the dashboard read Typesense, which the fixture system
does not shadow, so there is no way today to drive the terminal with synthetic
inventory.

**The unlock:** a synthetic Typesense collection seeded by the same transform
`make-fixture.ts` already applies (scale every dollar figure, shift every date,
replace every identity), served only when `DEMO_FIXTURES=1` and never on Vercel.
That single piece of work moves sixteen features from blocked to filmable and lets
the existing scenes be re-recorded for social without rewriting them. It is the
highest-leverage engineering item behind this series, and nothing else in Lane C
should be attempted before it lands.

---

## Inventory

Registry ids match `featureRegistry.ts`, so a script, a scene and a catalogue row
all address a feature by the same name.

### Product features (28)

| # | Feature id | Lane | Note |
| :-- | :--- | :-- | :--- |
| 1 | `listing-deal-score` | B | PPDEMO page |
| 2 | `listing-the-read` | B | PPDEMO page |
| 3 | `listing-underwriting` | B | PPDEMO page |
| 4 | `listing-force-appreciation` | B | PPDEMO page |
| 5 | `listing-room-map` | B | PPDEMO page |
| 6 | `listing-condo-stability` | B | Needs a condo fixture — PPDEMO001 is freehold-shaped |
| 7 | `listing-things-to-know` | B | PPDEMO page |
| 8 | `glossary` | A | No feed data on screen |
| 9 | `analytics` | A? | Submarket rankings are aggregate — verify no listing rows render before filming |
| 10 | `avm` | A? | User-entered inputs — verify no comparable records render before filming |
| 11 | `hidden-equity` | A? | Reno ROI — verify no address-level market rows render before filming |
| 12 | `command-palette` | C | Chrome only, but it opens onto the index |
| 13 | `watchlist-alerts` | C | Needs a saved synthetic listing |
| 14 | `terminal-search` | C | |
| 15 | `terminal-filters` | C | |
| 16 | `terminal-rail` | C | |
| 17 | `rail-schools` | C | |
| 18 | `rail-commute` | C | Clip exists, in-app only |
| 19 | `rail-draw` | C | Clip exists, in-app only |
| 20 | `rail-color` | C | Clip exists, in-app only |
| 21 | `rail-timeline` | C | |
| 22 | `rail-compare` | C | Clip exists, in-app only |
| 23 | `rail-saved` | C | |
| 24 | `terminal-map-modes` | C | Clip exists, in-app only |
| 25 | `terminal-quicklook` | C | |
| 26 | `dashboard-persona` | C | |
| 27 | `dashboard-action-feed` | C | |
| 28 | `dashboard-config` | C | |

The three marked `A?` are the cheapest wins available: if those pages render nothing
below the region level, they are filmable this week without any engineering. Check
before writing their scripts, not after.

### Trackers (9) — all Lane A

`price-cuts` · `days-on-market` · `market-temperature` · `over-asking` ·
`rent-vs-buy` · `rents` · `condo-fees` · `price-rankings` · `findings`

Each is one video. The figure comes verbatim from `content-queue/data/latest.json`,
under the same rule the X charts follow — the snapshot is the source, and a figure
constructed at edit time is a figure invented at edit time.

---

## Launch order

Twelve videos, alternating product and data so the account does not read as only one
thing. Everything here is Lane A or B — no blocked feature appears.

| Slot | Subject | Lane | Why here |
| :-- | :--- | :-- | :--- |
| 1 | `listing-deal-score` | B | An A–D grade on a price is the fastest idea to land in three seconds |
| 2 | `price-cuts` tracker | A | A share of listings cutting price is the figure people argue about |
| 3 | `listing-underwriting` | B | Sliders moving a yield number is the most watchable thing we have |
| 4 | `days-on-market` tracker | A | Sets up the relist-reset method point |
| 5 | `listing-force-appreciation` | B | Renovation ROI, ranked — carries the Flipper persona |
| 6 | `market-temperature` tracker | A | Months of supply, the metric this audience already speaks |
| 7 | `listing-things-to-know` | B | Suite potential is the Smart Homebuyer hook |
| 8 | `over-asking` tracker | A | Rate next to premium — the method distinction, not just the number |
| 9 | `listing-room-map` | B | A drawn-to-scale plan is visual with no narration needed |
| 10 | `rent-vs-buy` tracker | A | Broadest audience of the nine |
| 11 | `glossary` | A | Positions the whole catalogue as readable, not gatekept |
| 12 | `condo-fees` tracker | A | Closes the run on the metric buyers discover too late |

At two posts a week that is six weeks. The Lane C unlock, if it lands during that
window, supplies the next sixteen without a gap.

## What each video must beat

CLAUDE.md §10 applies to a video the same as to a component: it has to be better than
what HouseSigma or realtor.ca show on at least one dimension. For this series the
dimension is usually *the metric exists at all* (True DOM, Deal Score, force-appreciation
ROI, condo-fee stability) or *the method is shown* (why banded square footage makes most
price-per-square-foot figures fiction). A video that shows a feature both sites also have,
looking about the same, is not worth the slot. Name the dimension in the script header
before writing the hook.
