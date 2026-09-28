/**
 * Where a visitor came from — recorded in the browser, saved with the account at signup.
 *
 * WHY THIS EXISTS. Three Reddit posts made nearly every signup the site has ever had, and
 * nothing recorded which post made which signup: no UTM, referrer or landing page was
 * stored anywhere (checked 2026-09-28). PostHog's referrer is lossy on exactly the channel
 * that matters — the Reddit iOS app sends no referrer, so its visits read as "direct".
 * A tagged link (`?utm_source=reddit&utm_campaign=...`) survives that; this file makes the
 * tag reach the database.
 *
 * TWO TOUCHES, because they answer different questions:
 *   • first — the arrival that introduced this browser to the site. Never overwritten.
 *   • last  — the most recent EXTERNAL arrival (a UTM tag or an outside referrer) before
 *             signup. A visitor who found us on Google in July and signed up from a Reddit
 *             post in September is credited to Google by `first` and to Reddit by `last`.
 * An internal navigation, or a reload with no tag and no outside referrer, is not an
 * arrival and changes neither.
 *
 * Browser-local (localStorage) until signup, then the /welcome form posts it to
 * /api/vow/accept-terms, which re-validates it with cleanTouches(). Nothing here is VOW
 * data — it is the visitor's own URL and referrer host, never a listing payload.
 */

export interface Touch {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  /** Hostname only — never the full referrer URL, which can carry someone else's query. */
  referrer_host: string | null;
  /** Path + query of the first page seen on this arrival. */
  landing_path: string | null;
  /** ISO timestamp of the arrival. */
  at: string;
}

export interface Touches {
  first: Touch | null;
  last: Touch | null;
}

export const TOUCH_STORAGE_KEY = "pp_touch";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
/** Bound every stored string: this is user-controlled input headed for the database. */
const MAX_LEN = 200;

function clip(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, MAX_LEN) : null;
}

/** "www.reddit.com" and "reddit.com" are one source; so are "www.pureproperty.ca" and the apex. */
function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Referrers that are a step of OUR flow, not a source. The Google sign-in returns to
 * /auth/callback from accounts.google.com (PostHog listed it as a "referring domain", 82
 * visitors in 90 days) — counting it would credit every Google signup to Google.
 */
function isFlowReferrer(host: string): boolean {
  return host === "accounts.google.com" || host.endsWith(".supabase.co");
}

/**
 * The arrival a page load represents, or null when it is not an arrival (an internal
 * navigation, or a tagless load with no outside referrer).
 *
 * @param href     location.href of the loaded page
 * @param referrer document.referrer ("" when the browser sent none)
 * @param now      timestamp to stamp on the touch
 */
export function touchFromLoad(href: string, referrer: string, now: Date): Touch | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  let referrerHost: string | null = null;
  if (referrer) {
    try {
      const r = new URL(referrer);
      const host = bareHost(r.hostname);
      if (host !== bareHost(url.hostname) && !isFlowReferrer(host)) referrerHost = host;
    } catch {
      /* unparseable referrer — treat as none */
    }
  }

  const utm = Object.fromEntries(
    UTM_KEYS.map((k) => [k, clip(url.searchParams.get(k))])
  ) as Pick<Touch, (typeof UTM_KEYS)[number]>;
  const tagged = UTM_KEYS.some((k) => utm[k] !== null);
  if (!tagged && !referrerHost) return null;

  return {
    ...utm,
    referrer_host: referrerHost,
    landing_path: clip(url.pathname + url.search),
    at: now.toISOString(),
  };
}

/**
 * Fold one arrival into the stored touches. The FIRST touch is set once; a tagless,
 * referrer-less first visit still sets it (as "direct") so a later Reddit visit cannot
 * masquerade as the introduction. That direct first touch is built by the caller.
 */
export function mergeTouches(prev: Touches, arrival: Touch | null, directFirst: Touch): Touches {
  return {
    first: prev.first ?? arrival ?? directFirst,
    last: arrival ?? prev.last,
  };
}

function cleanTouch(v: unknown): Touch | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const at = clip(o.at);
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return {
    utm_source: clip(o.utm_source),
    utm_medium: clip(o.utm_medium),
    utm_campaign: clip(o.utm_campaign),
    utm_content: clip(o.utm_content),
    utm_term: clip(o.utm_term),
    referrer_host: clip(o.referrer_host),
    landing_path: clip(o.landing_path),
    at: new Date(at).toISOString(),
  };
}

/** Validate an untrusted value (localStorage on the client, the request body on the server). */
export function cleanTouches(v: unknown): Touches {
  if (!v || typeof v !== "object") return { first: null, last: null };
  const o = v as Record<string, unknown>;
  return { first: cleanTouch(o.first), last: cleanTouch(o.last) };
}

/** Browser only. Reads the stored touches; empty when storage is blocked or corrupt. */
export function readTouches(): Touches {
  try {
    const raw = window.localStorage.getItem(TOUCH_STORAGE_KEY);
    return cleanTouches(raw ? JSON.parse(raw) : null);
  } catch {
    return { first: null, last: null };
  }
}

/** Browser only. Records this page load. Call once per document (a full load). */
export function recordPageLoad(): void {
  try {
    const now = new Date();
    const arrival = touchFromLoad(window.location.href, document.referrer, now);
    const direct: Touch = {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      referrer_host: null,
      landing_path: clip(window.location.pathname + window.location.search),
      at: now.toISOString(),
    };
    const next = mergeTouches(readTouches(), arrival, direct);
    window.localStorage.setItem(TOUCH_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode / blocked storage: attribution is lost for this browser, nothing else.
  }
}
