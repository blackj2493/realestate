/**
 * Hidden Equity API Route — SOFT-GATED (VOW posture B)
 *
 * POST /api/avm/hidden-equity
 *  - Anonymous / non-consumer → { locked: true, catalog }  (non-VOW move list
 *    + cost ranges; NO AVM run, NO VOW reads, NO DB work). Powers the public
 *    funnel teaser.
 *  - Consumer (signed in, + Terms when enforced) → { locked: false, estimate,
 *    valueAdd }  (the existing /hidden-equity tool reads these).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { getConsumer } from '@/lib/auth/requireConsumer';
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

  // SOFT GATE: non-consumers get the non-VOW teaser. No AVM/VOW touched.
  const { isConsumer } = await getConsumer();

  if (!isConsumer) {
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

    return NextResponse.json({ locked: false, estimate, valueAdd });
  } catch (err) {
    console.error('[avm/hidden-equity]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
