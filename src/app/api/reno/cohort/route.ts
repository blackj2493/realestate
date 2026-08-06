/**
 * GET /api/reno/cohort?lat=&lng=&type=<PropertySubType>&beds=<n>
 *
 * "What homes LIKE YOURS actually trade for" for the renovation tool — the same
 * beds × type grid the listing and address pages render (getBestTypicalPrices /
 * getBestTypicalRents over the adaptive 2 km→5 km pool), reduced to the ONE cell that
 * matches the home being modelled, for both the sale and the rent side.
 *
 * Why it exists: the tool's ceiling and market card were quoting an area-wide median
 * (and an AVM band built for a typical 3 bed / 2 bath), which is wrong for anyone whose
 * home is bigger or smaller. This scopes both numbers to the caller's own bedroom count
 * and property type, and reports how close the match is (`basis`) so the UI can be honest.
 *
 * GATE: structural and inherited — getBestTypical* only touch VOW closes inside their
 * own isConsumer branch; anonymous callers get IDX asking medians, which the response
 * labels as such (`soldSource: 'asking'`). No AI anywhere in the path (§4).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConsumer } from '@/lib/auth/requireConsumer';
import { getBestTypicalPrices } from '@/lib/address/soldPrices';
import { getBestTypicalRents } from '@/lib/address/leasedRents';
import { pickCohortCell, type RenoCohort } from '@/lib/reno/cohort';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const lat = Number(p.get('lat'));
  const lng = Number(p.get('lng'));
  const type = (p.get('type') || '').trim();
  const beds = Number(p.get('beds'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }
  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 });

  const wantBeds = Number.isFinite(beds) ? beds : 3;

  try {
    const { isConsumer } = await getConsumer();
    const [prices, rents] = await Promise.all([
      getBestTypicalPrices(lat, lng, isConsumer),
      getBestTypicalRents(lat, lng, isConsumer),
    ]);

    const body: RenoCohort = {
      sold: pickCohortCell(prices?.matrix, type, wantBeds),
      soldSource: prices?.source ?? null,
      rent: pickCohortCell(rents?.matrix, type, wantBeds),
      rentSource: rents?.source ?? null,
      radiusKm: prices?.radiusKm ?? rents?.radiusKm ?? null,
    };
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[reno/cohort]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
