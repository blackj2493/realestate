/**
 * GET /api/reno/cohort?lat=&lng=
 *
 * "What homes sell (and rent) for here" for the renovation tool — the SAME beds × type
 * grids the listing and address pages render (getBestTypicalPrices / getBestTypicalRents
 * over the adaptive 2 km→5 km pool), returned whole so the tool can show the table
 * rather than assert a size.
 *
 * Why the whole grid: the tool models a TYPICAL home (3 bed / 2 bath) unless the owner
 * opens "Add your details", so we genuinely do not know how big their home is. Quoting a
 * single median was wrong for anyone bigger or smaller; the grid lets the owner find
 * their own row, and it is the same artefact they'll meet on any listing page.
 *
 * GATE: structural and inherited — getBestTypical* only touch VOW closes inside their
 * own isConsumer branch; anonymous callers get IDX asking medians, which the response
 * labels as such (`source: 'asking'`). No AI anywhere in the path (§4).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConsumer } from '@/lib/auth/requireConsumer';
import { getBestTypicalPrices } from '@/lib/address/soldPrices';
import { getBestTypicalRents } from '@/lib/address/leasedRents';
import type { RenoCohort } from '@/lib/reno/cohort';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const lat = Number(p.get('lat'));
  const lng = Number(p.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  try {
    const { isConsumer } = await getConsumer();
    const [prices, rents] = await Promise.all([
      getBestTypicalPrices(lat, lng, isConsumer),
      getBestTypicalRents(lat, lng, isConsumer),
    ]);

    const body: RenoCohort = {
      sell: prices?.matrix ? { matrix: prices.matrix, radiusKm: prices.radiusKm, source: prices.source } : null,
      rent: rents?.matrix ? { matrix: rents.matrix, radiusKm: rents.radiusKm, source: rents.source } : null,
    };
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[reno/cohort]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
