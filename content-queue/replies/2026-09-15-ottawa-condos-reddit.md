# Reply draft — r/RealEstateCanada, "Anyone looking at condos for sale Ottawa right now?"

**Source:** `content-queue/data/latest.json` — `dataAsOf 2026-09-14T04:02:59.054+00:00`
(nightly `region_metrics` precompute). Snapshot is one day old, inside the 3-day
freshness rule.

**Nothing in this file posts automatically.** This is a draft reply to a thread we did
not start. A human verifies the figure against the live tracker, edits, and posts by hand.

Every figure below is an aggregate, region-level statistic quoted **verbatim** from the
data file. No individual listing, address, or sold price appears. If the number here does
not match the live tracker at posting time, do not post it.

**Founder disclosure (verbatim, required on Reddit):**

> I'm a licensed Ontario realtor and I built PureProperty — a free data tool — because
> the board sits on numbers like this and the consumer sites won't show them.

**Small-sample note:** not needed. The one figure cited rests on n=3,923.

---

## What the thread asks vs. what we hold

The poster asks three things. We can speak to one of them.

| Their question | What we have |
| :--- | :--- |
| "What's actually a good deal anymore?" | Ottawa is a first-class market on the rent-vs-buy, price-cuts, days-on-market, market-temperature, rents, over-asking and price-rankings trackers. Today's citable figure is the 1-bed gross yield. |
| "Condo fees change the whole picture" | We run a condo fee tracker (annualized trend in fee/sqft by neighbourhood, median of building trends). **It is published for Toronto & the GTA, not Ottawa** — `src/app/data/condo-fees/page.tsx` is titled "Toronto & GTA Condo Fee Tracker" and names no Ottawa coverage. |
| "Bad condo board / huge special assessment" | **Nothing.** Reserve fund studies, status certificates and board minutes are not fields in the IDX/VOW feed. No derived metric can reach them. |

So the honest reply leads with the yield figure, then uses the poster's own instinct —
that fees change the picture — to explain why that figure cannot answer their question.
That is a stronger contribution to the thread than a number dressed up as an answer.

---

## Angle — Ottawa 1-bed gross rental yield

- **Figure (verbatim):** `6.9% gross yield` — A 1-bed in Ottawa grosses about 6.9% rental yield
- **Region:** Ottawa · **Sample:** n=3,923
- **Source URL:** https://www.pureproperty.ca/data/rent-vs-buy
- **Why surprising:** Best gross rental yield of the markets tracked today (1-bed).
- **Why it fits this thread:** the tracker's own methodology states the figure excludes
  condo fees, property tax, insurance and maintenance. The poster noticed exactly that
  gap unprompted. Confirming it is worth more standing than the headline number.

### (a) Reddit — reply in-thread

**Body:**

The number I can give you is market-level, and it comes with a catch that's the exact
thing you already spotted.

A 1-bed in Ottawa grosses about **6.9% gross yield** right now — the best of the markets
I track today, across 3,923 listings, refreshed nightly.

The catch: that's a *gross* figure. It's rent over price, and it deliberately excludes
condo fees, property tax, insurance and maintenance. Which means the affordable-looking
unit and the one with the $700 fee produce the same yield number. Your instinct that the
fee changes the whole picture is right, and it's the reason a gross yield — mine or
anyone else's — can't tell you whether a specific condo is a good deal.

On fees themselves: I do track the annualized trend in maintenance fee per square foot by
neighbourhood, per-sqft because fees scale with unit size and a raw dollar figure isn't
comparable between a 500 and a 900 sqft unit. But I publish that tracker for Toronto and
the GTA, not Ottawa. I'd rather tell you that than hand you a GTA figure with an Ottawa
label on it.

On condo boards and special assessments — I have nothing, and it isn't a gap I can close.
Reserve fund studies and status certificates aren't fields in the MLS feed. That's a
document-reading problem, not a data problem, and anyone showing you a "board health
score" built from listing data is inferring it.

Cross-check me: Rentals.ca and Urbanation publish a monthly rent report that includes
Ottawa, and CMHC's Rental Market Survey covers Ottawa rents and vacancy. What I do
differently is the nightly cadence and pairing rent against sold price per bedroom count,
rather than reporting rent on its own.

I'm a licensed Ontario realtor and I built PureProperty — a free data tool — because the
board sits on numbers like this and the consumer sites won't show them.

Tracker (updated nightly): https://www.pureproperty.ca/data/rent-vs-buy

Genuinely curious, since you asked what people wish they'd known: for anyone who bought an
Ottawa condo recently — did the fee stay where the listing said, or move after closing?
That drift is the thing I'd most like to measure and currently can't.

**Self-score: 84/100** — Leads with the verbatim figure, names the sample, and turns our
own methodology's limitation into the substance of the reply, which suits a sceptical
thread better than a clean number would. Prior art named without punching at anyone.
Loses points because the yield figure is only obliquely related to what was asked — the
reply earns its place by being honest about three gaps, which is a thinner contribution
than a directly on-point statistic would be.

---

## Not drafted, and why

- **X, video, LinkedIn.** This is a reply to someone else's thread, not a daily angle.
  The Ottawa yield figure already runs through the normal daily rotation; drafting it
  again for three more platforms here would duplicate that queue.
- **Any condo-fee figure for Ottawa.** The tracker is GTA-scoped. The weekly refresh
  script (`scripts/admin/refresh-condo-fee-stats.ts`) applies no city filter, so Ottawa
  cohorts *may* exist in `condo_fee_stats` — but this draft was written with egress
  blocked and that could not be verified. Do not link the condo-fees tracker in this
  reply unless you have loaded it and confirmed Ottawa neighbourhoods appear.

## Before posting — operator checklist

1. Confirm `6.9% gross yield` and the 1-bed Ottawa row on
   https://www.pureproperty.ca/data/rent-vs-buy. The figure has drifted 7.2% → 6.9% since
   early August, so it moves.
2. **Do not answer "what would you check before making an offer?"** The thread asks for it
   directly. This post carries a licensed realtor's name, and ROUTINE.md holds the line at
   what the data shows, never what someone should do. The draft deliberately leaves that
   question alone — keep it that way in any edit, and in replies.
3. Confirm the condo-fee tracker is still GTA-only before mentioning Ottawa coverage.
4. The thread is 18h old with 4 upvotes and 2 comments. Low traffic — this is a standing
   play, not a reach play. Post it because it's a straight answer, not for the impressions.
