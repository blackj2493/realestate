# Data-Attribution Outreach Playbook (Backlinks via /data trackers)

**Goal:** get journalists, creators, finance sites, academics and orgs to cite or embed
PureProperty's `/data` trackers with attribution → editorial backlinks → SEO authority.

> ## ⛔ Prior-art gate — read before writing any pitch
>
> **Search the claim before you build the metric, not after.** Never write "nobody
> publishes this", "no other source", "the only", "the first", or "exclusive".
>
> A 2026-08-14 sweep tested every angle here and found each one already published:
> relist-adjusted DOM is TRREB's PDOM (monthly since 2020); power-of-sale counts are
> Valery Real Estate's, run by Better Dwelling; active-listing age is published by WOWA
> and Zolo; the over-ask rate has been Wahi's monthly GTA series since 2022. This is
> structural — a dozen brokerages mine the same feed. **Stop hunting for a scoop; sell
> the service.** Naming prior art is the credibility asset; claiming novelty is the
> liability, and two false novelty claims reached production before this rule existed.

**Assets we pitch** (all live, nightly-updated, embeddable via `/embed/<slug>`).
Prior-art verdicts from the 2026-08-15 eight-tracker sweep:

| Tracker | URL | Hook | Prior art |
|---|---|---|---|
| Condo Fee Tracker | /data/condo-fees | Measured, dated fee series by area | **OPEN** — only rules-of-thumb ranges exist ($0.55–1.00/sqft, realtor blogs + WOWA). Strongest single asset. |
| Over-Asking | /data/over-asking | Share of homes beating their **own** ask, plus the median premium | **Open outside the GTA.** Wahi owns the GTA with 297 hoods; we cover 1,156 Ontario hoods. |
| Rent Tracker | /data/rents | Closed freehold/house rents | **Open outside Toronto.** Door Insight and LandLord own Toronto. |
| Price-Cut Tracker | /data/price-cuts | Share cutting, and by how much | **Partly covered** — a CREA-derived "~30%" is circulating. Cut *magnitude* is still open. |
| Days-on-Market | /data/days-on-market | Active-inventory age, relist-stitched | **Commodity.** TRREB PDOM, WOWA, Zolo. Pitch the population difference, not the number. |
| Market Price Rankings | /data/price-rankings | Cheapest/most expensive listicle fodder | **Commodity.** |
| Market Temperature | /data/market-temperature | Buyer/seller signal per region | **Commodity.** |
| Rent-vs-Buy | /data/rent-vs-buy | Evergreen refresh for finance sites | **Commodity.** |

**The opening is an intersection, not a geography.** Zolo, Houseful and HonestDoor already
run programmatic neighbourhood pages for regional Ontario — but they publish only price and
supply. Nobody publishes *behavioural* metrics (over-ask rate, sale-to-list, price-cut
share, condo fee trend, closed rents) outside the GTA. **Behavioural × outside-GTA is the
uncontested cell.** Pitch regional press: Sudbury Star, Peterborough Examiner, Sarnia
Observer, Barrie Today, Kingston Whig-Standard, Timmins, Sault, Brantford. Gutted
newsrooms, no data desk, constant housing coverage, and Postmedia/Torstar syndicate a
single yes. National desks already have Wahi.

**Our edge over TRREB/CREA press releases** — every item checkable by the recipient in one
click, which is why it works without a novelty claim: free (no paywall, no login),
nightly not monthly, neighbourhood-level not regional, one comparable view across Ontario
markets where TRREB/OREB/Cornerstone each publish only their own on their own definitions,
written methodology, embeddable charts, custom pulls within a day. Prices validate within
±0-2% of TRREB/CREA (metrics-vs-official validation, 2026-07-18).

**The one honest methodological point:** TRREB's PDOM measures homes that **sold** and is
therefore survivorship-biased. Ours measures homes **still sitting**. That is a real
distinction and it is why our numbers are higher. Say it first, yourself. Never present
our figures as comparable to TRREB's — different population, different statistic.

**Honesty guardrails for every pitch** (from the validation audit):
- Our sales *counts* are directional (VOW feed is a subset, ~15-23% low) — never pitch
  absolute sales counts; pitch prices, cuts, DoM, fees, ratios.
- Ottawa sell-through is structurally N/A; don't pitch Ottawa on that metric.
- Attribution ask is always: "Source: PureProperty.ca" linking to the tracker page.

---

## Outreach sequences

### A. Journalists (national + regional)
Subject: `Free nightly [city] housing data — price cuts & true days-on-market (embeddable)`

> Hi [Name],
>
> I read your [date] piece on [story] — the [specific stat they used] point stood out.
>
> I run PureProperty.ca, and we publish free, nightly-updated trackers for [city]'s
> market that go a level deeper than the monthly board releases: share of listings
> taking price cuts, *true* days-on-market (we stitch relists together — boards reset
> the clock), condo fee trends, and a rent-vs-buy index.
>
> Two things on offer, no strings:
> 1. Any chart is embeddable in your CMS (live widget, one line of HTML).
> 2. If you're working on a housing story, I'll pull a custom cut of the data for you
>    within a day — neighbourhood-level if you need it.
>
> All we ask is a "Source: PureProperty.ca" credit. Recent example of the data:
> [one striking, current stat for their city].
>
> [sign-off]

