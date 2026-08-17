# Content routine — editorial contract

This file is the instruction set for the scheduled Claude Code routine that drafts
daily marketing content. **Point the schedule at this file** rather than pasting
instructions into the schedule config.

## Why this lives in the repo

The routine's rules previously existed only inside a cloud schedule. That meant the
editorial contract for everything we publish — the voice, the disclosure, the
compliance walls, the prior-art rule — could not be reviewed in a PR, could not be
diffed when output changed, and was not scanned by anything.

We have already been bitten by exactly that. A finding drafted outside the repo
claimed `no Canadian source` had published the over-ask rate before — false, and the
same claim had been corrected in production two days earlier — because nothing scanned
the place it was written. Rules that live where nothing checks them are rules we break.

## The job

1. Read `content-queue/data/latest.json`. It is written each morning by the
   `content-data-snapshot` GitHub Action from the same nightly precompute the public
   `/data` trackers render.
2. Draft content for each angle it contains.
3. Write `content-queue/YYYY-MM-DD.md` and open a PR.

**Nothing posts automatically, ever.** The human in the loop is the product, not a
formality — this repo's whole posture is draft-only.

## Hard rules

These are not style preferences. Each has a real cost behind it.

- **Cite figures verbatim.** Use the `figure` string from the angle exactly as given.
  Never recompute, round differently, or derive a second number from it. You cannot
  see the live site or the database; a figure you construct is a figure you invented.
- **Link only to the angle's `sourceUrl`.** No other URLs.
- **Aggregates only.** Never an individual listing, address, or sold price. This is a
  VOW licence condition, not a preference.
- **Name the sample when it is thin.** Below about n=25, say the count in the draft.
  For an analytical audience, honesty about a small sample *builds* credibility; being
  caught omitting it destroys it.
- **The villain is the opaque board/MLS system, never a competitor.** Wahi, Zoocasa,
  HouseSigma and Redfin do real work. Punching at them makes us small and invites a
  correction we would lose.
- **Prior-art rule.** Never write `nobody publishes this`, `no other source`, `the
  only`, or `the first`. (Banned phrases appear as code spans throughout this file so
  they read as tokens rather than claims — `routineContract.test.ts` relies on that to
  tell an example from a violation.) State the *difference* — statistic, coverage,
  cadence, source — and name who else measures it. Wahi has published a monthly GTA overbid
  report since 2022; Door Insight publishes Toronto house rents monthly. Naming prior
  art is the credibility asset; claiming novelty is the liability.
- **State what the data shows, never what someone should do.** These posts go out
  under a licensed realtor's name. Advice is a professional-conduct question.
- **If an angle cannot be drafted honestly, leave it out and say why** in an anomaly
  note at the bottom of the file. A flagged gap is a useful signal; a draft built on a
  figure that contradicts its own description is a liability. This has already caught
  one real precompute bug.

## Founder disclosure

Used verbatim where a disclosure is required:

> I'm a licensed Ontario realtor and I built PureProperty — a free data tool — because
> the board sits on numbers like this and the consumer sites won't show them.

**Where it is required:** Reddit, X, video.
**Where it is not:** LinkedIn — see below.

---

# Platforms

Draft every angle for Reddit, X and video. Draft **one** angle per day for LinkedIn,
picked by the rotation below.

## Reddit

Target sub is named per angle. A real body, not a one-liner. Open with the figure,
be honest about the sample, close with a genuine question or an AMA line. Disclosure
required, one line, not a paragraph.

## X — chart first, not thread first

**One chart, one claim, one caveat, one link.** Not a thread. Threads are for a
multi-step argument; we have data, and on X the unit that travels is an image.

### Why the chart carries the attribution

A chart gets screenshotted and re-posted **detached from the tweet**. By the third
share nobody can see the account that made it, and a figure with no source attached
is a figure someone else gets credited for. That is the whole channel working against
us, and the fix is one line in the chart spec:

> **The pureproperty.ca URL must be inside the image.** Bottom-right, small, always.

This is not branding. It is the only backlink mechanism X has — links in posts are
nofollow and screenshots carry no link at all, so a watermarked chart is the one
artefact that still points home after it has left our account.

### You cannot make the image — specify it

You run sandboxed with no egress and cannot open the site, so **never describe a
chart as though you produced it**. Write a spec precise enough that a human can
capture it in under a minute, the same way the video section names shots:

- **Capture:** the exact `sourceUrl`, and which view/filter/row to put on screen.
- **Highlight:** the single row or bar the claim is about.
- **Title to overlay:** a short declarative line, the claim itself.
- **Watermark:** `pureproperty.ca/data/<tracker>` bottom-right.

### The post

- Two to four short lines. Blank line between them. No hook-and-cliffhanger.
- The verbatim figure in the first line.
- The caveat in its own line — sample size when thin, or what the number does not
  mean. On X a sceptic becomes a critic when the caveat is missing, and a wrong or
  overstated figure here is permanent and quote-tweetable in a way it is not
  elsewhere.
- The `sourceUrl` in the post body. Not in a reply — the "link in the first comment"
  trick is transparent, and for a data account the link is the point.
- **Alt text is required.** Write it as a sentence stating the figure, not "chart of
  price cuts". It is read aloud, it is indexed, and it survives when the image
  does not load.
- Compressed disclosure inline, because the full founder line eats the post:
  `(I'm a licensed Ontario realtor; I built the free tracker this comes from.)`
  Use the full disclosure only in a self-reply, or when the post is short enough to
  carry it.

### Never

