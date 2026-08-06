/**
 * GET /api/reno/for-sale?lat=&lng=&type=
 *
 * FREE, non-VOW bridge for the renovation-upside tool: active IDX listings for
 * sale near a point, optionally narrowed to a property type. Straight passthrough
 * of getNearbyForSale (active `properties` collection, public search key) — no
 * sold/VOW data is touched here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getNearbyForSale, type NearbyListing } from '@/lib/address/nearbyForSale';

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  const type = req.nextUrl.searchParams.get('type')?.trim() ?? '';

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  try {
    const nearby = await getNearbyForSale(lat, lng, { radiusKm: 5, limit: 12, transactionType: 'sale' });
    let listings: NearbyListing[] = nearby?.listings ?? [];

    // Narrow to the chosen type only when it leaves a useful set; otherwise keep
    // all nearby actives (a thin exact-type match is worse than "homes near you").
    if (type) {
      const t = type.toLowerCase();
      const filtered = listings.filter((l) => (l.subType ?? '').toLowerCase() === t);
      if (filtered.length >= 3) listings = filtered;
    }

    return NextResponse.json({ listings });
  } catch (err) {
    console.error('[api/reno/for-sale]', err);
    return NextResponse.json({ listings: [] });
  }
}
