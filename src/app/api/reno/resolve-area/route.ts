/**
 * GET /api/reno/resolve-area?lat=&lng=&street=
 *
 * Pins a geocoded point to its MLS community (CityRegion). Strategy, in order:
 *   1. STREET MATCH (definitive) — listings whose address is on the SAME street
 *      near the point. Every home on a given street shares one MLS community, so
 *      this fixes the boundary/reclassification errors a radius vote produces
 *      (e.g. a new NW-Brampton street landing in the older "Fletcher's Meadow"
 *      because nearby older sold comps are filed there).
 *   2. PROXIMITY VOTE (fallback) — nearest SOLD (dense) + active listings.
 *
 * Returns ONLY taxonomy labels ({ city, cityRegion }); no price/address/date/count
 * is ever returned, so nothing about any individual sale is disclosed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTypesenseClient } from '@/lib/typesense/client';
import { getSoldAreaVotes } from '@/lib/address/soldNearPoint';

type Vote = { cr: string; city?: string };

function pickWinner(active: Vote[], sold: string[]): { cityRegion: string | null; city: string | null } {
  const score = new Map<string, number>();
  const cityFor = new Map<string, string>();
  // Sold weighted higher (denser, per-house); nearer counts more within each source.
  sold.forEach((cr, i) => score.set(cr, (score.get(cr) ?? 0) + (sold.length - i) * 1.4));
  active.forEach((v, i) => {
    score.set(v.cr, (score.get(v.cr) ?? 0) + (active.length - i));
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
  return best ? { cityRegion: best, city: cityFor.get(best) ?? null } : { cityRegion: null, city: null };
}

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  const street = (req.nextUrl.searchParams.get('street') ?? '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  const client = getTypesenseClient();

  // Active (IDX) listings near the point, optionally matching a street name.
  const activeVotes = async (queryStr: string, radiusKm: number): Promise<Vote[]> => {
    const votes: Vote[] = [];
    try {
      const res = (await client
        .collections('properties')
        .documents()
        .search({
          q: queryStr && queryStr.length >= 3 ? queryStr : '*',
          query_by: 'UnparsedAddress,City',
          filter_by: `location:(${lat}, ${lng}, ${radiusKm} km)`,
          sort_by: `location(${lat}, ${lng}):asc`,
          include_fields: 'CityRegion,City,location',
          per_page: 25,
        })) as { hits?: Array<{ document: { CityRegion?: string; City?: string } }> };
      for (const h of res.hits ?? []) {
        if (h.document.CityRegion) votes.push({ cr: h.document.CityRegion, city: h.document.City });
      }
    } catch (err) {
      console.error('[api/reno/resolve-area] active query failed:', err);
    }
    return votes;
  };

  // 1) STREET MATCH — same-street listings are filed under one community.
  if (street.length >= 3) {
    const [aStreet, sStreet] = await Promise.all([
      activeVotes(street, 3),
      getSoldAreaVotes(lat, lng, 3, 25, street),
    ]);
    if (aStreet.length + sStreet.length >= 2) {
      const winner = pickWinner(aStreet, sStreet);
      if (winner.cityRegion) return NextResponse.json(winner);
    }
  }

  // 2) PROXIMITY fallback — nearest sold (dense) + active.
  const [aProx, sProx] = await Promise.all([activeVotes('', 3), getSoldAreaVotes(lat, lng, 1.5, 20)]);
  return NextResponse.json(pickWinner(aProx, sProx));
}
