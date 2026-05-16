/**
 * AVM API Route
 * 
 * POST /api/avm
 * Accepts AVMInput and returns AVMResult.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient, getServiceRoleClient } from '@/lib/supabase/client';
import { calculateAVM } from '@/lib/avm/calculator';
import { AVMInputSchema } from '@/lib/avm/validation';

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

    const input = parseResult.data;

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