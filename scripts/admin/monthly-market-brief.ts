/**
 * Monthly market brief — the newsjack generator.
 *
 * THE PLAY: TRREB/CREA publish BOARD-WIDE aggregates on the 3rd business day of each month,
 * and every outlet writes the same story from the same release that morning. We publish
 * within hours with the cut they did NOT give — neighbourhood/market-level granularity —
 * so a reporter already writing the story has a quotable number nobody else has. That is
 * what earns an editorial link; a "list your home" page never will.
 *
 * This script turns that from a research project into a paste-and-send: it reads the same
 * boards the public /data trackers render and emits a finished brief with a suggested lead,
 * quotable lines, a numbers table, and the tracker URLs a journalist can cite.
 *
 * It deliberately does NOT pick the story for you — newsworthiness is editorial judgement.
 * It ranks candidate angles by how extreme they are and marks a SUGGESTED lead; a human
 * chooses. Every figure is a full-population aggregate (§4), statistics only (§6.3b).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/admin/monthly-market-brief.ts                    # print
 *   npx tsx --env-file=.env scripts/admin/monthly-market-brief.ts --out brief.md
 *   npx tsx --env-file=.env scripts/admin/monthly-market-brief.ts --digest digest.md
 *
 * --digest writes a SHORT version (lead + headlines + links). notifyRun.ts quotes only the
 * tail of a file into the email body, so the full brief would arrive showing its last lines
 * (the pitch template) rather than the lead. The workflow emails the digest and attaches
 * the full brief as a build artifact.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { computeMarketBoardUncached, type MarketRow } from '@/lib/data/marketBoard';
import { computeCondoFeeBoardUncached } from '@/lib/data/condoFeeBoard';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');

const outArg = process.argv.indexOf('--out');
const OUT_FILE = outArg > -1 ? process.argv[outArg + 1] : null;
const digestArg = process.argv.indexOf('--digest');
const DIGEST_FILE = digestArg > -1 ? process.argv[digestArg + 1] : null;

// ── formatting ───────────────────────────────────────────────────────────────
const money = (n: number | null) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString('en-CA')}`;
const compact = (n: number | null) =>
  n == null ? '—' : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
const pct = (n: number | null, d = 1) => (n == null ? '—' : `${n.toFixed(d)}%`);
const signedPct = (n: number | null, d = 1) =>
  n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`;

/** Sort helper that always pushes nulls last regardless of direction. */
function by<T>(get: (t: T) => number | null, dir: 'asc' | 'desc' = 'desc') {
  return (a: T, b: T) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'desc' ? bv - av : av - bv;
  };
}

interface Angle {
  /** Higher = more likely to carry a story. See WEIGHT. */
  score: number;
  headline: string;
  quote: string;
  source: string;
}

/**
 * Base editorial weight per angle, before any extremity bonus.
 *
 * Ranked by how reliably each one carries a story, NOT by how large its number happens to
 * be — otherwise a metric that simply lives on a bigger scale (rental yield spreads, condo
 * percentages) outranks the angle a reporter actually wants. Price cuts sit top because
 * they are both the recurring "is the market cooling?" headline AND the cut no official
 * source publishes at market level, which is the whole reason this earns a link.
 */
const WEIGHT = { cuts: 100, dom: 70, temperature: 60, condo: 50, yield: 30 } as const;

