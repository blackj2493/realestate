/**
 * Throwaway probe: run the new AVM against a list of listing keys and print
 * estimate + band + basis. Use to verify the Phase 1 anchor pipeline before
 * the dev server is up. DELETE this file after the run.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import * as https from 'https';
import crossFetch from 'cross-fetch';
import { mapListingToAVMInput } from '@/lib/avm/mapListingToAVMInput';
import { calculateAVM } from '@/lib/avm/calculator';
import type { AVMResult } from '@/lib/avm/types';
import type { RoomData } from '@/lib/room-utils';
import { resolveLivingArea, type BucketCalibration } from '@/lib/avm/livingArea';

const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option
  crossFetch(url, { ...init, agent })) as typeof fetch;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing env');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Targets from the plan's verification list.
const KEYS = ['W13168260', 'N13135326'];

async function probe(key: string) {
  const { data: row, error } = await sb
    .from('listings')
    .select('listing_key, list_price, full_payload')
    .eq('listing_key', key)
    .maybeSingle();

  if (error || !row) {
    console.log(`\n── ${key} — NOT FOUND in listings table\n`);
    return;
  }

  const payload = row.full_payload as Record<string, unknown>;
  const listPrice = Number(row.list_price);
  const rooms: RoomData[] = Array.isArray(payload?.rooms) ? (payload.rooms as RoomData[]) : [];

  // Calibration fallback for GLA — match what getListingDetail does.
  let bucketCalibration: BucketCalibration | null = null;
  const cityRegion = String(payload?.CityRegion ?? '').trim();
  const subType = String(payload?.PropertySubType ?? '').trim();
  const bucket = String(payload?.LivingAreaRange ?? '').trim();
  if (cityRegion && subType && bucket && resolveLivingArea(payload, { rooms }).source === 'range_midpoint') {
    const { data: cal } = await sb
      .from('avm_sqft_calibration')
      .select('median_gla, sample_count')
      .eq('city_region', cityRegion)
      .ilike('property_sub_type', subType)
      .eq('living_area_range', bucket)
      .maybeSingle();
    if (cal && Number(cal.median_gla) > 0) {
      bucketCalibration = { medianGla: Number(cal.median_gla), sampleCount: Number(cal.sample_count) };
    }
  }

  const input = mapListingToAVMInput(payload, { rooms, bucketCalibration });
  if (!input) {
    console.log(`\n── ${key} — mapListingToAVMInput returned null (missing CityRegion or PropertySubType)\n`);
    return;
  }

  const t0 = Date.now();
  const r: AVMResult = await calculateAVM(sb, input);
  const ms = Date.now() - t0;

  const address = String(payload?.UnparsedAddress ?? '(no address)');
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString();

  console.log(`\n── ${key} — ${address}`);
  console.log(`   List: ${fmt(listPrice)}   ·   ${input.city ?? '(no city)'} / ${input.cityRegion} / ${input.propertySubType}`);
  console.log(`   Estimate: ${r.estimatedValue > 0 ? fmt(r.estimatedValue) : 'UNAVAILABLE'}`);
  if (r.estimatedValue > 0) {
    console.log(`   Range:    ${fmt(r.lowBand)} – ${fmt(r.highBand)}    (±${(r.predictiveSD * 100).toFixed(1)}%)`);
  }
  console.log(`   Anchor:   ${fmt(r.anchorPrice)}    adj=${(r.totalAdjustmentPct * 100).toFixed(1)}%`);
  console.log(`   Basis:    ${r.basis}   ·   comps=${r.comps}   ·   nEff=${r.nEff}   ·   confidence=${r.confidence}`);
  console.log(`   R²: ${r.r2Score?.toFixed(2) ?? 'n/a'}   ·   engine: ${r.engineMode}   ·   latency: ${ms} ms`);
}

(async () => {
  console.log(`Probing ${KEYS.length} listings via the new AVM pipeline…`);
  for (const k of KEYS) await probe(k);
})().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
