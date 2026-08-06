/**
 * GET /api/reno/resolve-area?address=&lat=&lng=
 *
 * Pins an address to its MLS community (CityRegion). Ladder (mirrors the proven
 * /address profile resolution so the reno tool agrees with the profile page):
 *   1. EXACT-ADDRESS record (definitive) — the property's OWN feed CityRegion, from
 *      a live listing or a sold/off-market record at that exact civic address.
 *   2. STREET MATCH — any listing on the same street (one community per street).
 *   3. PROXIMITY VOTE — nearest sold (dense) + active listings (needs lat/lng).
 *
 * The response carries `via` (which rung answered) purely for diagnosis — it is not
 * VOW data. Returns ONLY taxonomy labels ({ city, cityRegion }); no price/address/
 * date/count is ever returned.
 *
 * IMPORTANT: we strip the postal before matching. The /address profile matches with
 * civic + city + street (no postal) and resolves correctly; `addressesMatch` (and the
 * loose matcher) SHORT-CIRCUIT to fail on any postal mismatch, so feeding the geocoded
 * postal — which can differ from the feed record's — made the exact match miss and drop
 * to the wrong proximity guess (the Fletcher's-Meadow bug).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTypesenseClient } from '@/lib/typesense/client';
import { getSoldAreaVotes } from '@/lib/address/soldNearPoint';
import { getSoldPublicByAddress, getSoldPublicByAddressLoose } from '@/lib/sold/soldByKey';
import { parseAddress, addressesMatch } from '@/lib/watchlist/disposition';

type Vote = { cr: string; city?: string };
type Via = 'exact-active' | 'exact-sold' | 'street' | 'proximity' | 'none';

function pickWinner(active: Vote[], sold: string[]): { cityRegion: string | null; city: string | null } {
  const score = new Map<string, number>();
  const cityFor = new Map<string, string>();
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
  const latRaw = Number(req.nextUrl.searchParams.get('lat'));
  const lngRaw = Number(req.nextUrl.searchParams.get('lng'));
  const hasGeo = Number.isFinite(latRaw) && Number.isFinite(lngRaw);
  const lat = hasGeo ? latRaw : 0;
  const lng = hasGeo ? lngRaw : 0;
  const address = (req.nextUrl.searchParams.get('address') ?? '').trim();

  if (!hasGeo && !address) {
    return NextResponse.json({ error: 'address or lat/lng required' }, { status: 400 });
  }

  const client = getTypesenseClient();

  // ── 1. EXACT-ADDRESS record — the property's own feed CityRegion (authoritative). ──
  // Strip the postal: match civic + city + street like the /address profile does.
  const parsed = address ? parseAddress(address) : null;
  if (parsed) parsed.postal = '';
  if (parsed?.streetNumber && parsed?.streetName) {
    // Active listing at this exact address.
    try {
      const res = (await client.collections('properties').documents().search({
        q: `${parsed.streetNumber} ${parsed.streetName}`.trim(),
        query_by: 'UnparsedAddress',
        include_fields: 'UnparsedAddress,CityRegion,City',
        per_page: 15,
      })) as { hits?: Array<{ document: { UnparsedAddress?: string; CityRegion?: string; City?: string } }> };
      for (const h of res.hits ?? []) {
        const cand = parseAddress(h.document.UnparsedAddress ?? '');
        cand.postal = '';
        if (h.document.CityRegion && addressesMatch(parsed, cand)) {
          return NextResponse.json({ cityRegion: h.document.CityRegion, city: h.document.City ?? null, via: 'exact-active' as Via });
        }
      }
    } catch (err) {
      console.error('[api/reno/resolve-area] active exact match failed:', err);
    }

    // Sold / off-market record at this exact address (dense history; the profile path).
    const sold = (await getSoldPublicByAddress(parsed)) ?? (await getSoldPublicByAddressLoose(parsed));
    if (sold?.cityRegion) {
      return NextResponse.json({ cityRegion: sold.cityRegion, city: sold.city || null, via: 'exact-sold' as Via });
    }
  }

  // Fallbacks need coordinates.
  if (!hasGeo) return NextResponse.json({ cityRegion: null, city: null, via: 'none' as Via });

  const activeVotes = async (queryStr: string, radiusKm: number): Promise<Vote[]> => {
    const votes: Vote[] = [];
    try {
      const res = (await client.collections('properties').documents().search({
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

  const streetQ = parsed?.streetName ?? '';

  // ── 2. STREET MATCH — same-street listings share one community. ──
  if (streetQ.length >= 3) {
    const [aStreet, sStreet] = await Promise.all([
      activeVotes(streetQ, 3),
      getSoldAreaVotes(lat, lng, 3, 25, streetQ),
    ]);
    if (aStreet.length + sStreet.length >= 2) {
      const winner = pickWinner(aStreet, sStreet);
      if (winner.cityRegion) return NextResponse.json({ ...winner, via: 'street' as Via });
    }
  }

  // ── 3. PROXIMITY fallback — nearest sold (dense) + active. ──
  const [aProx, sProx] = await Promise.all([activeVotes('', 3), getSoldAreaVotes(lat, lng, 1.5, 20)]);
  const winner = pickWinner(aProx, sProx);
  return NextResponse.json({ ...winner, via: (winner.cityRegion ? 'proximity' : 'none') as Via });
}