/** "a 11-day gap" reads as sloppy in a pitch; get the article right. */
const article = (n: number) => (/^(8|11|18|8\d|11\d|18\d)/.test(String(n)) ? 'an' : 'a');
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function buildAngles(rows: MarketRow[], condo: Awaited<ReturnType<typeof computeCondoFeeBoardUncached>>): Angle[] {
  const angles: Angle[] = [];

  // 1. Price cuts — the recurring "market is cooling" headline, and our sharpest edge:
  //    no official source publishes it at market level.
  const cutRows = rows.filter((r) => r.cutShare != null);
  if (cutRows.length) {
    const totalCut = cutRows.reduce((s, r) => s + (r.cutCount ?? 0), 0);
    const totalActive = cutRows.reduce((s, r) => s + (r.cutActive ?? 0), 0);
    const gta = totalActive > 0 ? (totalCut / totalActive) * 100 : null;
    const top = [...cutRows].sort(by((r) => r.cutShare))[0];
    if (gta != null && top?.cutShare != null) {
      angles.push({
        score: WEIGHT.cuts + gta,
        headline: `${pct(gta)} of GTA listings have cut their asking price — led by ${top.region} at ${pct(top.cutShare * 100)}`,
        quote:
          `Across the Greater Toronto Area, ${pct(gta)} of homes currently for sale have reduced their ` +
          `asking price — ${totalCut.toLocaleString('en-CA')} of ${totalActive.toLocaleString('en-CA')} active listings. ` +
          `${top.region} leads at ${pct(top.cutShare * 100)}, with a typical reduction of ${pct(top.medianCutPct)} ` +
          `(${compact(top.medianCutAmt)}).`,
        source: `${SITE}/data/price-cuts`,
      });
    }
  }

  // 2. Speed of sale — "homes in X sell in N days" is instantly quotable local news.
  const domRows = rows.filter((r) => r.soldMedianDom != null);
  if (domRows.length >= 2) {
    const fast = [...domRows].sort(by((r) => r.soldMedianDom, 'asc'))[0];
    const slow = [...domRows].sort(by((r) => r.soldMedianDom))[0];
    const spread = (slow.soldMedianDom ?? 0) - (fast.soldMedianDom ?? 0);
    angles.push({
      score: WEIGHT.dom + spread,
      headline: `Homes sell in ${fast.soldMedianDom} days in ${fast.region} — but take ${slow.soldMedianDom} in ${slow.region}`,
      quote:
        `${fast.region} is the fastest-moving market in the region, where the typical home sells in ` +
        `${fast.soldMedianDom} days. In ${slow.region} the same figure is ${slow.soldMedianDom} days — ` +
        `${article(spread)} ${spread}-day gap between the two ends of the Greater Toronto Area.`,
      source: `${SITE}/data/days-on-market`,
    });
  }

  // 3. Buyer/seller balance — the "is it a buyer's market?" question every reader has.
  const scored = rows.filter((r) => r.temperature != null);
  if (scored.length) {
    const buyers = scored.filter((r) => r.temperature === 'cold');
    const sellers = scored.filter((r) => r.temperature === 'hot');
    const balanced = scored.length - buyers.length - sellers.length;
    angles.push({
      score: WEIGHT.temperature + Math.max(buyers.length, sellers.length) * 3,
      headline:
        `${buyers.length} of ${scored.length} GTA markets now ${plural(buyers.length, 'favours', 'favour')} buyers` +
        (sellers.length
          ? `, while ${sellers.length} still ${plural(sellers.length, 'favours', 'favour')} sellers`
          : ''),
      quote:
        `Of ${scored.length} markets tracked across the GTA and Ottawa, ${buyers.length} currently ` +
        `${plural(buyers.length, 'favours', 'favour')} buyers` +
        `${buyers.length ? ` (${buyers.map((b) => b.region).join(', ')})` : ''} and ${sellers.length} ` +
        `${plural(sellers.length, 'favours', 'favour')} sellers` +
        `${sellers.length ? ` (${sellers.map((s) => s.region).join(', ')})` : ''}. ` +
        `The remaining ${balanced} ${plural(balanced, 'is', 'are')} balanced.`,
      source: `${SITE}/data/market-temperature`,
    });
  }

  // 4. Condo fees — genuinely unique; no official source tracks this at all.
  if (condo.rows.length) {
    const top = condo.rows[0];
    const median = [...condo.rows].map((r) => r.annualPct).sort((a, b) => a - b)[
      Math.floor(condo.rows.length / 2)
    ];
    angles.push({
      score: WEIGHT.condo + top.annualPct,
      headline: `Condo fees are rising fastest in ${top.area} — ${signedPct(top.annualPct)} a year`,
      quote:
        `Condo maintenance fees in ${top.area} (${top.city}) are rising at ${signedPct(top.annualPct)} a year, ` +
        `the fastest of ${condo.rows.length} neighbourhoods tracked, against a typical ${signedPct(median)} across the region. ` +
        `Long-run condo-fee inflation runs about 3% a year.`,
      source: `${SITE}/data/condo-fees`,
    });
  }

  // 5. Rental yield — the perennial personal-finance rent-vs-buy story.
  const yields = rows
    .map((r) => ({ region: r.region, y: r.rentalRows.find((x) => x.beds === 2)?.grossYieldPct ?? null }))
    .filter((x) => x.y != null)
    .sort(by((x) => x.y));
  if (yields.length >= 2) {
    const best = yields[0];
    const worst = yields[yields.length - 1];
    angles.push({
      score: WEIGHT.yield + ((best.y ?? 0) - (worst.y ?? 0)),
      headline: `A two-bedroom returns ${pct(best.y, 2)} in ${best.region} — but only ${pct(worst.y, 2)} in ${worst.region}`,
      quote:
        `On a gross basis, a two-bedroom home returns ${pct(best.y, 2)} a year in ${best.region}, versus ` +
        `${pct(worst.y, 2)} in ${worst.region} — before mortgage interest, taxes and maintenance.`,
      source: `${SITE}/data/rent-vs-buy`,
    });
  }

  return angles.sort((a, b) => b.score - a.score);
}

