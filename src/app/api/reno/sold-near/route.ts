/**
 * GET /api/reno/sold-near?lat=&lng=
 *
 * The gated "Sold near you" hook for the renovation-upside tool. The gate is
 * STRUCTURAL (mirrors soldNearPoint.ts): a non-consumer only ever triggers
 * getSoldNearSummary (counts + coarse points — NO address/price/date leaves
 * Typesense), while getSoldNearGated (VOW rows) runs ONLY inside the confirmed
 * isConsumer branch. Consumers get SimilarSoldCard rows the client can hand
 * straight to <SoldCompCard/>; anon gets the count so the client can render the
 * standard locked-card teaser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConsumer } from '@/lib/auth/requireConsumer';
import { getSoldNearGated, getSoldNearSummary } from '@/lib/address/soldNearPoint';
import type { SimilarSoldCard } from '@/app/api/properties/[id]/similar/route';

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  const { isConsumer } = await getConsumer();

  // ── ANON: counts only — NO VOW fetch. ──
  if (!isConsumer) {
    const summary = await getSoldNearSummary(lat, lng);
    return NextResponse.json({
      locked: true,
      count30: summary?.count30 ?? 0,
      count90: summary?.count90 ?? 0,
    });
  }

  // ── CONSUMER: full VOW rows, mapped to the card view model. ──
  const gated = await getSoldNearGated(lat, lng);
  const cards: SimilarSoldCard[] = (gated?.events ?? []).map((e) => ({
    id: e.id,
    address: e.address,
    city: null,
    closePrice: e.closePrice,
    listPrice: null,
    soldDate: e.soldDateMs ? new Date(e.soldDateMs).toISOString() : null,
    beds: e.beds,
    bedsAbove: e.beds, // SoldNearEvent carries only BedroomsTotal; treat as above-grade
    bedsBelow: 0,
    baths: e.baths,
    propertySubType: e.subType,
    brokerage: e.brokerage,
    thumb: e.imageUrl,
    pctOfAsk: null, // per-event ratio not exposed; the aggregate is medianClose/closeToAsk
    why: '',
    deltas: [],
  }));

  return NextResponse.json({
    locked: false,
    cards,
    count90: gated?.count90 ?? 0,
    medianClose90: gated?.medianClose90 ?? null,
  });
}
