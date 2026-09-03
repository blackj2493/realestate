# listing-underwriting — "Move the down payment, watch the yield move"

```
Subject:      listing-underwriting
Lane:         B (synthetic PPDEMO)
Route:        /properties/PPDEMO001
Setup:        npm run demo:fixture -- <RealListingKey> --id=PPDEMO001
              DEMO_FIXTURES=1 npm run dev   →   record against localhost only
Runtime:      42s
Beats better: The calculator is live and attached to the listing. Portal mortgage
              widgets return a monthly payment; this recalculates cash flow and yield
              against the property's own numbers as you drag.
```

Recorder note: `scripts/demos/scenes/listingUnlocked.ts` already scrolls to
`[data-tour="listing-underwriting"]` and holds. This script needs the sliders actually
dragged, so add `human.moveTo` → mouse-down → eased drag → mouse-up on the down-payment
control, and let the figures settle before cutting. Record at
`viewport: { width: 1080, height: 1920 }`.

## Hook (0–3s)

- **VO:** "Watch the yield move while I drag the down payment."
- **Text:** `Drag it. The numbers follow.`

Open with the calculator already in frame and the cursor on the slider handle.

## Shot list

| # | t | Cursor action | On-screen text | Voiceover |
| :-- | :-- | :--- | :--- | :--- |
| 1 | 0–3s | Cursor resting on the down-payment slider handle | `Drag it. The numbers follow.` | "Watch the yield move while I drag the down payment." |
| 2 | 3–11s | Drag down payment 20% → 35%, slowly; hold at the end | `20% → 35%` | "Twenty per cent to thirty-five. Cash flow crosses into positive, and the return on the cash you actually put in drops. Both are true at once." |
| 3 | 11–19s | Drag the rate slider up two steps, hold | `Rate up. Same house.` | "Now the rate. Same house, same asking price — this is the part a listing page normally hides from you." |
| 4 | 19–27s | Move to the carry / monthly figure and hold | `What it costs to hold` | "And the carry. What this costs you every month to own, before anything comes back." |
| 5 | 27–33s | Drag down payment back to 20%, let everything settle | `Your assumptions, not ours` | "Nothing here is a default I picked for you. It's your money, your rate, your numbers." |
| 6 | 33–38s | Static — disclosure card | *(disclosure, full screen)* | *(read verbatim, see below)* |
| 7 | 38–42s | Static — close card | `On every listing. pureproperty.ca` | "It's on every listing on the site." |

**Every figure and address on screen is synthetic.** The fixture generator scales all
dollar figures, shifts all dates and replaces the identity, and refuses to write if a
source token survives. Beat 3 must not name a real rate as a recommendation — it is a
slider position, and the voiceover says so.

## Disclosure card

> I'm a licensed Ontario realtor and I built PureProperty — a free data tool — because
> the board sits on numbers like this and the consumer sites won't show them.

## Close card

`Live underwriting on every listing → pureproperty.ca`

## Captions

**YouTube Shorts**
Title: `Drag the down payment, watch the yield move`
Desc: `A live underwriting sandbox attached to the listing — down payment, rate and carry, recalculating against the property's own numbers. Free — pureproperty.ca`

**Instagram Reels**
```
Drag the down payment. The yield moves.

Cash flow goes positive and return on cash goes down — both true at once, which is the
part a mortgage widget never shows you.

Your rate, your assumptions. On every listing.

pureproperty.ca (link in bio)

I'm a licensed Ontario realtor and I built it.
```

**TikTok**
```
Live underwriting on the listing page — drag the down payment and the rate, watch cash flow and yield move. Free.
(I'm a licensed Ontario realtor; I built the tool.)
```

## Pre-publish check

- [ ] URL bar in frame reads `PPDEMO001`
- [ ] Recorded against `localhost`, never prod
- [ ] No real listing in any frame
- [ ] Figures settle before each cut — a mid-recalculation frame reads as a bug
- [ ] No advice: the voiceover describes what the sliders do, never what to buy or borrow
- [ ] Disclosure card present, held ≥2s, and read
- [ ] Watermark present for the full runtime
- [ ] Captions burned in, not platform auto-captions

## Self-score

**86** — the strongest of the three. The motion is the message, it needs no figure that
can go stale, and beat 2's "both are true at once" is the kind of thing an analytical
viewer stops scrolling for. Main risk is legibility: if the numbers do not read at
phone size, zoom the viewport rather than cutting beats.
