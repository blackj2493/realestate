# Newsjack playbook — turning the /data trackers into backlinks

The trackers are the *assets*. They do not earn links by existing. This is the distribution
side: what to send, to whom, and when.

**The core insight.** TRREB/CREA/OREB publish **board-wide** aggregates. Every outlet writes
the same region-wide story from the same release on the same morning. Our edge is the cut
they do not publish — **market-by-market granularity** — so a reporter already writing that
story gets a quotable number nobody else has. That is what earns an editorial link. A "list
your home" page never will.

---

## The monthly rhythm

| When | What |
|---|---|
| **3rd business day, ~08:30 ET** | Boards release. The `Monthly Market Brief` workflow has already emailed you a brief generated from live tracker data (full version attached as a build artifact). |
| **Within 2–3 hours** | Send the pitch to reporters covering the release **today**. Speed is the entire play — by tomorrow the cycle has moved on. |
| **Same day** | Post the headline stat to r/TorontoRealEstate, r/canadahousing. Not for the links — for the narrative, and because reporters source anecdotes there. |
| **Any time** | Answer journalist-request platforms (Featured, Qwoted, Help a B2B Writer, Source of Sources) filtered to real estate / housing / Canada. |

Run it manually any time with:

```bash
npx tsx --env-file=.env scripts/admin/monthly-market-brief.ts
```

---

## Target list

Prioritise **the person who writes the monthly-numbers story**, not the general newsroom
address. Fill in names/emails as you confirm them — a named reporter converts far better
than `tips@`.

### National / business desks
| Outlet | Beat | Notes |
|---|---|---|
| The Globe and Mail — Real Estate | Housing market, Done Deals | Highest authority; wants a genuine study, not a stat dump |
| Financial Post | Housing, personal finance | Loves affordability + rent-vs-buy angles |
| Toronto Star — Business/Real Estate | GTA housing | Neighbourhood granularity is exactly their frame |
| BNN Bloomberg | Markets | Prefers a chart + a talking head |
| CBC Toronto | Local housing | Human-impact framing; condo fees land well here |

### Trade / vertical (highest hit-rate — start here)
| Outlet | Beat | Notes |
|---|---|---|
| STOREYS | Development + market data | Very receptive to novel datasets |
| BetterDwelling | Housing data | Data-first; will engage with method |
| Move Smartly (John Pasalis) | TRREB market analysis | Serious analyst — will scrutinise method, so be exact |
| Livabl / New in Homes | New construction | Pairs with the new-construction hub |
| Canadian Mortgage Trends | Rates, affordability | Rent-vs-buy + yields |
| REM (Real Estate Magazine) | Industry | Agent-facing |

### Local / community
| Outlet | Beat |
|---|---|
| blogTO | Toronto lifestyle — punchy single stats |
| Toronto Life | Long-form neighbourhood pieces |
| InsideHalton / DurhamRegion / MississaugaToday | Suburban markets — our per-market data is the story |
| Ottawa Citizen | Ottawa market (now fully covered since the region_aliases fix) |

---

## What actually converts

**1. The recurring pitch (highest ROI).** Not "please link to us" — *"need a custom number
for a story? We'll pull it free, with attribution."* Reporters on deadline take that up, and
every pull becomes a citation. Send it **once** per reporter; it is an offer, not a campaign.

**2. Lead with the number, not the company.** The subject line should be the stat. Nobody
opens "PureProperty market update."

**3. One angle per pitch.** The brief ranks several; pick the one that fits *that* outlet.
Sending all five reads as a press release and gets filed.

**4. Make citation effortless.** Every tracker has an embed snippet that carries a real
`<a>` backlink. An iframe `src` alone is not crawlable link equity — the snippet's anchor is
the thing that counts.

**5. Never pitch a number you cannot defend.** Every figure is a full-population aggregate,
refreshed nightly, and the method is on each tracker page. If a reporter asks how it is
computed, send them the "How this is calculated" section — that transparency is *why* a
data-literate outlet will cite you.

---

## Known caveats to disclose proactively

Volunteering these builds credibility with exactly the outlets worth having:

- **Sold counts come from the VOW feed** — comprehensive but not exhaustive, so absolute
  counts run below board totals. **Shares, medians and ratios are accurate**; treat counts as
  directional. Say so before you are asked.
- **Median ≠ average.** Boards headline the *average*; our trackers show both. The gap is
  large in luxury-heavy markets, so state which one you are quoting.
- **Condo fees are neighbourhood-level, never per building** — fee inclusions and unit-size
  buckets make single-building numbers unreliable enough that publishing a named ranking
  would be indefensible. If a reporter wants a specific building, pull it privately with the
  caveats attached rather than publishing it.

---

## Measuring it

Track **referring domains**, not traffic — one link from the Globe beats 10k pageviews.
Google Search Console → Links, or the Ahrefs/Semrush free tier. Tag each new referring domain
by channel (monthly brief / custom pull / embed / journalist platform) and put the next
month's effort into whichever is actually converting.
