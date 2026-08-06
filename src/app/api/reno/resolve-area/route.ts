/**
 * GET /api/reno/resolve-area?address=&lat=&lng=
 *
 * Pins an address to a TRAINED cohort community. Self-sufficient: given an address it
 * geocodes server-side for accurate coords + the Mapbox neighbourhood, so it works with
 * `?address=` alone. Every candidate is VALIDATED against the live cohort tree, and the
 * first candidate that maps to a real cohort wins — so we never return a community the
 * tool can't model. Ladder, most-authoritative first:
 *   1. exact-active  — a live listing at the exact address → its feed CityRegion
 *   2. exact-sold    — a sold/off-market record at the exact address (the /address path)
 *   3. street        — same-street listings (one community per street)
 *   4. geocode       — Mapbox's neighbourhood for the point (covers homes with no record)
 *   5. proximity     — nearest sold (dense) + active vote
 *
 * `via` reports which rung answered (diagnosis; not VOW). Returns ONLY taxonomy labels
 * ({ city, cityRegion }); no price/address/date/count is ever returned. Postal is stripped
 * before matching (addressesMatch short-circuits on postal mismatch — the /address profile
 * matches postal-less, and Mapbox's rooftop postal can differ from the feed's).
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Client } from 'typesense';
import { getTypesenseClient } from '@/lib/typesense/client';
import { getSoldAreaVotes } from '@/lib/address/soldNearPoint';
import { getSoldPublicByAddress, getSoldPublicByAddressLoose } from '@/lib/sold/soldByKey';
import { parseAddress, addressesMatch } from '@/lib/watchlist/disposition';
import { geocodeCached } from '@/lib/address/resolveProfile';
import { loadCohortTreeSafe } from '@/lib/avm/loadCohortTree';
import { normalizeCityRegion, type CohortTree } from '@/lib/avm/cohorts';

type Via = 'exact-active' | 'exact-sold' | 'street' | 'geocode' | 'proximity' | 'none';
type Vote = { cr: string; city?: string };

/** Map a raw (city, cityRegion) to a trained cohort — community match across the whole
 *  tree (more specific than City; immune to the City:=Toronto quirk), preferring a city match. */
function matchCohort(
  tree: CohortTree,
  city: string | undefined,
  cityRegion: string | undefined,
): { city: string; cityRegion: string } | null {
  if (!cityRegion) return null;
  const target = normalizeCityRegion(cityRegion).trim().toLowerCase();
  if (!target) return null;
  const lc = (city ?? '').trim().toLowerCase();
  let fallback: { city: string; cityRegion: string } | null = null;
  for (const [c, comms] of Object.entries(tree)) {
    for (const cm of comms) {
      if (normalizeCityRegion(cm.cityRegion).trim().toLowerCase() === target) {
        if (c.toLowerCase() === lc) return { city: c, cityRegion: cm.cityRegion };
        fallback ??= { city: c, cityRegion: cm.cityRegion };
      }
    }
  }
  return fallback;
}

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

async function nearbyActiveVotes(client: Client, lat: number, lng: number, queryStr: string, radiusKm: number): Promise<Vote[]> {
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
}

export async function GET(req: NextRequest) {
  let lat = Number(req.nextUrl.searchParams.get('lat'));
  let lng = Number(req.nextUrl.searchParams.get('lng'));
  const address = (req.nextUrl.searchParams.get('address') ?? '').trim();

  if (!address && !(Number.isFinite(lat) && Number.isFinite(lng))) {
    return NextResponse.json({ error: 'address or lat/lng required' }, { status: 400 });
  }

  // Server-side geocode → accurate coords (so ?address= works alone) + Mapbox neighbourhood.
  let geoNbhd: string | null = null;
  let geoCity: string | null = null;
  if (address) {
    const geo = await geocodeCached(address);
    if (geo) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        lat = geo.lat;
        lng = geo.lng;
      }
      geoNbhd = geo.cityRegion;
      geoCity = geo.city;
    }
  }
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);

  const tree = await loadCohortTreeSafe();
  const client = getTypesenseClient();

  const answer = (cr: string | null | undefined, city: string | null | undefined, via: Via) => {
    if (!cr) return null;
    const m = matchCohort(tree, city ?? undefined, cr);
    return m ? NextResponse.json({ cityRegion: m.cityRegion, city: m.city, via }) : null;
  };

  const parsed = address ? parseAddress(address) : null;
  if (parsed) parsed.postal = ''; // match civic+city+street like the /address profile

  // 1 & 2. EXACT-ADDRESS record → the property's own feed CityRegion.
  if (parsed?.streetNumber && parsed?.streetName) {
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
          const r = answer(h.document.CityRegion, h.document.City, 'exact-active');
          if (r) return r;
        }
      }
    } catch (err) {
      console.error('[api/reno/resolve-area] active exact match failed:', err);
    }

    const sold = (await getSoldPublicByAddress(parsed)) ?? (await getSoldPublicByAddressLoose(parsed));
    if (sold?.cityRegion) {
      const r = answer(sold.cityRegion, sold.city, 'exact-sold');
      if (r) return r;
    }
  }

  // 3. STREET MATCH — same-street listings share one community.
  const streetQ = parsed?.streetName ?? '';
  if (hasGeo && streetQ.length >= 3) {
    const [aS, sS] = await Promise.all([
      nearbyActiveVotes(client, lat, lng, streetQ, 3),
      getSoldAreaVotes(lat, lng, 3, 25, streetQ),
    ]);
    if (aS.length + sS.length >= 1) {
      const w = pickWinner(aS, sS);
      const r = answer(w.cityRegion, w.city, 'street');
      if (r) return r;
    }
  }

  // 4. GEOCODE neighbourhood — Mapbox's community for the point (covers no-record homes).
  if (geoNbhd) {
    const r = answer(geoNbhd, geoCity, 'geocode');
    if (r) return r;
  }

  // 5. PROXIMITY — nearest sold (dense) + active.
  if (hasGeo) {
    const [aP, sP] = await Promise.all([nearbyActiveVotes(client, lat, lng, '', 3), getSoldAreaVotes(lat, lng, 1.5, 20)]);
    const w = pickWinner(aP, sP);
    const r = answer(w.cityRegion, w.city, 'proximity');
    if (r) return r;
  }

  return NextResponse.json({ cityRegion: null, city: null, via: 'none' as Via });
}
