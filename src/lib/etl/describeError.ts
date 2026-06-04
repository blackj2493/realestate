/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * Supabase/PostgREST errors, Cloudflare 5xx JSON bodies (e.g. a 522
 * `connection_timeout`, which has NO `.message`), leaked HTML error pages, plain
 * strings and standard Errors all collapse to one useful line — so a failed sync
 * logs WHY instead of `undefined`. (The 2026-06-04 outage logged
 * `Dual-Query sync failed: undefined` precisely because the thrown Cloudflare 522
 * object had no `.message` property.)
 */
export function describeError(err: unknown): string {
  if (err === null) return 'null';
  if (err === undefined) return 'undefined';
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return String(err);

  const e = err as Record<string, unknown>;

  // Cloudflare 5xx structured body: { status, error_name, ray_id, detail, cloudflare_error }
  if (
    e.cloudflare_error === true ||
    (typeof e.status === 'number' && typeof e.error_name === 'string')
  ) {
    const head = `Cloudflare ${e.status ?? '5xx'} ${e.error_name ?? ''}`.trim();
    const ray = e.ray_id ? ` (ray ${String(e.ray_id)})` : '';
    const detail = typeof e.detail === 'string' ? ` — ${e.detail}` : '';
    return `${head}${ray}${detail}`.slice(0, 400);
  }

  // Standard Error / Supabase PostgrestError (has a non-empty .message)
  if (typeof e.message === 'string' && e.message.length > 0) {
    const msg = e.message.length > 400 ? `${e.message.slice(0, 400)}…` : e.message;
    return typeof e.code === 'string' && e.code ? `${msg} (code ${e.code})` : msg;
  }

  // Anything else (incl. an empty-message object) — serialize a compact snapshot
  try {
    const json = JSON.stringify(e);
    if (json && json !== '{}') return json.slice(0, 400);
  } catch {
    /* circular / unserializable — fall through */
  }
  return Object.prototype.toString.call(e); // '[object Object]' as a last resort
}
