# content-queue/data — daily public-safe data snapshots

`latest.json` (and a dated `YYYY-MM-DD.json` copy) is written every morning by the
**Content Data Snapshot** GitHub Actions workflow (`.github/workflows/content-data-snapshot.yml`),
which runs `scripts/marketing/contentFactory/snapshotPublicData.ts`.

## Why it exists
The Content Factory drafts run as a scheduled Claude Code **cloud routine** on the Max plan.
That sandbox has no secrets and its egress is blocked from the live site and the database, so
it cannot fetch numbers itself. GitHub Actions (which holds the Supabase service-role secret)
distills the day's most surprising **aggregate** figures from the same `region_metrics`
precompute the public `/data` trackers render, and commits them here. The routine reads
`latest.json` straight from its checkout — no network, no scraping, no secrets.

## The contract (`latest.json`)
```json
{
  "generatedForDateUtc": "2026-08-03",
  "dataAsOf": "2026-08-03T08:04:00Z",
  "source": "region_metrics nightly precompute (computeMarketBoardUncached)",
  "compliancePosture": "Aggregate region-level statistics only; no individual sold prices; every figure n>=5. Cite figures verbatim.",
  "angles": [
    {
      "kind": "price_cuts",
      "region": "Toronto",
      "headline": "34% of active Toronto listings have cut their asking price",
      "figure": "34%",
      "sampleN": 812,
      "sourceUrl": "https://www.pureproperty.ca/data/price-cuts",
      "whySurprising": "Highest price-cut share of the markets tracked today.",
      "context": "typical reduction 3.1%"
    }
  ]
}
```

## Compliance
Every `figure` is a region-level **aggregate** statistic (no listing rows, no individual sold
price) with `sampleN >= 5`. The drafter must cite `figure` verbatim and link only to
`sourceUrl`. If `latest.json` is missing, stale (`dataAsOf` > 3 days old), or has no angles,
the routine **skips drafting** rather than invent a number. Nothing is ever posted
automatically — the routine only opens a PR of drafts for a human to review, edit, and post.