Key: the *custom data pull* offer is what converts — journalists want exclusive angles,
not widgets. The widget is the durable link; the custom pull is the door-opener.

### B. Newsletter writers / podcasters / YouTubers
Same skeleton, but offer: (1) early access to monthly summary before we publish,
(2) a named shout-out/link back from our /data hub "As seen in" strip (reciprocity —
cheap for us, real for a creator), (3) custom regional cuts for their audience.

### C. Finance/mortgage content sites (link reclamation)
Find their existing stats article (agents log one per site). Pitch the *upgrade*:

> Your "[article title]" cites [CREA monthly / stale figure]. We publish the same
> metric nightly with a permalink + embeddable chart that stays current — your page
> never goes stale again. Happy to have your dev drop in the embed; attribution link
> is built into the widget.

### D. Academics / librarians / advocacy orgs
Pitch the *dataset*, not the story: methodology page, stable URLs, citation format
("PureProperty Ontario Market Trackers, retrieved [date]"). Ask librarians to add the
hub to their Canadian housing data libguide. Offer academics a data extract for
research use w/ citation.

### E. Reactive PR (no email needed — standing channel)
Sign up and answer Canadian-housing queries weekly: Qwoted, Featured.com,
Help a B2B Writer, SourceBottle. Each answered query = potential DA80+ citation.
Answer with a tracker stat + link; speed wins these.

---

## Out-of-the-box plays (beyond the contact list)

1. **Monthly "Ontario Market Pulse" press email** — 5 stats, 1 chart, embargo-free, on
   the 1st business day (beats TRREB's mid-month release by ~2 weeks). Recurring
   touchpoint > one-off pitches. Reuses the existing email infra (senders.ts, alerts
   pipeline). ⚠️ **Not a blast to the full list.** That contradicts the CASL rule below
   and the one-to-one pacing rule. It only works as an opt-in: a recipient asks to be
   added after a personalised send, and every issue carries a working unsubscribe.
2. **"As seen in" reciprocity strip** on /data — creators link us, we link them.
3. ~~**True-DoM exposé as a launch story**~~ — **RETRACTED 2026-08-14.** The premise was
   false. TRREB has published PDOM since 2020, the Globe covered it, and Move Smartly —
   a contact on our own list — has analysed it. Two days went into verifying our number
   was internally correct and none into asking whether it was already public. Any
   replacement play must clear the prior-art gate at the top of this file first.
4. **Libguide sweep** — 10 librarian emails ≈ 10 durable .edu-adjacent links; near-zero
   competition for these.
5. **Wikipedia** — once 2-3 press citations exist, the trackers become citable refs on
   pages like "Toronto real estate" / "Canadian property bubble". Never self-edit
   aggressively; add where genuinely due or let editors find press coverage.
6. **Embed = link magnet**: every widget carries the attribution link; prioritize
   getting embeds (not just mentions) at outlets with template pages (regional news
   CMSes reuse modules across hundreds of pages).

---

## Companion files — LOCAL ONLY, deliberately not in this repo

This repository is **public**. Three companion files carry named individuals' email
addresses (73 unique, 17 of them inferred rather than published), so they are gitignored
and exist only on the operator's machine. Do not commit them, do not paste their contents
into an issue, a PR body or a public artifact.

| file | what it holds |
|---|---|
| `data-outreach-contacts.md` | ~85 contacts across 5 lanes, email status labels, source URLs, ranked first-10 |
| `data-outreach-ready-to-send.md` | the finished per-contact drafts and the send schedule |
| `data-outreach-send-log.md` | one row per send: who, when, figure pasted, reply, outcome |

This playbook is the reviewable half — the method, the guardrails and the prior-art gate
live here precisely so they can be diffed. Rules that live where nothing checks them are
rules we break; that is how two false novelty claims reached production.

## Contact list

See `data-outreach-contacts.md` (local only, see above) — compiled from public sources
2026-07-20, **re-verified 2026-08-10** (see the changelog at the top of that file:
the first-10 list changed, and one previously-"found" email turned out to be dead).
Email statuses: **found** (seen published; source URL logged), **generic**
(tips@/editorial inbox), **guessed-pattern** (inferred, verify before send),
**pattern-confirmed** (format stated by the employer), **none** (use alt contact).
CASL note: these are cold B2B emails to published professional addresses — one-to-one,
relevant-to-role, identify yourself, include unsubscribe/opt-out line; keep volume low
and personal, no bulk blasts.

**Re-verify before each wave.** In three weeks this list lost one first-10 contact to a
job change, one to a dead domain, and gained a promotion worth re-ranking. Contacts
decay fast; a bounce or a wrong-title greeting burns the one cold-open you get.
