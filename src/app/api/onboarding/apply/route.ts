/**
 * POST /api/onboarding/apply
 *
 * Persists a "velvet rope" terminal-access application (lead capture +
 * personalization seed). Uses the service-role client because terminal_applications
 * has RLS enabled with no policies (anon key is blocked from writing PII).
 *
 * Best-effort: the /apply page grants access locally regardless of this result, so a
 * Supabase misconfiguration never blocks a user from reaching the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { makeRateLimiter, clientIpFrom } from '@/lib/rateLimit';

export const runtime = 'nodejs';

// 5 submissions/min/IP — generous for a human filling a form, hostile to table-flooding (audit LOW-30).
const limiter = makeRateLimiter({ windowMs: 60_000, max: 5 });

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const sb = getServiceRoleClient();
    const { error } = await sb.from('terminal_applications').insert({
      applicant_type: asString(body.applicantType),
      full_name: asString(body.fullName),
      email: asString(body.email),
      entity_name: asString(body.entityName),
      objectives: asArray(body.objectives),
      regions: asArray(body.regions),
      capital: asString(body.capital),
      assets: asArray(body.assets),
      cadence: asString(body.cadence),
      attest_not_agent: !!body.attestNotAgent,
      attest_bona_fide: !!body.attestBonaFide,
      agree_terms: !!body.agreeTerms,
    });

    if (error) {
      console.error('[onboarding/apply] insert failed:', error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[onboarding/apply] error:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
