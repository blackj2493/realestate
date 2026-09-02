/**
 * AVM cohort-ladder probe — the targeted before/after gate for any change to how the
 * live estimate resolves its model.
 *
 * WHY THIS EXISTS. PR #452 let the live lookup walk the community → FSA → city ladder
 * and the province-wide backtest read it as noise (published 3691 → 3681 on 4,000
 * sales). The same change suppressed 25% of Waterloo Region + Brantford and pushed
 * 25 of 40 listings MEDIUM → LOW (#458). A province-wide median cannot see a market
 * that is 2% of the sample. THIS probe can: it runs `calculateAVM` on a fixed sample of
 * active listings in the AFFECTED market, a CONTROL market the change must not touch,
 * and a SIBLING market (populated CityRegion, untrained communities) — then diffs each
 * listing against a baseline file produced by the same script on the previous code.
 *
 * Pass condition (target): published count must not fall, and no listing's confidence
 * may move DOWN. Control: every listing identical. LOW is the tier that matters —
 * detectCompetitive returns null on LOW, which strips the competition signal from the
 * Estimated Sale card, the Deal Score Suggested Move and The Read's price line.
 *
 * Usage (from a checkout of the code under test, ~2 min):
 *   npx tsx --env-file=.env scripts/admin/avm-ladder-probe.ts --out before.json
 *   … change the code …
 *   npx tsx --env-file=.env scripts/admin/avm-ladder-probe.ts --out after.json --baseline before.json
 *
 * Read-only: listings, property_estimates and the AVM's own
 * lookups. Writes nothing but the --out file.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mapListingToAVMInput } from '@/lib/avm/mapListingToAVMInput';
import { calculateAVM, resolveModel } from '@/lib/avm/calculator';
import { isUnpriceableType, fsaOf } from '@/lib/avm/normalizeType';
import type { AVMInput } from '@/lib/avm/types';

// ── CLI ──────────────────────────────────────────────────────────────────────
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const OUT = flag('--out');
const BASELINE = flag('--baseline');
const PER_CITY = parseInt(flag('--per-city') ?? '8', 10);
if (!OUT) {
  console.error('usage: avm-ladder-probe.ts --out <file.json> [--baseline <file.json>] [--per-city N]');
  process.exit(1);
}

/**
 * Fixed sample design. Three groups, each named for what it proves:
 *   target  — blank CityRegion on both feed sides; the ladder is the ONLY native model.
 *   control — trained community cohorts; the ladder must be inert here.
 *   sibling — populated CityRegion but thin communities that borrow a sibling today;
 *             the ladder REPLACES the borrow, so this group shows that trade.
 */
const GROUPS: Record<string, string[]> = {
  target: ['Kitchener', 'Cambridge', 'Waterloo', 'Woolwich', 'Wilmot', 'North Dumfries', 'Wellesley', 'Brantford'],
  control: ['Mississauga', 'Brampton'],
  sibling: ['Aurora', 'Chatham-Kent', 'Newmarket'],
};

const PRICE_FLOOR = 50000;
const TERMINAL_STATUSES = new Set(['sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended']);

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface ListingRow {
  listing_key: string;
  list_price: number | string | null;
  full_payload: Record<string, unknown> | null;
}

interface ProbeRow {
  key: string;
  group: string;
  city: string;
  cityRegion: string;
  fsa: string;
  subType: string;
  listPrice: number | null;
  model: {
    rung: string | null;
    borrowed: boolean;
    nativeN: number;
    effectiveN: number;
    r2: number | null;
    basePrice: number | null;
  };
  live: {
    estimatedValue: number;
    confidence: string;
    basis: string;
    engineMode: string;
    predictiveSD: number;
    totalAdjustmentPct: number;
    nEff: number;
    comps: number;
  };
  stored: {
    estimatedValue: number | null;
    confidence: string | null;
    computedAt: string | null;
  } | null;
}