function buildBrief(
  rows: MarketRow[],
  condo: Awaited<ReturnType<typeof computeCondoFeeBoardUncached>>,
  asOf: string
): string {
  const angles = buildAngles(rows, condo);
  const lead = angles[0];
  const month = new Date().toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const toronto = rows.find((r) => r.region === 'Toronto');

  const L: string[] = [];
  L.push(`# PureProperty market brief — ${month}`);
  L.push('');
  L.push(`*Data as of ${asOf}. Every figure is a full-population aggregate of live MLS® data across ${rows.length} markets.*`);
  L.push('');
  L.push('> **How to use this.** Board releases (TRREB/CREA/OREB) land on the 3rd business day and every outlet');
  L.push('> writes the same region-wide story that morning. Your edge is the cut they do not publish:');
  L.push('> market-by-market granularity. Lead with a number nobody else has, then point back to the tracker.');
  L.push('');

  if (lead) {
    L.push('## Suggested lead');
    L.push('');
    L.push(`**${lead.headline}**`);
    L.push('');
    L.push(`${lead.quote}`);
    L.push('');
    L.push(`Source: ${lead.source}`);
    L.push('');
  }

  if (angles.length > 1) {
    L.push('## Other angles (ranked)');
    L.push('');
    for (const a of angles.slice(1)) {
      L.push(`### ${a.headline}`);
      L.push('');
      L.push(a.quote);
      L.push('');
      L.push(`Source: ${a.source}`);
      L.push('');
    }
  }

  // The quotable table — a reporter should be able to lift this wholesale.
  L.push('## The numbers');
  L.push('');
  L.push('| Market | Median sold | Average | YoY | Days to sell | % cutting price | Market type |');
  L.push('|---|---|---|---|---|---|---|');
  const TEMP: Record<string, string> = { hot: "Seller's", balanced: 'Balanced', cold: "Buyer's" };
  for (const r of [...rows].sort(by((x) => x.medianPrice))) {
    L.push(
      `| ${r.region} | ${money(r.medianPrice)} | ${money(r.avgPrice)} | ${signedPct(r.yoyPct)} | ` +
        `${r.soldMedianDom ?? '—'} | ${r.cutShare == null ? '—' : pct(r.cutShare * 100)} | ` +
        `${r.temperature ? TEMP[r.temperature] : '—'} |`
    );
  }
  L.push('');

  if (toronto) {
    L.push('## Toronto at a glance');
    L.push('');
    L.push(`- Median sold price **${money(toronto.medianPrice)}** (average ${money(toronto.avgPrice)}), ${signedPct(toronto.yoyPct)} year over year`);
    L.push(`- Typical home sells in **${toronto.soldMedianDom ?? '—'} days**; active listings have been on market a median of ${toronto.trueDom ?? '—'} days`);
    L.push(`- **${toronto.cutShare == null ? '—' : pct(toronto.cutShare * 100)}** of active listings have cut their price`);
    L.push(`- **${toronto.monthsOfSupply?.toFixed(1) ?? '—'} months** of supply; sold-to-list ${pct(toronto.soldToListPct)}`);
    L.push('');
  }

  L.push('## Trackers (free to cite and embed)');
  L.push('');
  for (const [label, slug] of [
    ['Price-cut tracker', 'price-cuts'],
    ['Home price rankings', 'price-rankings'],
    ['Days-on-market leaderboard', 'days-on-market'],
    ['Market temperature', 'market-temperature'],
    ['Rent vs buy', 'rent-vs-buy'],
    ['Condo fee tracker', 'condo-fees'],
  ] as const) {
    L.push(`- [${label}](${SITE}/data/${slug})`);
  }
  L.push('');
  L.push('## Method & attribution');
  L.push('');
  L.push('Figures are computed from the full population of MLS® listing and sold records available to us,');
  L.push('refreshed nightly — not a sample or a model. Sold counts come from the VOW feed, a comprehensive');
  L.push('but not exhaustive subset of the market, so treat absolute counts as directional and shares/medians');
  L.push('as accurate. Please attribute to **PureProperty.ca** with a link to the relevant tracker.');
  L.push('');
  L.push('---');
  L.push('');
  L.push('### Pitch email (paste and edit)');
  L.push('');
  L.push('```');
  L.push(`Subject: ${lead ? lead.headline : 'GTA market data — neighbourhood-level numbers'}`);
  L.push('');
  L.push('Hi {name},');
  L.push('');
  L.push('Saw you cover the monthly board numbers. We track the same market at the');
  L.push('individual-municipality level, so here is a cut the board release does not give:');
  L.push('');
  if (lead) {
    L.push(lead.quote.replace(/\s+/g, ' ').trim());
    L.push('');
    L.push(`Full table and method: ${lead.source}`);
  }
  L.push('');
  L.push('Happy for you to use any of it with attribution. And if you ever need a custom');
  L.push('number for a story — a specific neighbourhood, building type or time window — send');
  L.push('it over and I will pull it for you, no charge.');
  L.push('');
  L.push('{your name}');
  L.push('PureProperty.ca');
  L.push('```');
  L.push('');
  return L.join('\n');
}

