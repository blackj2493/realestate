# listing-deal-score — "A letter grade on the asking price"

```
Subject:      listing-deal-score
Lane:         B (synthetic PPDEMO)
Route:        /properties/PPDEMO001
Setup:        npm run demo:fixture -- <RealListingKey> --id=PPDEMO001
              DEMO_FIXTURES=1 npm run dev   →   record against localhost only
Runtime:      40s
Beats better: Neither portal grades the asking price at all. They show the price and
              leave the judgement to you; this states a position and shows its working.
```

Recorder note: the `listing-unlocked` scene already drives this page top-to-bottom at
1600×900. For social, set `viewport: { width: 1080, height: 1920 }` on a 9:16 variant
scene — `Scene.viewport` is already per-scene overridable (`scripts/demos/lib/types.ts`).
Do not record this against anything but localhost; the scene throws if you try.

## Hook (0–3s)

- **VO:** "This house is asking one-point-two million. The terminal grades that a C."
- **Text:** `It grades the asking price.`

Open already scrolled to the Deal Score card. No title card.

## Shot list

| # | t | Cursor action | On-screen text | Voiceover |
| :-- | :-- | :--- | :--- | :--- |
| 1 | 0–3s | Rest on the Deal Score grade, card already in frame | `It grades the asking price.` | "This house is asking one-point-two million. The terminal grades that a C." |
| 2 | 3–9s | Hover the grade so the breakdown expands | `A to D. Comps + fundamentals.` | "A to D, scored against the comparable sales and the fundamentals underneath them." |
| 3 | 9–17s | Move down the breakdown rows, pausing on the comps row | `Every input is shown.` | "It isn't a black box. Every input that moved the grade is listed, with the weight it carried." |
| 4 | 17–24s | Pause on the fundamentals row | `Price vs. what it earns.` | "The fundamentals row is the one most listings fail. It asks what the property earns against what it costs." |
| 5 | 24–30s | Scroll up a little to show grade and breakdown together | `A C is not a no.` | "A C isn't a reason to walk. It's a number to negotiate against, and now you have one." |
| 6 | 30–35s | Static — disclosure card | *(disclosure, full screen)* | *(read verbatim, see below)* |
| 7 | 35–40s | Static — close card | `Every listing. Free. pureproperty.ca` | "Every listing on the site carries one. It's free." |

**Every figure and address on screen is synthetic** — the fixture generator scales all
dollar figures, shifts all dates and replaces the identity, and refuses to write if a
source token survives.

## Disclosure card

> I'm a licensed Ontario realtor and I built PureProperty — a free data tool — because
> the board sits on numbers like this and the consumer sites won't show them.

## Close card

`Every listing carries a Deal Score. Free. → pureproperty.ca`

## Captions

**YouTube Shorts**
Title: `We grade the asking price A to D`
Desc: `Deal Score reads the comps and the fundamentals and takes a position on whether the asking price holds up. Free, on every listing — pureproperty.ca`

**Instagram Reels**
```
Every listing gets a letter grade on its asking price.

A to D, scored against the comps and the fundamentals, with every input shown.

Free at pureproperty.ca (link in bio)

I'm a licensed Ontario realtor and I built it.
```

**TikTok**
```
A letter grade on the asking price — comps + fundamentals, every input shown. Free.
(I'm a licensed Ontario realtor; I built the tool.)
```

## Pre-publish check

- [ ] URL bar in frame reads `PPDEMO001` — if it reads a real listing key, the take is unusable
- [ ] Recorded against `localhost`, never prod
- [ ] No real listing in any frame
- [ ] Disclosure card present, held ≥2s, and read
- [ ] Watermark present for the full runtime
- [ ] Captions burned in, not platform auto-captions

## Self-score

**82** — the hook is a concrete number and a verdict in one line, and the "a C is not a
no" beat gives the viewer something to do with it. Loses points because beat 3 is the
hardest to shoot legibly at 9:16; if the breakdown rows do not read at phone size, cut
beat 4 and hold on beat 3 for longer.