interface ProbeFile {
  ranAt: string;
  head: string;
  perCity: number;
  rows: ProbeRow[];
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isActive(payload: Record<string, unknown> | null, listPrice: number | null): boolean {
  if (listPrice === null || listPrice < PRICE_FLOOR) return false;
  const status = String(payload?.['Status'] ?? payload?.['MlsStatus'] ?? payload?.['StandardStatus'] ?? '')
    .toLowerCase()
    .trim();
  return !TERMINAL_STATUSES.has(status);
}

// Same no-rooms sqft fallback the nightly batch and the detail page use.
/** Newest listing keys first, so the sample is mostly live listings; filtered to
 *  active + priceable + mappable, then cut to PER_CITY. Deterministic for a given table. */
async function sampleCity(group: string, city: string): Promise<{ row: ListingRow; input: AVMInput }[]> {
  const { data, error } = await sb
    .from('listings')
    .select('listing_key, list_price, full_payload')
    .eq('city', city)
    .gte('list_price', PRICE_FLOOR)
    .order('listing_key', { ascending: false })
    .limit(PER_CITY * 4);
  if (error) {
    console.warn(`   ⚠️  ${city}: read failed: ${error.message}`);
    return [];
  }
  const out: { row: ListingRow; input: AVMInput }[] = [];
  for (const row of (data ?? []) as unknown as ListingRow[]) {
    const payload = row.full_payload;
    if (!payload || !isActive(payload, numOrNull(row.list_price))) continue;
    const subType = payload['PropertySubType'];
    if (isUnpriceableType(typeof subType === 'string' ? subType : null)) continue;
    const input = mapListingToAVMInput(payload);
    if (!input) continue;
    out.push({ row, input });
    if (out.length >= PER_CITY) break;
  }
  console.log(`   ${group.padEnd(8)} ${city.padEnd(16)} ${out.length} listings`);
  return out;
}

async function probeOne(group: string, row: ListingRow, input: AVMInput): Promise<ProbeRow> {
  const [resolved, live] = await Promise.all([resolveModel(sb, input), calculateAVM(sb, input)]);
  // `rung` exists only on the ladder-aware ResolvedModel; the baseline code has no such field.
  const rung = (resolved as unknown as { rung?: string | null }).rung ?? null;
  return {
    key: row.listing_key,
    group,
    city: input.city ?? '',
    cityRegion: input.cityRegion,
    fsa: fsaOf(input.postalCode),
    subType: input.propertySubType,
    listPrice: numOrNull(row.list_price),
    model: {
      rung,
      borrowed: resolved.borrowed,
      nativeN: resolved.nativeCoefficients.length,
      effectiveN: resolved.effectiveCoefficients.length,
      r2: resolved.r2,
      basePrice: resolved.basePrice,
    },
    live: {
      estimatedValue: live.estimatedValue,
      confidence: live.confidence,
      basis: live.basis,
      engineMode: live.engineMode,
      predictiveSD: live.predictiveSD,
      totalAdjustmentPct: live.totalAdjustmentPct,
      nEff: live.nEff,
      comps: live.comps,
    },
    stored: null,
  };
}

async function attachStored(rows: ProbeRow[]): Promise<void> {
  const keys = rows.map((r) => r.key);
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const { data, error } = await sb
      .from('property_estimates')
      .select('listing_key, estimated_value, confidence, computed_at')
      .in('listing_key', chunk);
    if (error) {
      console.warn(`   ⚠️  property_estimates read failed: ${error.message}`);
      return;
    }
    const byKey = new Map((data ?? []).map((d) => [d.listing_key as string, d]));
    for (const r of rows) {
      const s = byKey.get(r.key);
      if (s) {
        r.stored = {
          estimatedValue: numOrNull(s.estimated_value),
          confidence: (s.confidence as string | null) ?? null,
          computedAt: (s.computed_at as string | null) ?? null,
        };
      }
    }
  }
}

// ── Diff against a baseline ──────────────────────────────────────────────────
const TIER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
type Tier = keyof typeof TIER;

function tierOf(r: ProbeRow): Tier | 'NONE' {
  return r.live.estimatedValue > 0 ? (r.live.confidence as Tier) : 'NONE';
}

function rank(t: Tier | 'NONE'): number {
  return t === 'NONE' ? -1 : TIER[t];
}

