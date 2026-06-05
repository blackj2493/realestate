import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { loadCohortTree } from '@/lib/avm/loadCohortTree';

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    const tree = await loadCohortTree();
    return NextResponse.json({ tree });
  } catch (err) {
    console.error('[avm/cohorts]', err);
    return NextResponse.json({ error: 'Failed to load neighbourhoods' }, { status: 500 });
  }
}
