/**
 * Scratch probe (READ-ONLY): does `raw_vow_sold` actually contain enough history for
 * the dashboard / Market Trends YoY to resolve everywhere it's shown?
 *
 * WHY: YoY (smoothedYoY in src/lib/dashboard/marketAggregates.ts) compares the mean of
 * the latest 3 months WITH data against the SAME 3 calendar months 12 months earlier.
 * It returns null ("—") unless BOTH windows are present. So a region renders YoY only
 * when raw_vow_sold has ~15 months of coverage for that region+scope. This script
 * confirms (a) the archive's overall date span and (b) per-region whether YoY resolves,
 * and when it doesn't, exactly which prior-year months are missing.
 *
 * It reuses the PRODUCTION path verbatim — the region_price_trend RPC (migration 040)
 * and the real smoothedYoY — so the verdict matches what the UI computes. No writes;
 * only SELECTs / RPC reads against raw_vow_sold.
 *
 * Run (all default seed cities):   npx.cmd tsx --env-file=.env scripts/admin/_probeYoYCoverage.ts
 * Run (add custom regions/hoods):  npx.cmd tsx --env-file=.env scripts/admin/_probeYoYCoverage.ts "Rosedale-Moore Park" "Oakville"
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { smoothedYoY, type TrendPoint } from '@/lib/dashboard/marketAggregates';
dotenv.config({ path: ['.env.local', '.env'] });

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MONTHS = 24; // mirrors aggregates.ts MONTHS (the RPC's p_months default)

// Seed universe of dashboard cities = the values in REGION_TO_CITIES (src/lib/dashboard/config.ts).
// Hardcoded here (not imported) to keep this probe free of the dashboard's client-only deps.
// Append any City or CityRegion (neighbourhood) name as a CLI arg to spot-check it too.
const DEFAULT_REGIONS = [
  'Toronto', 'Mississauga', 'Brampton', 'Markham', 'Vaughan', 'Richmond Hill',
  'Oshawa', 'Whitby', 'Ajax', 'Pickering', 'Oakville', 'Burlington', 'Milton',
  'Hamilton', 'Ottawa',
];
const regions = [...new Set([...DEFAULT_REGIONS, ...process.argv.slice(2)])];

/** Shift "YYYY-MM" back 12 months — identical rule to marketAggregates.priorYearKey. */
function priorYearKey(k: string): string {
  const [y, m] = k.split('-');
  return `${Number(y) - 1}-${m}`;
}

/**
 * Explain WHY YoY would or wouldn't resolve for a price series — mirrors smoothedYoY's
 * own gates (≥3 months with a positive value; each of the latest 3 needs its −12mo twin).
 */
function diagnose(points: TrendPoint[]): { ok: boolean; reason: string; recent?: string[] } {
  const valByMonth = new Map<string, number>();
  for (const p of points) {
    if (p.medianPrice != null && Number.isFinite(p.medianPrice) && p.medianPrice > 0) {
      valByMonth.set(p.month, p.medianPrice);
    }
  }
  const monthsWithVal = points.map((p) => p.month).filter((m) => valByMonth.has(m));
  if (monthsWithVal.length < 3) {
    return { ok: false, reason: `only ${monthsWithVal.length} month(s) with price data (need ≥3)` };
  }
  const recent = monthsWithVal.slice(-3);
  const missing = recent.map(priorYearKey).filter((pm) => !valByMonth.has(pm));
  if (missing.length) {
    return { ok: false, reason: `prior-year month(s) absent: ${missing.join(', ')}`, recent };
  }
  return { ok: true, reason: 'both windows present', recent };
}

