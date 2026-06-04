import { describe, it, expect } from 'vitest';
import { describeError } from './describeError';

describe('describeError', () => {
  it('unwraps a Cloudflare 522 structured body (the shape that logged `undefined`)', () => {
    const cf = {
      status: 522,
      error_name: 'connection_timeout',
      error_category: 'origin',
      ray_id: 'a06849561dab90e5',
      cloudflare_error: true,
      detail: 'Cloudflare could not establish a TCP connection to the origin server.',
    };
    const out = describeError(cf);
    expect(out).toContain('522');
    expect(out).toContain('connection_timeout');
    expect(out).toContain('a06849561dab90e5');
  });

  it('returns a standard Error message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('appends a Supabase/Postgres error code when present', () => {
    expect(describeError({ message: 'permission denied', code: '42501' })).toBe(
      'permission denied (code 42501)',
    );
  });

  it('passes through a plain string', () => {
    expect(describeError('oops')).toBe('oops');
  });

  it('handles null and undefined without throwing', () => {
    expect(describeError(null)).toBe('null');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('never returns an empty string for an empty-message error object', () => {
    const out = describeError({ message: '' });
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('undefined');
  });

  it('truncates a leaked HTML error page but keeps the signal', () => {
    const html =
      '<!DOCTYPE html><head><title>supabase.co | 522: Connection timed out</title></head>'.repeat(20);
    const out = describeError({ message: html });
    expect(out).toContain('522');
    expect(out.length).toBeLessThanOrEqual(401); // 400 chars + ellipsis
  });
});