function modelLabel(r: ProbeRow): string {
  if (r.model.rung) return r.model.rung;
  if (r.model.borrowed) return 'sibling';
  return r.model.nativeN > 0 ? 'community' : 'none';
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtMap(m: Map<string, number>): string {
  return [...m.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${v}`)
    .join('   ');
}

function diffGroup(group: string, before: ProbeRow[], after: ProbeRow[]): boolean {
  const byKey = new Map(before.map((r) => [r.key, r]));
  const paired = after.filter((r) => byKey.has(r.key)).map((r) => ({ a: r, b: byKey.get(r.key)! }));
  const pubB = paired.filter((p) => p.b.live.estimatedValue > 0).length;
  const pubA = paired.filter((p) => p.a.live.estimatedValue > 0).length;

  const transitions = new Map<string, number>();
  const rungsAfter = new Map<string, number>();
  const basisMoves = new Map<string, number>();
  const pctMoves: number[] = [];
  let down = 0;
  let up = 0;
  let identical = 0;
  for (const { a, b } of paired) {
    const tb = tierOf(b);
    const ta = tierOf(a);
    const k = `${tb}→${ta}`;
    transitions.set(k, (transitions.get(k) ?? 0) + 1);
    if (rank(ta) < rank(tb)) down++;
    if (rank(ta) > rank(tb)) up++;
    const sameValue =
      a.live.estimatedValue === b.live.estimatedValue ||
      (b.live.estimatedValue > 0 && Math.abs(a.live.estimatedValue / b.live.estimatedValue - 1) < 0.001);
    if (ta === tb && sameValue) identical++;
    if (a.live.estimatedValue > 0 && b.live.estimatedValue > 0) {
      pctMoves.push(Math.abs(a.live.estimatedValue / b.live.estimatedValue - 1) * 100);
    }
    const rk = modelLabel(a);
    rungsAfter.set(rk, (rungsAfter.get(rk) ?? 0) + 1);
    if (a.live.basis !== b.live.basis) {
      const bk = `${b.live.basis}→${a.live.basis}`;
      basisMoves.set(bk, (basisMoves.get(bk) ?? 0) + 1);
    }
  }

  // A control listing whose community was already trained must not move at all — the
  // ladder is inert there by construction. One that was borrowing a sibling is judged
  // like the target: it may improve, it may not lose its number or a tier.
  const trainedBefore = paired.filter(({ b }) => modelLabel(b) === 'community');
  const trainedIdentical = trainedBefore.filter(({ a, b }) => {
    const sameValue =
      a.live.estimatedValue === b.live.estimatedValue ||
      (b.live.estimatedValue > 0 && Math.abs(a.live.estimatedValue / b.live.estimatedValue - 1) < 0.001);
    return tierOf(a) === tierOf(b) && sameValue;
  }).length;
  const pass =
    pubA >= pubB && down === 0 && (group !== 'control' || trainedIdentical === trainedBefore.length);
  console.log(`\n── ${group.toUpperCase()}  (${paired.length} paired listings)  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   published        ${pubB} → ${pubA}`);
  console.log(`   confidence       down ${down}   up ${up}   identical ${identical}`);
  if (group === 'control') {
    console.log(`   trained before   ${trainedBefore.length}   identical ${trainedIdentical}`);
  }
  console.log(`   transitions      ${fmtMap(transitions)}`);
  const med = median(pctMoves);
  console.log(
    `   |Δ estimate|     median ${med === null ? 'n/a' : med.toFixed(2) + '%'}   ` +
      `max ${pctMoves.length ? Math.max(...pctMoves).toFixed(2) + '%' : 'n/a'}`
  );
  console.log(`   model after      ${fmtMap(rungsAfter)}`);
  if (basisMoves.size) console.log(`   basis moves      ${fmtMap(basisMoves)}`);
  // Every listing that moved DOWN, with the numbers that explain it.
  for (const { a, b } of paired) {
    const tb = tierOf(b);
    const ta = tierOf(a);
    if (rank(ta) < rank(tb)) {
      console.log(
        `     ↓ ${a.key} ${a.city}/${a.fsa} ${a.subType}: ${tb}→${ta}  ` +
          `sd ${b.live.predictiveSD.toFixed(3)}→${a.live.predictiveSD.toFixed(3)}  ` +
          `basis ${b.live.basis}→${a.live.basis}  nEff ${b.live.nEff}→${a.live.nEff}  ` +
          `model ${modelLabel(b)}(${b.model.effectiveN})→${modelLabel(a)}(${a.model.effectiveN})`
      );
    }
  }
  return pass;
}

function summarize(rows: ProbeRow[]): void {
  for (const group of Object.keys(GROUPS)) {
    const g = rows.filter((r) => r.group === group);
    const pub = g.filter((r) => r.live.estimatedValue > 0).length;
    const tiers = new Map<string, number>();
    const models = new Map<string, number>();
    let storedMatch = 0;
    let storedCompared = 0;
    for (const r of g) {
      const t = tierOf(r);
      tiers.set(t, (tiers.get(t) ?? 0) + 1);
      const mk = modelLabel(r);
      models.set(mk, (models.get(mk) ?? 0) + 1);
      if (r.stored && r.stored.estimatedValue !== null && r.live.estimatedValue > 0) {
        storedCompared++;
        if (r.stored.confidence === r.live.confidence) storedMatch++;
      }
    }
    console.log(
      `   ${group.padEnd(8)} n ${String(g.length).padStart(3)}  published ${String(pub).padStart(3)}  ` +
        `tiers ${fmtMap(tiers)}  model ${fmtMap(models)}  stored-tier-match ${storedMatch}/${storedCompared}`
    );
  }
}

async function main() {
  let head = 'unknown';
  try {
    head = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  console.log(`AVM ladder probe @ ${head}  per-city ${PER_CITY}\n`);

  const rows: ProbeRow[] = [];
  for (const [group, cities] of Object.entries(GROUPS)) {
    for (const city of cities) {
      const sample = await sampleCity(group, city);
      // Small fan-out: each calculateAVM is ~5 queries; keep the DB polite.
      for (let i = 0; i < sample.length; i += 4) {
        const chunk = sample.slice(i, i + 4);
        rows.push(...(await Promise.all(chunk.map((s) => probeOne(group, s.row, s.input)))));
      }
    }
  }
  await attachStored(rows);

  const file: ProbeFile = { ranAt: new Date().toISOString(), head, perCity: PER_CITY, rows };
  writeFileSync(OUT!, JSON.stringify(file, null, 2));
  console.log(`\nwrote ${rows.length} rows → ${OUT}\n`);
  summarize(rows);

  if (BASELINE) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as ProbeFile;
    console.log(`\n══ DIFF vs baseline ${base.head} (${base.ranAt}) ══`);
    let allPass = true;
    for (const group of Object.keys(GROUPS)) {
      const ok = diffGroup(
        group,
        base.rows.filter((r) => r.group === group),
        rows.filter((r) => r.group === group)
      );
      allPass = allPass && ok;
    }
    console.log(`\n${allPass ? '✅ GATE PASSED' : '❌ GATE FAILED'}`);
    process.exitCode = allPass ? 0 : 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