async function overallSpan() {
  // Match the trend's universe: real sales only (close_price ≥ $50k filters lease leakage),
  // non-null contract date. Cheap order+limit reads, not a full scan of 217k rows.
  const base = () =>
    sb.from('raw_vow_sold').select('purchase_contract_date').gte('close_price', 50000).not('purchase_contract_date', 'is', null);
  const [{ data: oldest }, { data: newest }, { count }] = await Promise.all([
    base().order('purchase_contract_date', { ascending: true }).limit(1),
    base().order('purchase_contract_date', { ascending: false }).limit(1),
    sb.from('raw_vow_sold').select('*', { count: 'exact', head: true }).gte('close_price', 50000),
  ]);
  const min = oldest?.[0]?.purchase_contract_date ?? null;
  const max = newest?.[0]?.purchase_contract_date ?? null;
  let spanMonths: number | null = null;
  if (min && max) {
    const a = new Date(min), b = new Date(max);
    spanMonths = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  }
  console.log('\n══════════════ raw_vow_sold — overall coverage (sold, ≥$50k) ══════════════');
  console.log(`  earliest sold-firm date : ${min ?? '—'}`);
  console.log(`  latest   sold-firm date : ${max ?? '—'}`);
  console.log(`  span                    : ${spanMonths ?? '—'} months`);
  console.log(`  total rows (≥$50k)       : ${count?.toLocaleString() ?? '—'}`);
  if (spanMonths != null && spanMonths < 15) {
    console.log('  ⚠️  Span < 15 months — YoY CANNOT resolve anywhere yet (needs latest 3 + their −12mo twins).');
  } else {
    console.log('  ✅ Span ≥ 15 months — archive is deep enough for YoY in principle; per-region below.');
  }
}

async function perRegion(region: string) {
  const { data, error } = await sb.rpc('region_price_trend', { p_region: region, p_months: MONTHS });
  if (error) {
    console.log(`  ${region.padEnd(20)} RPC error: ${error.message}`);
    return { region, ok: false };
  }
  const points: TrendPoint[] = Array.isArray((data as { points?: TrendPoint[] })?.points)
    ? (data as { points: TrendPoint[] }).points
    : [];
  const yoyPrice = smoothedYoY(points, 'medianPrice');
  const yoyPpsf = smoothedYoY(points, 'medianPpsf');
  const diag = diagnose(points);
  const months = points.length;
  const oldest = months ? points[0].month : '—';
  const newest = months ? points[months - 1].month : '—';
  const totalSales = points.reduce((s, p) => s + (p.sales || 0), 0);
  const verdict = yoyPrice != null ? '✅ YoY' : '⚠️  null';
  const yoyStr = yoyPrice != null ? `${yoyPrice > 0 ? '+' : ''}${yoyPrice}%` : '—';
  const ppsfStr = yoyPpsf != null ? `${yoyPpsf > 0 ? '+' : ''}${yoyPpsf}%` : '—';
  console.log(
    `  ${verdict.padEnd(8)} ${region.padEnd(20)} ` +
      `months=${String(months).padStart(2)}/${MONTHS}  ${oldest}→${newest}  ` +
      `sales=${String(totalSales).padStart(6)}  price=${yoyStr.padStart(7)}  $psf=${ppsfStr.padStart(7)}`,
  );
  if (yoyPrice == null) console.log(`           ↳ ${diag.reason}`);
  return { region, ok: yoyPrice != null };
}

async function main() {
  console.log(`Probing YoY coverage for ${regions.length} region(s) — RPC: region_price_trend (${MONTHS}mo, all types, no scope floors)`);
  await overallSpan();
  console.log('\n══════════════ per-region YoY resolution (faithful: real RPC + real smoothedYoY) ══════════════');
  const results = [];
  for (const r of regions) results.push(await perRegion(r)); // serial: gentle on the RPC / IO budget
  const ok = results.filter((r) => r.ok).length;
  console.log('\n──────────────────────────────────────────────────────────────────────────────');
  console.log(`  ${ok}/${results.length} region(s) currently render a YoY figure. The rest show "—".`);
  console.log('  Note: this uses the unfiltered lens. Adding beds/baths/type/basement floors thins');
  console.log('  the monthly sample and can drop YoY to "—" even where the unfiltered region resolves.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
