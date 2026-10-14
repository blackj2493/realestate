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
 * Street and proximity walk the whole vote ranking and take the first TRAINED community,
 * so an untrained nearest community no longer ends the search with `via: none`.
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
import { matchCohort, rankVotes, sameCity, type Vote } from '@/lib/reno/resolveArea';

type Via = 'exact-active' | 'exact-sold' | 'street' | 'geocode' | 'proximity' | 'none';
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
        // ignoreUnit: this route resolves a NEIGHBOURHOOD cohort, and every unit in a
        // block shares one. Matching strictly here would strand condo owners who typed
        // their address without a unit — with no number shown, there is nothing to get
        // wrong. Any path that renders a per-home figure must NOT pass this.
        if (h.document.CityRegion && addressesMatch(parsed, cand, { ignoreUnit: true })) {
          const r = answer(h.document.CityRegion, h.document.City, 'exact-active');
          if (r) return r;
        }
      }
    } catch (err) {
      console.error('[api/reno/resolve-area] active exact match failed:', err);
    }

    const sold =
      (await getSoldPublicByAddress(parsed, { ignoreUnit: true })) ??
      (await getSoldPublicByAddressLoose(parsed));
    // The loose lookup matches street number + name only (postal is stripped above), so
    // check the record is in the city the user typed or the geocoder found.
    if (sold?.cityRegion && (sameCity(sold.city, parsed.city) || sameCity(sold.city, geoCity))) {
      const r = answer(sold.cityRegion, sold.city, 'exact-sold');
      if (r) return r;
    }
  }

  // 3. GEOCODE neighbourhood — Mapbox's community for the point. BEFORE the feed-based
  // street/proximity votes so the reno tool matches the /address profile page (which
  // resolves no-record addresses via the geocoded neighbourhood). Our own OLDER feed
  // records near a reclassified pocket can still say the wrong community — that's the
  // Bleasdale → Fletcher's-Meadow case: geocode says "Northwest Brampton", the feed vote
  // said "Fletcher's Meadow". Trust the point's neighbourhood over stale nearby records.
  if (geoNbhd) {
    const r = answer(geoNbhd, geoCity, 'geocode');
    if (r) return r;
  }

  // 4. STREET MATCH — same-street listings share one community (fallback when the
  // geocoded neighbourhood doesn't map to a trained cohort).
  const streetQ = parsed?.streetName ?? '';
  if (hasGeo && streetQ.length >= 3) {
    const [aS, sS] = await Promise.all([
      nearbyActiveVotes(client, lat, lng, streetQ, 3),
      getSoldAreaVotes(lat, lng, 3, 25, streetQ),
    ]);
    for (const w of rankVotes(aS, sS)) {
      const r = answer(w.cityRegion, w.city, 'street');
      if (r) return r;
    }
  }

  // 5. PROXIMITY — nearest sold (dense) + active.
  if (hasGeo) {
    const [aP, sP] = await Promise.all([nearbyActiveVotes(client, lat, lng, '', 3), getSoldAreaVotes(lat, lng, 1.5, 20)]);
    // Walk the whole ranking: the nearest community may have no trained cohort.
    for (const w of rankVotes(aP, sP)) {
      const r = answer(w.cityRegion, w.city, 'proximity');
      if (r) return r;
    }
  }

  return NextResponse.json({ cityRegion: null, city: null, via: 'none' as Via });
}
