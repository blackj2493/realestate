import { describe, it, expect, vi, afterEach } from 'vitest';

// terms.ts imports the server-side Supabase helpers at module load — stub them
// so the module can be imported in the node test env.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getCurrentUser: vi.fn(),
}));

const ORIGINAL = process.env.VOW_ENFORCE_TERMS;

async function loadWith(envValue: string | undefined) {
  vi.resetModules();
  if (envValue === undefined) delete process.env.VOW_ENFORCE_TERMS;
  else process.env.VOW_ENFORCE_TERMS = envValue;
  return import('./terms');
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VOW_ENFORCE_TERMS;
  else process.env.VOW_ENFORCE_TERMS = ORIGINAL;
});

describe('TERMS_ENFORCED default (audit HIGH-3)', () => {
  it('ENFORCES when VOW_ENFORCE_TERMS is unset (fail closed)', async () => {
    expect((await loadWith(undefined)).TERMS_ENFORCED).toBe(true);
  });
  it('stays enforced when explicitly true', async () => {
    expect((await loadWith('true')).TERMS_ENFORCED).toBe(true);
  });
  it('can only be disabled by an explicit false', async () => {
    expect((await loadWith('false')).TERMS_ENFORCED).toBe(false);
  });
});