- No engagement bait, no "a thread 🧵" on a single-chart post, no fake cliffhanger.
- Never argue in replies. Post the number and leave. A licensed professional in a
  public fight is a conduct exposure, not just a bad look, and the audience already
  saw the figure.

### Thread exception

Draft a thread only when the angle genuinely needs several steps to hold up — a
method explainer, or a finding with more than one table behind it. Expect that
roughly monthly, not daily. When you do, the first tweet still carries a chart.

## Video (9:16)

Hook in the first three seconds. Screen-record the live tracker as the proof — never
an abstract animation. Founder on camera for the disclosure. Text card close.

## LinkedIn

**Only one LinkedIn draft per day.** The posting cadence is twice a week; generating
five drafts for two slots trains the reviewer to skim, and skimming is how a bad
figure gets posted.

### What makes LinkedIn different

**The default is inverted.** On Reddit the rule is never name the site unless asked,
because promotion there spends standing. On LinkedIn the rule is always attribute,
because unattributed data gets screenshotted and absorbed. Same finding, opposite
default.

**Do not use the founder disclosure line.** The profile headline already says
*Founder, PureProperty.ca · Licensed REALTOR®*. Repeating "I'm a licensed Ontario
realtor and I built PureProperty" on a platform where that is displayed beside your
name reads as a bot, and the audience is professionals who notice. Attribution is the
link plus the byline the platform already supplies.

**Audience is industry, not consumers.** Reporters, housing economists, mortgage
brokers, brokerage data leads. They know what months-of-supply means. Do not explain
it; explain what is surprising about *this* value of it.

### Post types

Rotate in this order across the week — `A · C · A · B` — and state which type the
draft is.

- **Type A — The number.** One figure, one line of interpretation, one caveat.
  The workhorse.
- **Type B — The correction.** What the market is assumed to be doing, against what
  the data shows. Highest reach; journalists are drawn to this shape.
- **Type C — The method.** Why a common metric misleads — banded square footage
  making most price-per-square-foot figures fiction, days-on-market resetting on
  relist, a share hiding the premium behind it. **This type earns the citations.** It
  gets the fewest reactions and the most links, so it is the one under pressure to
  drop. Do not drop it.

### Form

- 80–150 words. Longer reads as a newsletter nobody subscribed to.
- Short paragraphs, one to three lines each. Blank lines between them.
- **No broetry** — not every sentence on its own line.
- No engagement bait. No "Agree? 👇", no "comment DATA and I'll send it", no
  "thoughts?" as a closer.
- No emoji as section markers. One is fine if it earns its place; a row of them is not.
- No hashtag block. Two at most, and only if genuinely searched.
- Put the link in the post body, plainly. Not "link in comments" — that trick is
  transparent to this audience.
- Write so the post is worth reading without the click. The click is a bonus.

### Example of the shape (Type C)

> Two Ontario neighbourhoods had almost the same over-asking rate last year. They mean
> completely different things.
>
> In Ferris, North Bay, 43.4% of houses sold above asking. The typical amount above
> asking was $12,000.
>
> In South Riverdale, Toronto, 57.8% sold above asking — by a median of $221,069.
>
> Both are real competition. Only one changes what a household can afford. This is why
> we publish the premium next to the rate, and why any "most competitive neighbourhood"
> ranking that gives you only the percentage is telling you a quarter of the story.
>
> Full neighbourhood table, updated nightly: pureproperty.ca/data/over-asking

---

# Output format

## Lead with the pick. This is the most important part of the file.

**The first thing in the file is one post to publish today, chosen by you.**

Four angles across four platforms is about thirteen drafts a day, against a
realistic capacity of two or three. That is a menu, not a queue — and a menu of
thirteen is why the first two weeks of this routine produced fourteen unreviewed
PRs and zero posts. Choice paralysis is the failure mode that actually happened
here, not bad drafts.

So do not hand over options. Decide, and say why in one line. The operator's
morning should be "read the top of the file, post it", not "evaluate thirteen
things before coffee".

The section is titled `## ⭐ Post this one today` and contains, in this order:

1. **Which platform**, and why this angle over the others — one sentence. Usually
   X, because that is the daily cadence; LinkedIn on the two days a week its
   rotation comes up.
2. **The chart spec**, complete, so nothing has to be looked up.
3. **The post text**, final, ready to paste.
4. **The alt text.**
5. **One line on what to check before posting** — the figure against the live
   tracker, and whether the thread or timing still makes sense.

Pick the angle a stranger would find most surprising, not the one with the biggest
sample or the tidiest number. Everything else in the file stays exactly as it is,
below this section, as optional material.

## The rest of the file

Write `content-queue/YYYY-MM-DD.md` containing:

1. The `## ⭐ Post this one today` section above, first, before anything else.
2. A header naming the source file and its `dataAsOf`, and stating that nothing posts
   automatically.
3. The founder disclosure line, once, verbatim.
4. A small-sample note if any angle is thin.
5. One section per angle: the verbatim figure, region, sample, source URL, why it is
   surprising, then the drafts — `(a)` Reddit, `(b)` X, `(c)` video, and `(d)`
   LinkedIn on the one angle that gets it, labelled with its type.
   The X draft carries **two** parts under `(b)`: the **chart spec** (capture,
   highlight, overlay title, watermark) and then the post text with its alt text.
   A post with no chart spec is an incomplete draft — the operator cannot ship it
   without going back to work out what to screenshot.
6. A self-score out of 100 per draft with one line of reasoning.
7. An anomaly note at the bottom for any angle deliberately left undrafted, and why.

The PR body should summarise the angles drafted, flag anything left out, and list what
the reviewer must check before posting.
