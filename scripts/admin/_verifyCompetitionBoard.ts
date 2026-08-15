/**
 * Verify the over-asking board over POSTGREST — the path the page actually uses.
 *
 * Direct-pg verification is what let the rents board ship serving only the priciest 1000 rows:
 * the aggregation was correct in Postgres and the page still lied, because PostgREST caps a
 * single response at 1000 rows and nothing errored. Test the transport the page uses.
 */
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

async function main() {
  const { computeCompetitionBoardUncached } = await import('../../src/lib/data/competitionBoard');
  const board = await computeCompetitionBoardUncached();

  console.log(`rows (neighbourhood): ${board.rows.length}`);
  console.log(`summary (province):   ${board.summary.length}`);
  console.log(`dataAsOf:             ${board.dataAsOf}`);

  if (board.rows.length + board.summary.length < 1100) {
    console.error('\n❌ FEWER ROWS THAN THE TABLE HOLDS — pagination is not working.');
    process.exit(1);
  }

  console.log('\nProvince summary:');
  console.table(board.summary.map((r) => ({
    group: r.group, over: r.pctOverAsk, at: r.pctAtAsk, under: r.pctUnderAsk,
    premium: r.medianPremium, stl: r.medianSaleToList, yoyPts: r.yoyOverAskPts, n: r.sampleCount,
  })));

  const rankable = board.rows.filter((r) => r.group === 'House' && r.sampleCount >= 100);
  console.log(`\nRankable house areas: ${rankable.length}`);
  console.table(
    [...rankable].sort((a, b) => b.pctOverAsk - a.pctOverAsk).slice(0, 5)
      .map((r) => ({ area: r.area, city: r.city, over: r.pctOverAsk, premium: r.medianPremium, n: r.sampleCount }))
  );
  console.table(
    [...rankable].sort((a, b) => a.pctOverAsk - b.pctOverAsk).slice(0, 5)
      .map((r) => ({ area: r.area, city: r.city, over: r.pctOverAsk, discount: r.medianDiscount, n: r.sampleCount }))
  );

  // Names must be readable — a district code in a published table reads as a database leak.
  const coded = board.rows.filter((r) => /^\d{3,4}\s*-/.test(r.area));
  console.log(`\nArea names still carrying a district code: ${coded.length} (must be 0)`);
  if (coded.length) { console.log(coded.slice(0, 5).map((r) => r.area)); process.exit(1); }

  // The three shares are reported as summing to 100 — verify that claim rather than trust it.
  const bad = board.rows.filter((r) => {
    const s = r.pctOverAsk + (r.pctAtAsk ?? 0) + (r.pctUnderAsk ?? 0);
    return Math.abs(s - 100) > 0.35; // rounding to 1dp across three shares
  });
  console.log(`Rows whose over/at/under do not sum to 100: ${bad.length} (must be 0)`);
  if (bad.length) { console.table(bad.slice(0, 5)); process.exit(1); }

  console.log('\n✅ board verified over PostgREST');
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e?.message || e); process.exit(1); });
