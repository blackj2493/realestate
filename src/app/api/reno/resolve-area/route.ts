/**
 * GET /api/reno/resolve-area?lat=&lng=
 *
 * Pins a geocoded point to its MLS community (CityRegion) by a proximity-weighted
 * VOTE across nearby SOLD records (dense, per-house — the reliable signal) PLUS
 * active listings. Returns ONLY taxonomy labels ({ city, cityRegion }); no price,
 * address, date, or count is ever returned, so nothing about any individual sale
 * is disclosed.
 *
 * Why sold: live inventory is sparse, so a couple of for-sale homes just over a
 * community line can swing the guess (the "Fletcher's Meadow" mis-resolve). Sold
 * data is far denser, so the nearest records are almost always the same streets.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTypesenseClient } from '@/lib/typesense/client';
import { getSoldAreaVotes } from '@/lib/address/soldNearPoint';

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  // Active (IDX) nearest — CityRegion + City, nearest-first.
  const activeVotes: Array<{ cr: string; city?: string }> = [];
  try {
    const res = (await getTypesenseClient()
      .collections('properties')
      .documents()
      .search({
        q: '*',
        query_by: 'City',
        filter_by: `location:(${lat}, ${lng}, 3 km)`,
        sort_by: `location(${lat}, ${lng}):asc`,
        include_fields: 'CityRegion,City,location',
        per_page: 12,
      })) as { hits?: Array<{ document: { CityRegion?: string; City?: string } }> };
    for (const h of res.hits ?? []) {
      if (h.document.CityRegion) activeVotes.push({ cr: h.document.CityRegion, city: h.document.City });
    }
  } catch (err) {
    console.error('[api/reno/resolve-area] active query failed:', err);
  }

  // Sold (dense) nearest — CityRegion only.
  const soldVotes = await getSoldAreaVotes(lat, lng, 1.5, 20);

  // Weighted vote: nearer counts more; sold carries extra weight (denser + per-house).
  const score = new Map<string, number>();
  const cityFor = new Map<string, string>();
  soldVotes.forEach((cr, i) => {
    score.set(cr, (score.get(cr) ?? 0) + (soldVotes.length - i) * 1.4);
  });
  activeVotes.forEach((v, i) => {
    score.set(v.cr, (score.get(v.cr) ?? 0) + (activeVotes.length - i));
    if (v.city && !cityFor.has(v.cr)) cityFor.set(v.cr, v.city);
  });

  let best: string | null = null;
  let bestScore = -1;
  for (const [cr, s] of score) {
    if (s > bestScore) {
      best = cr;
      bestScore = s;
    }
  }

  if (!best) return NextResponse.json({ cityRegion: null, city: null });
  return NextResponse.json({ cityRegion: best, city: cityFor.get(best) ?? null });
}
