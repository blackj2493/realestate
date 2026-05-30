/**
 * Hidden Equity API Route — GATED
 *
 * POST /api/avm/hidden-equity
 * Requires authentication. Accepts AVMInput (+ optional buildingAreaTotal) and
 * returns both the AVM estimate and the Phase-1 value-add report.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { calculateAVM } from '@/lib/avm/calculator';
import { fetchValueAddReport } from '@/lib/avm/valueAdd/engine';
import { AVMInputSchema } from '@/lib/avm/validation';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { AVMInput } from '@/lib/avm/types';

export async function POST(req: NextRequest) {
  // Auth gate — must be first
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const parsed = AVMInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const v = parsed.data;

    // buildingAreaTotal flows through the schema (positive number | null | undefined).
    // Coerce undefined → null so AVMInput gets the right type.
    const buildingAreaTotal: number | null = v.buildingAreaTotal ?? null;

    const input: AVMInput = {
      cityRegion: v.cityRegion,
      city: v.city ?? null,
      propertySubType: normalizePropertySubType(v.propertySubType),
      rawPropertySubType: v.propertySubType,
      buildingAreaTotal,
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

    return NextResponse.json({ estimate, valueAdd });
  } catch (err) {
    console.error('[avm/hidden-equity]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