/** Short version for the notification email (notifyRun quotes only a file's tail). */
function buildDigest(
  rows: MarketRow[],
  condo: Awaited<ReturnType<typeof computeCondoFeeBoardUncached>>,
  asOf: string
): string {
  const angles = buildAngles(rows, condo);
  const L: string[] = [];
  L.push(`MONTHLY MARKET BRIEF — data as of ${asOf}`);
  L.push('');
  if (angles[0]) {
    L.push('SUGGESTED LEAD');
    L.push(angles[0].headline);
    L.push('');
    L.push(angles[0].quote.replace(/\s+/g, ' ').trim());
    L.push('');
  }
  if (angles.length > 1) {
    L.push('OTHER ANGLES');
    for (const a of angles.slice(1)) L.push(`• ${a.headline}`);
    L.push('');
  }
  L.push(`Full brief + pitch email: download the "market-brief" artifact from this run.`);
  L.push(`Trackers: ${SITE}/data`);
  return L.join('\n');
}

async function main() {
  const [board, condo] = await Promise.all([
    computeMarketBoardUncached(),
    computeCondoFeeBoardUncached(),
  ]);
  if (!board.rows.length) {
    console.error('❌ No market data available — is region_metrics populated?');
    process.exit(1);
  }
  const asOf = board.dataAsOf
    ? new Date(board.dataAsOf).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'today';

  const brief = buildBrief(board.rows, condo, asOf);
  if (DIGEST_FILE) {
    fs.writeFileSync(DIGEST_FILE, buildDigest(board.rows, condo, asOf), 'utf8');
    console.log(`✅ Digest written to ${DIGEST_FILE}`);
  }
  if (OUT_FILE) {
    fs.writeFileSync(OUT_FILE, brief, 'utf8');
    console.log(`✅ Brief written to ${OUT_FILE} (${brief.split('\n').length} lines)`);
  }
  if (!OUT_FILE && !DIGEST_FILE) console.log(brief);
}

main().catch((e) => {
  console.error('CRASH:', e instanceof Error ? e.message : e);
  process.exit(1);
});
