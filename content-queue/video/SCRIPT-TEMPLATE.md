# Video script — format

One file per video, in `content-queue/video/scripts/<subject>.md`. Subject is the
`featureRegistry.ts` id for a product feature, or `data-<tracker>` for a tracker, so a
script, a scene and a catalogue row all name the same thing.

The point of the format is that a finished script can be recorded without a single
judgement call. If the person holding the camera-less recorder has to decide anything —
which listing, which filter, what to say over beat 3 — the script is not finished.

Read `content-queue/ROUTINE.md` `## Video (9:16)` first. The walls live there; this
file is only the shape.

---

## Header

```
Subject:      <registry id | data-tracker>
Lane:         A (aggregate) | B (synthetic PPDEMO)
Route:        <path to open>
Setup:        <exact command, or "none — public page">
Runtime:      <target seconds, 35–45>
Beats better: <the one dimension this beats HouseSigma/realtor.ca on — CLAUDE.md §10>
```

`Beats better` is filled in before the hook is written. If it cannot be filled in
honestly, the video is not worth the slot and the script stops here.

## Hook (0–3s)

One line of voiceover and one line of on-screen text. The result first — a number, a
grade, a contradiction. Never "in this video I'll show you". The first frame is
already inside the product or the tracker; there is no title card at the front.

## Shot list

A table, one row per beat, in recording order. Every cell filled.

| # | t | Cursor action | On-screen text | Voiceover |
| :-- | :-- | :--- | :--- | :--- |

- **Cursor action** is literal: which element, which direction, what changes as a
  result. "Drag the down-payment slider from 20% to 35%", not "adjust assumptions".
- **On-screen text** is the burned-in caption for that beat — short, and never a
  transcript of the voiceover. It carries the frame for a muted viewer.
- **Voiceover** is the exact line. Written to be read aloud: short sentences, no
  parenthetical clauses, no symbols the voice will mispronounce (write "per cent",
  "square feet", "dollars").

## Disclosure card

Its own beat, at least 2 seconds, nothing else on screen, read aloud verbatim:

> I'm a licensed Ontario realtor and I built PureProperty — a free data tool — because
> the board sits on numbers like this and the consumer sites won't show them.

## Close card

One line naming the one thing to do next, plus the URL. No "like and subscribe".

## Watermark

`pureproperty.ca` bottom-right, small, the entire runtime. A re-uploaded clip carries
no link, so the watermark is what still points home.

## Captions per platform

- **YouTube Shorts** — title (under 60 chars) and a two-line description ending in the
  URL.
- **Instagram Reels** — caption, two to four short lines, URL in the profile link
  (Instagram strips in-caption links), so name the tracker by path in words.
- **TikTok** — caption, one or two lines. Same figure, same caveat.

Every platform carries the figure and its caveat. A caveat dropped for length is the
one edit that turns a sceptic into a critic.

## Pre-publish check

A short list the operator ticks before uploading. Always includes:

- [ ] No real listing in any frame — no pin, row, address or price (Lane B: the URL
      in frame reads `PPDEMO*`).
- [ ] Figure matches `content-queue/data/latest.json` verbatim (Lane A).
- [ ] Sample size stated on screen where n is below about 25.
- [ ] Disclosure card present, held, and read.
- [ ] Watermark present for the full runtime.
- [ ] Captions burned in, not platform auto-captions.

## Self-score

Out of 100 with one line of reasoning, same as the written drafts.
