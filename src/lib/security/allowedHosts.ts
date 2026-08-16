/**
 * Registered-host gate (VOW/IDX compliance audit R7).
 *
 * THE PROBLEM
 * IDX §6.3(g) and the VOW agreement both require every URL that displays board data to
 * be pre-registered with PROPTX. Our agreements register exactly one:
 * `http://pureproperty.ca`. Production actually serves `https://www.pureproperty.ca`,
 * and — worse — nothing restricts which host may serve the app at all, so every Vercel
 * preview deployment (`*.vercel.app`) is a fully working mirror of the product, real
 * IDX/VOW data included, on a host the board has never seen. The audit calls this "the
 * cleanest, most objective violation".
 *
 * THE GATE
 * `ALLOWED_HOSTS` is a comma-separated allowlist. A request whose host is not on it gets
 * a 404 — no body, no hint that anything exists there.
 *
 * DEFAULT OFF, DELIBERATELY. An empty/unset allowlist allows everything, so deploying
 * this file changes nothing until the variable is set. A host allowlist is exactly the
 * kind of control that takes a site down when it is wrong, and "wrong" here means every
 * page 404s. Turning it on is a deliberate act; turning it off is deleting one variable.
 *
 * Pure and dependency-free so the matching rules can be tested directly — middleware
 * itself is awkward to unit-test, and this is the part that decides whether the site
 * answers at all.
 */

/** Hosts that must always work regardless of the allowlist — local development. */
const ALWAYS_ALLOWED = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/**
 * Normalize a Host header for comparison: lowercase, strip the port, strip a trailing
 * dot. "WWW.PurePropErty.CA." and "www.pureproperty.ca:443" are the same host, and a
 * fully-qualified trailing dot is a real way to bypass a naive string compare.
 */
export function normalizeHost(raw: string | null | undefined): string {
  let h = (raw ?? '').trim().toLowerCase();
  if (!h) return '';
  // IPv6 literals arrive bracketed ("[::1]:3000") — keep the brackets, drop the port.
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    if (close > -1) return h.slice(0, close + 1);
    return h;
  }
  const colon = h.lastIndexOf(':');
  if (colon > -1 && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** Parse the env allowlist. Empty result means "gate disabled". */
export function parseAllowedHosts(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => normalizeHost(s))
    .filter(Boolean);
}

export interface HostDecision {
  /** false → serve a 404 instead of the app. */
  allowed: boolean;
  /** Why, for logging. */
  reason: 'gate-disabled' | 'always-allowed' | 'allowlisted' | 'not-registered' | 'no-host';
}

/**
 * Decide whether this host may serve board data.
 *
 * Exact match only. No suffix matching: allowing "*.pureproperty.ca" would re-open the
 * hole, because a preview alias can be given a subdomain, and the agreement registers
 * specific URLs rather than a domain tree.
 */
export function decideHost(rawHost: string | null | undefined, allowlist: string[]): HostDecision {
  if (allowlist.length === 0) return { allowed: true, reason: 'gate-disabled' };

  const host = normalizeHost(rawHost);
  // With the gate ON, a request with no Host header cannot be shown to be registered.
  if (!host) return { allowed: false, reason: 'no-host' };

  if (ALWAYS_ALLOWED.has(host)) return { allowed: true, reason: 'always-allowed' };
  if (allowlist.includes(host)) return { allowed: true, reason: 'allowlisted' };
  return { allowed: false, reason: 'not-registered' };
}
