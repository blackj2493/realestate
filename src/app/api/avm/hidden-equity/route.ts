/**
 * Hidden Equity API Route — SOFT-GATED (VOW posture B)
 *
 * POST /api/avm/hidden-equity
 *  - Anonymous / non-consumer → { locked: true, catalog, seats }  (non-VOW move list
 *    + cost ranges; NO AVM run, NO VOW reads). Powers the public funnel teaser.
 *  - Consumer (signed in, + Terms when enforced) → { locked: false, estimate,
 *    valueAdd, seat, seats }  (estimate/valueAdd unchanged — the existing
 *    /hidden-equity tool reads these).
 *
 * Both branches carry `seats`, the founding-seat counter. That is a COUNT(*) on
 * founding_seats — our own table, no VOW data — so the anonymous branch still reads
 * nothing sensitive, though it is no longer entirely free of DB work. The consumer
 * branch also GRANTS the seat: taking it here, on the first unlocked result, is what
 * lets the offer ask for a sign-in and nothing else. See src/lib/founding/seats.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { getConsumer } from '@/lib/auth/requireConsumer';
import { claimSeat, getSeatSummary } from '@/lib/founding/seats';
import { calculateAVM } from '@/lib/avm/calculator';
import { fetchValueAddReport } from '@/lib/avm/valueAdd/engine';
import { buildAnonCatalog } from '@/lib/avm/valueAdd/anonCatalog';
import { AVMInputSchema } from '@/lib/avm/validation';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { AVMInput } from '@/lib/avm/types';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AVMInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const v = parsed.data;

  // The ?ref= campaign tag, carried in the body so we can tell which seats came from
  // which send. Read off the RAW body: AVMInputSchema strips keys it doesn't model.
  const source =
    typeof (body as { source?: unknown }).source === 'string'
      ? (body as { source: string }).source.slice(0, 40)
      : null;

  // SOFT GATE: non-consumers get the non-VOW teaser. No AVM/VOW touched.
  const { user, isConsumer } = await getConsumer();
  const seatClient = getServiceRoleClient();

  if (!isConsumer) {
    // The teaser carries the seat COUNT only — never a seat number, since an
    // anonymous visitor holds nothing. This is what the locked strip renders.
    return NextResponse.json({
      ...buildAnonCatalog({
        basementTier: v.basementTier,
        interiorTier: v.interiorTier,
        exteriorTier: v.exteriorTier,
        bathroomsTotalInteger: v.bathroomsTotalInteger,
        bedroomsAboveGrade: v.bedroomsAboveGrade,
        parkingTotal: v.parkingTotal,
        buildingAreaTotal: v.buildingAreaTotal ?? null,
        // Without this the teaser offered condo owners a basement to finish.
        propertySubType: v.propertySubType,
      }),
      seats: await getSeatSummary(seatClient),
    });
  }

  // CONSUMER: full VOW-derived report.
  try {
    const input: AVMInput = {
      cityRegion: v.cityRegion,
      city: v.city ?? null,
      propertySubType: normalizePropertySubType(v.propertySubType),
      rawPropertySubType: v.propertySubType,
      buildingAreaTotal: v.buildingAreaTotal ?? null,
      lotWidth: null,
      bedroomsAboveGrade: v.bedroomsAboveGrade,
      bathroomsTotalInteger: v.bathroomsTotalInteger,
      parkingTotal: v.parkingTotal,
      interiorTier: v.interiorTier,
      exteriorTier: v.exteriorTier,
      basementTier: v.basementTier,
    };

    const supabase = getServiceRoleClient();
    const estimate = await calculateAVM(supabase, input);

    let valueAdd = null;
    if (estimate.estimatedValue > 0) {
      valueAdd = await fetchValueAddReport(supabase, input, {
        subjectEstimate: estimate.estimatedValue,
        predSD: estimate.predictiveSD,
      });
    }

    // The seat is taken HERE — on the first unlocked result — rather than behind a
    // claim button, so signing in is the only action the offer ever asks for. Repeat
    // runs return the seat they already hold (claimSeat selects before inserting).
    const { seat, seats } = user
      ? await claimSeat(seatClient, {
          userId: user.id,
          email: user.email ?? null,
          source,
          city: v.city ?? null,
          cityRegion: v.cityRegion,
        })
      : { seat: null, seats: await getSeatSummary(seatClient) };

    return NextResponse.json({ locked: false, estimate, valueAdd, seat, seats });
  } catch (err) {
    console.error('[avm/hidden-equity]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
