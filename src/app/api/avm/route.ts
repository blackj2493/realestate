/**
 * AVM API Route
 * 
 * POST /api/avm
 * Accepts AVMInput and returns AVMResult.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { calculateAVM } from '@/lib/avm/calculator';
import { AVMInputSchema } from '@/lib/avm/validation';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { AVMInput } from '@/lib/avm/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate input
    const parseResult = AVMInputSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const v = parseResult.data;
    // The manual calculator doesn't collect square footage / lot width → null
    // (skipped). Treat the supplied property type as both raw and normalized.
    const input: AVMInput = {
      cityRegion: v.cityRegion,
      propertySubType: normalizePropertySubType(v.propertySubType),
      rawPropertySubType: v.propertySubType,
      buildingAreaTotal: null,
      lotWidth: null,
      bedroomsAboveGrade: v.bedroomsAboveGrade,
      bathroomsTotalInteger: v.bathroomsTotalInteger,
      parkingTotal: v.parkingTotal,
      interiorTier: v.interiorTier,
      exteriorTier: v.exteriorTier,
      basementTier: v.basementTier,
    };

    // Use service role client to bypass RLS on raw_vow_sold table
    const supabase = getServiceRoleClient();
    const result = await calculateAVM(supabase, input);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[AVM API]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}