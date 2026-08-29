/**
 * Nightly alerts digest — price drops + status changes + relists (watchlist), new
 * listings (saved market bubbles incl. city alert rows), anonymous listing alerts
 * (price/status + `similar` new-inventory matching), and address watches.
 * ONE email per user (or lead email) per day per audience.
 *
 * Architecture: compare-at-read (spec docs/superpowers/specs/2026-06-10-granular-alerts-design.md).
 * Baselines: watchlist.list_price / last_known_status / terminal_since,
 * market_bubbles.notify_since + notified_keys (72h lookback dedup, migration 083),
 * listing_alerts.last_price / last_status / last_notified_at,
 * address_watches.last_listing_key.
 * Cadence is DAILY — it piggybacks the once-a-day sync and matches the 24h data
 * freshness rule (CLAUDE.md §4). No realtime claims.
 *
 * Consent: a digest is suppressed by profiles.marketing_opt_out (master), by the per-stream
 * "Saved home & area alerts" toggle, or by an active "Pause all emails for 30 days" — all
 * three via canSendAlerts (src/lib/email/sendPolicy.ts). Cadence deliberately does NOT
 * suppress it; see that function for why. A suppressed user still has their baselines
 * advanced, so re-subscribing never dumps a backlog. The anonymous listing-alert and
 * address-watch phases are email-keyed leads with their own one-click unsubscribe and are
 * outside email_prefs (which is keyed by user_id).
 *
 * Compliance: deterministic comparisons only — no LLM touches listing data (§4).
 * Sold prices NEVER appear in email (the sold row is a tease linking to the
 * gated listing page); the listing brokerage is shown on every row. Relist rows
 * show only the NEW ACTIVE (IDX/public) campaign's facts.
 * Idempotent: baselines/watermarks advance only after a successful send, so a
 * Resend failure retries tomorrow instead of eating the alert.
 *
 * Invoke: npx tsx scripts/worker/alerts.ts
 * Env:    SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *         TYPESENSE_ADMIN_API_KEY, RESEND_API_KEY,
 *         (optional) ALERTS_FROM_EMAIL, NEXT_PUBLIC_SITE_URL
 */

import 'dotenv/config';
import { Resend } from 'resend';
import Typesense, { Client } from 'typesense';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildAreaClause } from '@/lib/bubbles/stats';
import { bubbleAlertFilter } from '@/lib/alerts/bubbleFilterClause';
import {
  classifyStatusChange,
  isRelistScanBaseline,
  isTerminalStatus,
  resolvedBaseline,
} from '@/lib/alerts/transitions';
import {
  advanceNotifiedKeys,
  buildBubbleSections,
  BUBBLE_LOOKBACK_MS,
  filterFreshMatches,
  parseNotifiedKeys,
  type BubbleMatches,
  type NewListingAlert,
  type NotifiedKey,
} from '@/lib/alerts/bubbleDigest';
import {
  renderAlertsDigest,
  type DigestPayload,
  type DropAlert,
  type StatusChangeAlert,
} from '@/lib/alerts/digest';
import {
  renderListingAlertEmail,
  type ListingAlertChange,
  type SimilarMatch,
  type SimilarSection,
} from '@/lib/alerts/listingAlertEmail';
import { classifyAddressWatch } from '@/lib/alerts/addressWatch';
import { renderAddressWatchEmail, type AddressWatchHit } from '@/lib/alerts/addressWatchEmail';
import { qualifiesAsDrop } from '@/lib/alerts/dropPolicy';
import { findRelists, type RelistTargetFull } from '@/lib/watchlist/relistLookup';
import { addressesMatch, parseAddress } from '@/lib/watchlist/disposition';
import { unsubscribeUrl, marketingUnsubscribeUrl } from '@/lib/alerts/unsubscribe';
import { SENDERS } from '@/lib/alerts/senders';
import { canSendAlerts, DIGEST_MESSAGE_ID, type EmailPrefsRow } from '@/lib/email/sendPolicy';
import { EMAIL_METRICS, recordEmailSendMetrics } from '@/lib/ops/emailSendMetrics';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const FROM = SENDERS.alerts.from;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');
/** Same rental-noise floor as bubble stats (src/lib/bubbles/stats.ts). */
const SALES_FLOOR = 'ListPrice:>=100000';
/** §6.3b display cap — also bounds the per-bubble fetch. */
const MAX_BUBBLE_FETCH = 100;

interface WatchRow {
  id: string;
  user_id: string;
  listing_key: string;
  address: string | null;
  city: string | null;
  thumb: string | null;
  list_price: number | null;
  last_known_status: string | null;
  last_alerted_price: number | null;
  terminal_since: string | null;
}

interface BubbleRow {
  id: string;
  user_id: string;
  name: string;
  area_type: 'draw' | 'commute' | 'school' | 'city';
  polygon: [number, number][];
  source: { kind: string; schoolKey?: string; city?: string };
  notify_since: string | null;
  notified_keys: unknown;
  /** 'all' (default) | 'filtered' — apply the saved filter snapshot (migration 095). */
  alert_scope?: string;
  /** BubbleFiltersSnapshot jsonb — untyped at this boundary; bubbleAlertFilter parses defensively. */
  filters?: unknown;
}

/** How long after a campaign dies without a transaction we keep scanning for a relist. */
const RELIST_SCAN_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** multi_search batch size for the relist / address-watch lookups. */
const LOOKUP_BATCH = 40;

interface Current {
  price: number | null;
  status: string | null;
  address?: string;
  city?: string;
  thumb?: string;
  brokerage?: string;
}

export function getTypesense(): Client {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) throw new Error('TYPESENSE_ADMIN_API_KEY is not set');
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: key,
    connectionTimeoutSeconds: 10,
  });
}

/** Current state of a listing from the active `properties` index (null if gone). */
async function fetchCurrent(ts: Client, key: string): Promise<Current | null> {
  try {
    const doc = (await ts
      .collections('properties')
      .documents(key)
      .retrieve()) as Record<string, unknown>;
    const price = Number(doc.ListPrice);
    return {
      price: Number.isFinite(price) && price > 0 ? price : null,
      status: (doc.Status as string) ?? null,
      address: (doc.UnparsedAddress as string) || undefined,
      city: (doc.City as string) || undefined,
      thumb: (doc.thumbnailUrl as string) || (doc.primaryImageUrl as string) || undefined,
      brokerage: (doc.ListOfficeName as string) || undefined,
    };
  } catch {
    return null; // not in the active index (sold / off-market / removed)
  }
}

/** Was the vanished listing recorded as a SOLD deal? (sold_listings id = listing_key) */
async function fetchSoldHit(ts: Client, key: string): Promise<boolean> {
  try {
    const doc = (await ts
      .collections('sold_listings')
      .documents(key)
      .retrieve()) as Record<string, unknown>;
    return (doc.DealType as string) === 'sold';
  } catch {
    return false;
  }
}

interface ListingAlertRow {
  id: string;
  listing_key: string;
  email: string;
  address: string | null;
  city: string | null;
  kind: string; // price_status | relist | similar
  last_price: number | null;
  last_status: string | null;
  last_notified_at: string | null;
}

/** Anchor facts a `similar` subscription matches against (active index, else vault). */
interface SimilarAnchor {
  city: string;
  subtype: string;
  price: number;
  beds: number | null;
}

async function fetchSimilarAnchor(
  ts: Client,
  supabase: ReturnType<typeof getServiceRoleClient>,
  key: string
): Promise<SimilarAnchor | null> {
  const shape = (city: unknown, subtype: unknown, price: unknown, beds: unknown): SimilarAnchor | null => {
    const p = Number(price);
    if (!city || !subtype || !Number.isFinite(p) || p <= 0) return null;
    const b = Number(beds);
    return { city: String(city), subtype: String(subtype), price: p, beds: Number.isFinite(b) && b > 0 ? b : null };
  };
  try {
    const doc = (await ts.collections('properties').documents(key).retrieve()) as Record<string, unknown>;
    const a = shape(doc.City, doc.PropertySubType, doc.ListPrice, doc.BedroomsTotal);
    if (a) return a;
  } catch {
    /* fall through to the vault — a similar sub should keep matching after the anchor sells */
  }
  try {
    const { data } = await supabase
      .from('listings')
      .select(
        'city:full_payload->>City, subtype:full_payload->>PropertySubType, price:full_payload->>ListPrice, beds:full_payload->>BedroomsTotal'
      )
      .eq('listing_key', key)
      .maybeSingle();
    const r = data as { city?: string; subtype?: string; price?: string; beds?: string } | null;
    return r ? shape(r.city, r.subtype, r.price, r.beds) : null;
  } catch {
    return null;
  }
}

/** Escape a value for a backtick-quoted Typesense filter literal. */
const tsSafe = (s: string) => s.replace(/`/g, '');

/**
 * Listing-alerts phase — the ANONYMOUS email-capture leads (listing_alerts table), which
 * have no account so are invisible to the watchlist phase above. Same compare-at-read model:
 * seed a per-subscription baseline on first sight (silent), then email on a real price drop
 * or status change, advancing the baseline ONLY after a successful send (idempotent).
 * One digest per email address (a lead can watch several listings).
 *
 * `similar` subscriptions deliver new-inventory matching: active listings in the anchor's
 * City with the same PropertySubType, ask within ±20%, beds within ±1, that ENTERED after
 * the subscription's last_notified_at watermark. The watermark seeds silently on first
 * sight and advances ONLY after a successful send — so a quiet stretch keeps the window
 * open (late-published listings self-heal) and a Resend failure retries tomorrow.
 *
 * Exported + `dryRun` so it can be exercised in isolation without importing/running main()
 * (which would fire the live watchlist send). dryRun performs ZERO writes and ZERO sends.
 */
export async function runListingAlertsPhase(
  ts: Client,
  supabase: ReturnType<typeof getServiceRoleClient>,
  resend: Resend,
  opts: { dryRun?: boolean } = {}
): Promise<{ processed: number; baselined: number; emailed: number; similarMatched: number }> {
  const dryRun = !!opts.dryRun;
  const runStartIso = new Date().toISOString();

  // Page through active subscriptions (PostgREST caps a select at 1,000 rows).
  const rows: ListingAlertRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('listing_alerts')
      .select('id, listing_key, email, address, city, kind, last_price, last_status, last_notified_at')
      .eq('status', 'active')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) {
      // Pre-migration-051/052 deploys (missing table/columns) → skip the phase, never the run.
      console.warn(`[alerts] listing_alerts phase skipped: ${error.message}`);
      return { processed: 0, baselined: 0, emailed: 0, similarMatched: 0 };
    }
    const chunk = (data ?? []) as ListingAlertRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }

  const similarRows = rows.filter((r) => r.kind === 'similar');
  const actionable = rows.filter((r) => r.kind !== 'similar');
  if (actionable.length === 0 && similarRows.length === 0) {
    return { processed: 0, baselined: 0, emailed: 0, similarMatched: 0 };
  }

  // Current state per distinct listing (one active-index lookup each).
  const currents = new Map<string, Current | null>();
  for (const key of new Set(actionable.map((r) => r.listing_key))) {
    currents.set(key, await fetchCurrent(ts, key));
  }
  // Vanished docs (baselined, non-terminal) get a sold-hit + vault-status fallback.
  const needsResolution = new Set<string>();
  for (const r of actionable) {
    if (currents.get(r.listing_key) === null && r.last_status !== null && !isTerminalStatus(r.last_status)) {
      needsResolution.add(r.listing_key);
    }
  }
  const soldHits = new Map<string, boolean>();
  const fallbackStatuses = new Map<string, string | null>();
  for (const key of needsResolution) {
    soldHits.set(key, await fetchSoldHit(ts, key));
    if (!soldHits.get(key)) {
      try {
        const { data } = await supabase
          .from('listings')
          .select('status:full_payload->>MlsStatus')
          .eq('listing_key', key)
          .maybeSingle();
        fallbackStatuses.set(key, (data as { status?: string } | null)?.status ?? null);
      } catch {
        fallbackStatuses.set(key, null);
      }
    }
  }

  interface Pending { id: string; patch: Record<string, unknown>; }
  const changesByEmail = new Map<string, ListingAlertChange[]>();
  const patchesByEmail = new Map<string, Pending[]>();
  const silentPatches: Pending[] = [];
  let baselined = 0;

  for (const r of actionable) {
    const cur = currents.get(r.listing_key) ?? null;

    // First sight → seed the baseline silently (no backlog email). For a listing that's
    // already gone (e.g. a `relist` sub on a de-listed home), store a resolved baseline so
    // a later back-on-market fires.
    if (r.last_status === null) {
      const initStatus =
        cur?.status ??
        (soldHits.get(r.listing_key) ? 'Sold' : fallbackStatuses.get(r.listing_key) || 'unavailable');
      if (!dryRun) silentPatches.push({ id: r.id, patch: { last_price: cur?.price ?? null, last_status: initStatus } });
      baselined++;
      continue;
    }

    const event = classifyStatusChange({
      prev: r.last_status,
      current: cur?.status ?? null,
      soldHit: soldHits.get(r.listing_key) ?? false,
      fallbackStatus: fallbackStatuses.get(r.listing_key) ?? null,
    });
    const drop =
      cur && cur.price != null && r.last_price != null && cur.price < r.last_price
        ? { oldPrice: r.last_price, newPrice: cur.price }
        : null;

    if (event || drop) {
      const change: ListingAlertChange = {
        listing_key: r.listing_key,
        address: r.address || cur?.address || '',
        city: r.city || cur?.city || null,
        brokerage: cur?.brokerage ?? null,
        ...(drop ? { drop } : {}),
        ...(event ? { status: { kind: event.kind, detail: event.detail } } : {}),
      };
      changesByEmail.set(r.email, [...(changesByEmail.get(r.email) ?? []), change]);

      const patch: Record<string, unknown> = { last_notified_at: runStartIso };
      if (drop) patch.last_price = cur!.price;
      if (event) patch.last_status = resolvedBaseline(event) ?? cur?.status ?? r.last_status;
      else if (cur?.status != null) patch.last_status = cur.status;
      patchesByEmail.set(r.email, [...(patchesByEmail.get(r.email) ?? []), { id: r.id, patch }]);
    } else {
      // Silent baseline refresh — safe regardless of email outcome.
      const patch: Record<string, unknown> = {};
      if (cur?.price != null && cur.price !== r.last_price) patch.last_price = cur.price;
      if (cur?.status != null && cur.status !== r.last_status) patch.last_status = cur.status;
      if (Object.keys(patch).length && !dryRun) silentPatches.push({ id: r.id, patch });
    }
  }

  // ── `similar` subscriptions: new-inventory matching ────────────────────────
  const similarByEmail = new Map<string, SimilarSection[]>();
  let similarMatched = 0;
  const anchors = new Map<string, SimilarAnchor | null>();
  for (const r of similarRows) {
    // First sight → seed the watermark silently (no backlog of months-old "new" homes).
    if (r.last_notified_at === null) {
      if (!dryRun) silentPatches.push({ id: r.id, patch: { last_notified_at: runStartIso } });
      baselined++;
      continue;
    }
    if (!anchors.has(r.listing_key)) {
      anchors.set(r.listing_key, await fetchSimilarAnchor(ts, supabase, r.listing_key));
    }
    const anchor = anchors.get(r.listing_key);
    if (!anchor) continue; // anchor facts unavailable — nothing to match against

    const sinceMs = new Date(r.last_notified_at).getTime();
    const lo = Math.round(anchor.price * 0.8);
    const hi = Math.round(anchor.price * 1.2);
    const bedsClause =
      anchor.beds != null
        ? ` && BedroomsTotal:>=${Math.max(0, anchor.beds - 1)} && BedroomsTotal:<=${anchor.beds + 1}`
        : '';
    try {
      const res = await ts.collections('properties').documents().search({
        q: '*',
        query_by: 'City',
        filter_by:
          `${SALES_FLOOR} && City:=\`${tsSafe(anchor.city)}\` && PropertySubType:=\`${tsSafe(anchor.subtype)}\`` +
          ` && ListPrice:>=${lo} && ListPrice:<=${hi}${bedsClause} && EntryTimestamp:>${sinceMs}`,
        sort_by: 'EntryTimestamp:desc',
        per_page: 7, // 6 shown + headroom for the anchor itself sneaking in
        include_fields:
          'id,UnparsedAddress,City,ListPrice,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,EntryTimestamp',
      });
      const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
      const matches: SimilarMatch[] = (res.hits ?? [])
        .map((h) => h.document as Record<string, unknown>)
        .filter((d) => String(d.id ?? '') !== r.listing_key)
        .slice(0, 6)
        .map((d) => ({
          listing_key: String(d.id ?? ''),
          address: (d.UnparsedAddress as string) || 'New listing',
          city: (d.City as string) || null,
          price: num(d.ListPrice),
          beds: num(d.BedroomsTotal),
          baths: num(d.BathroomsTotalInteger),
          brokerage: (d.ListOfficeName as string) || null,
        }));
      if (matches.length === 0) continue; // watermark stays open — late listings self-heal

      similarMatched += matches.length;
      const section: SimilarSection = {
        anchorAddress: r.address || 'a home you saved',
        anchorCity: r.city,
        matches,
      };
      similarByEmail.set(r.email, [...(similarByEmail.get(r.email) ?? []), section]);
      patchesByEmail.set(r.email, [
        ...(patchesByEmail.get(r.email) ?? []),
        { id: r.id, patch: { last_notified_at: runStartIso } },
      ]);
    } catch (e) {
      console.error('[alerts] similar match failed', r.id, e instanceof Error ? e.message : e);
    }
  }

  // Silent refreshes always apply.
  for (const p of silentPatches) await supabase.from('listing_alerts').update(p.patch).eq('id', p.id);

  // One digest per email; advance that email's baselines only after a successful send.
  let emailed = 0;
  const allEmails = new Set([...changesByEmail.keys(), ...similarByEmail.keys()]);
  for (const email of allEmails) {
    const changes = changesByEmail.get(email) ?? [];
    const similar = similarByEmail.get(email) ?? [];
    const uUrl = unsubscribeUrl(email, SITE);
    const { subject, html, text } = renderListingAlertEmail({ changes, similar, unsubscribeUrl: uUrl });
    if (dryRun) {
      console.log(
        `[alerts][dry-run] listing-alert → ${email}: "${subject}" (${changes.length} change(s), ${similar.length} similar section(s))`
      );
      emailed++;
      continue;
    }
    try {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject,
        html,
        text,
        headers: { 'List-Unsubscribe': `<${uUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      emailed++;
      for (const p of patchesByEmail.get(email) ?? []) await supabase.from('listing_alerts').update(p.patch).eq('id', p.id);
    } catch (e) {
      console.error('[alerts] listing-alert send failed for', email, e instanceof Error ? e.message : e);
      // No baseline advance → retried tomorrow.
    }
  }

  console.log(
    `[alerts] listing_alerts: ${actionable.length} price/status + ${similarRows.length} similar active, ` +
      `${baselined} baselined, ${emailed} emailed, ${similarMatched} similar matches.`
  );
  return { processed: actionable.length + similarRows.length, baselined, emailed, similarMatched };
}

interface AddressWatchRow {
  id: string;
  email: string;
  address_key: string;
  address: string;
  city: string | null;
  postal: string | null;
  last_listing_key: string | null;
  created_at: string;
}

/**
 * Address-watch phase — "Track this address" leads (address_watches, migration 077).
 * The confirmation email promised ONE thing: "We'll email you if this address hits the
 * market." Nightly: resolve each watched address against the ACTIVE index with the same
 * civic-number + postal/city matcher the relist scan uses, then let the pure classifier
 * (src/lib/alerts/addressWatch.ts) decide alert vs silent baseline. Baselines advance
 * only after a successful send; one email per lead per night. Skips cleanly pre-083
 * (missing last_listing_key column).
 */
export async function runAddressWatchPhase(
  ts: Client,
  supabase: ReturnType<typeof getServiceRoleClient>,
  resend: Resend,
  opts: { dryRun?: boolean } = {}
): Promise<{ processed: number; baselined: number; emailed: number }> {
  const dryRun = !!opts.dryRun;
  const runStartIso = new Date().toISOString();

  const rows: AddressWatchRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('address_watches')
      .select('id, email, address_key, address, city, postal, last_listing_key, created_at')
      .eq('status', 'active')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) {
      // Pre-077/083 deploys (missing table or baseline column) → skip the phase, never the run.
      console.warn(`[alerts] address_watches phase skipped: ${error.message}`);
      return { processed: 0, baselined: 0, emailed: 0 };
    }
    const chunk = (data ?? []) as AddressWatchRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  if (rows.length === 0) return { processed: 0, baselined: 0, emailed: 0 };

  // One active-index lookup per distinct address_key: search by civic number + street,
  // keep hits that pass the deterministic address matcher, prefer postal-exact then newest.
  interface AddressHitDoc {
    id: string;
    UnparsedAddress?: string;
    PostalCode?: string;
    City?: string;
    ListPrice?: number;
    BedroomsTotal?: number;
    BathroomsTotalInteger?: number;
    ListOfficeName?: string;
    EntryTimestamp?: number;
    primaryImageUrl?: string;
  }
  const byAddressKey = new Map<string, AddressWatchRow[]>();
  for (const r of rows) {
    byAddressKey.set(r.address_key, [...(byAddressKey.get(r.address_key) ?? []), r]);
  }
  const bestByAddressKey = new Map<string, AddressHitDoc | null>();
  const distinct = [...byAddressKey.values()].map((group) => group[0]);
  for (let i = 0; i < distinct.length; i += LOOKUP_BATCH) {
    const batch = distinct.slice(i, i + LOOKUP_BATCH);
    const usable = batch
      .map((r) => {
        const parsed = parseAddress(r.address);
        if (!parsed.postal && r.postal) parsed.postal = r.postal.replace(/\s+/g, '').toUpperCase();
        if (!parsed.city && r.city) parsed.city = r.city.toLowerCase().trim();
        return { r, parsed };
      })
      .filter((c) => c.parsed.streetNumber);
    for (const row of batch) {
      // No parseable civic number → we can never match this address; treat as "no listing".
      if (!usable.some((u) => u.r.id === row.id)) bestByAddressKey.set(row.address_key, null);
    }
    if (!usable.length) continue;
    try {
      const searches = usable.map((c) => ({
        collection: 'properties',
        q: `${c.parsed.streetNumber} ${c.parsed.streetName}`.trim() || '*',
        query_by: 'UnparsedAddress',
        include_fields:
          'id,UnparsedAddress,PostalCode,City,ListPrice,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,EntryTimestamp,primaryImageUrl',
        per_page: 25,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await ts.multiSearch.perform({ searches } as any);
      const results: Array<{ hits?: Array<{ document: AddressHitDoc }> }> = res?.results ?? [];
      usable.forEach((c, j) => {
        let best: { doc: AddressHitDoc; exact: boolean } | null = null;
        for (const h of results[j]?.hits ?? []) {
          const doc = h.document;
          if (!doc?.id) continue;
          const cand = parseAddress(doc.UnparsedAddress);
          if (!cand.postal && doc.PostalCode) cand.postal = String(doc.PostalCode).replace(/\s+/g, '').toUpperCase();
          if (!cand.city && doc.City) cand.city = String(doc.City).toLowerCase().trim();
          if (!addressesMatch(c.parsed, cand)) continue;
          const exact = !!c.parsed.postal && c.parsed.postal === cand.postal;
          if (
            !best ||
            (exact && !best.exact) ||
            (exact === best.exact && (doc.EntryTimestamp ?? 0) > (best.doc.EntryTimestamp ?? 0))
          ) {
            best = { doc, exact };
          }
        }
        bestByAddressKey.set(c.r.address_key, best?.doc ?? null);
      });
    } catch (e) {
      console.error('[alerts] address-watch lookup failed:', e instanceof Error ? e.message : e);
      for (const { r } of usable) bestByAddressKey.delete(r.address_key); // unknown ≠ "no listing"
    }
  }

  interface Pending { id: string; patch: Record<string, unknown>; }
  const hitsByEmail = new Map<string, AddressWatchHit[]>();
  const patchesByEmail = new Map<string, Pending[]>();
  const silentPatches: Pending[] = [];
  let baselined = 0;

  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  for (const r of rows) {
    if (!bestByAddressKey.has(r.address_key)) continue; // lookup failed — retry tomorrow
    const doc = bestByAddressKey.get(r.address_key) ?? null;
    const decision = classifyAddressWatch({
      lastListingKey: r.last_listing_key,
      createdAtMs: Date.parse(r.created_at),
      current: doc ? { listingKey: doc.id, entryMs: Number(doc.EntryTimestamp) || 0 } : null,
    });
    if (decision.baseline !== undefined && decision.silent) {
      if (r.last_listing_key === null) baselined++;
      if (!dryRun) silentPatches.push({ id: r.id, patch: { last_listing_key: decision.baseline } });
      continue;
    }
    if (!decision.alert || !doc) continue;

    hitsByEmail.set(r.email, [
      ...(hitsByEmail.get(r.email) ?? []),
      {
        address: r.address,
        city: r.city || doc.City || null,
        listing_key: doc.id,
        price: num(doc.ListPrice),
        beds: num(doc.BedroomsTotal),
        baths: num(doc.BathroomsTotalInteger),
        brokerage: doc.ListOfficeName || null,
        thumb: doc.primaryImageUrl || null,
      },
    ]);
    patchesByEmail.set(r.email, [
      ...(patchesByEmail.get(r.email) ?? []),
      { id: r.id, patch: { last_listing_key: decision.baseline, last_notified_at: runStartIso } },
    ]);
  }

  for (const p of silentPatches) await supabase.from('address_watches').update(p.patch).eq('id', p.id);

  let emailed = 0;
  for (const [email, hits] of hitsByEmail) {
    const uUrl = unsubscribeUrl(email, SITE);
    const { subject, html, text } = renderAddressWatchEmail({ hits, unsubscribeUrl: uUrl });
    if (dryRun) {
      console.log(`[alerts][dry-run] address-watch → ${email}: "${subject}" (${hits.length} hit(s))`);
      emailed++;
      continue;
    }
    try {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject,
        html,
        text,
        headers: { 'List-Unsubscribe': `<${uUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      emailed++;
      for (const p of patchesByEmail.get(email) ?? []) await supabase.from('address_watches').update(p.patch).eq('id', p.id);
    } catch (e) {
      console.error('[alerts] address-watch send failed for', email, e instanceof Error ? e.message : e);
      // No baseline advance → retried tomorrow.
    }
  }

  console.log(`[alerts] address_watches: ${rows.length} active, ${baselined} baselined, ${emailed} emailed.`);
  return { processed: rows.length, baselined, emailed };
}

/**
 * Record that the nightly digest reached these addresses, so the weekly Data Drop can
 * stand down for anyone it already emailed today (sendPolicy.canSendDataDrop).
 *
 * READ-MERGE-WRITE, never a bare upsert of `sent`. That column is a map of message ids to
 * send times and it holds the ONBOARDING drip's idempotency keys; writing a fresh object
 * would delete them and re-send the whole drip to everyone with alerts.
 *
 * IT DOES NOT TOUCH `last_sent_at`. That column drives the onboarding drip's two-day gap.
 * Stamping it every night would silently end the drip for every user who has alerts on —
 * the exact class of quiet, months-later failure this codebase keeps producing.
 *
 * Best-effort throughout: the digest has already been delivered by the time this runs, so
 * a bookkeeping failure must never turn a successful send into a red job.
 */
async function stampDigestSent(
  supabase: ReturnType<typeof getServiceRoleClient>,
  emails: string[],
  nowIso: string
): Promise<void> {
  if (!emails.length) return;
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(Boolean);
  const CHUNK = 400; // stays clear of PostgREST's 1000-row default cap on the read

  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase
        .from('user_email_lifecycle')
        .select('email, user_id, sent, first_seen_at')
        .in('email', batch);
      if (error) {
        console.error('[alerts] lifecycle read failed:', error.message);
        continue;
      }

      const existing = new Map(
        (data ?? []).map((r) => [
          (r as { email: string }).email,
          r as { email: string; user_id: string | null; sent: Record<string, string> | null; first_seen_at: string | null },
        ])
      );

      const rows = batch.map((email) => {
        const lc = existing.get(email);
        return {
          email,
          user_id: lc?.user_id ?? null,
          sent: { ...(lc?.sent ?? {}), [DIGEST_MESSAGE_ID]: nowIso },
          first_seen_at: lc?.first_seen_at ?? nowIso,
          updated_at: nowIso,
        };
      });

      const { error: upErr } = await supabase
        .from('user_email_lifecycle')
        .upsert(rows, { onConflict: 'email' });
      if (upErr) console.error('[alerts] lifecycle stamp failed:', upErr.message);
    } catch (e) {
      console.error('[alerts] lifecycle stamp threw:', e instanceof Error ? e.message : e);
    }
  }
}

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[alerts] RESEND_API_KEY not set — skipping alerts digest.');
    return;
  }

  const runStartIso = new Date().toISOString();
  const supabase = getServiceRoleClient();
  const ts = getTypesense();
  const resend = new Resend(process.env.RESEND_API_KEY);

  // ── Watchlist phase ────────────────────────────────────────────────────────
  // PostgREST caps a single select at 1,000 rows; page through all rows so
  // users past the first thousand are never silently skipped (audit LOW-25).
  const PAGE = 1000;
  const readWatchlist = async (withTerminalSince: boolean): Promise<WatchRow[] | null> => {
    const cols =
      'id, user_id, listing_key, address, city, thumb, list_price, last_known_status, last_alerted_price' +
      (withTerminalSince ? ', terminal_since' : '');
    const rows: WatchRow[] = [];
    let offset = 0;
    while (true) {
      const { data: page, error } = await supabase
        .from('watchlist')
        .select(cols)
        .order('id')
        .range(offset, offset + PAGE - 1);
      if (error) {
        if (withTerminalSince) return null; // pre-migration-083 → caller retries legacy columns
        throw new Error(`watchlist read failed: ${error.message}`);
      }
      const chunk = (page ?? []) as unknown as WatchRow[];
      rows.push(...chunk);
      if (chunk.length < PAGE) break;
      offset += PAGE;
    }
    return rows;
  };
  let hasTerminalSince = true;
  let watch = await readWatchlist(true);
  if (watch === null) {
    console.warn('[alerts] watchlist.terminal_since missing (pre-083) — relist window unbounded this run.');
    hasTerminalSince = false;
    watch = (await readWatchlist(false))!.map((w) => ({ ...w, terminal_since: null }));
  }

  // One active-index lookup per distinct listing.
  const currents = new Map<string, Current | null>();
  for (const key of new Set(watch.map((w) => w.listing_key))) {
    currents.set(key, await fetchCurrent(ts, key));
  }

  // Vanished docs get a sold_listings hit check + a vault status fallback —
  // one per distinct listing, and only where some watcher's baseline is not
  // already terminal (classifyStatusChange would return null anyway).
  const needsResolution = new Set<string>();
  for (const w of watch) {
    if (currents.get(w.listing_key) === null && !isTerminalStatus(w.last_known_status)) {
      needsResolution.add(w.listing_key);
    }
  }
  const soldHits = new Map<string, boolean>();
  const fallbackStatuses = new Map<string, string | null>();
  for (const key of needsResolution) {
    soldHits.set(key, await fetchSoldHit(ts, key));
    if (!soldHits.get(key)) {
      try {
        const { data } = await supabase
          .from('listings')
          .select('status:full_payload->>MlsStatus')
          .eq('listing_key', key)
          .maybeSingle();
        fallbackStatuses.set(key, (data as { status?: string } | null)?.status ?? null);
      } catch {
        fallbackStatuses.set(key, null);
      }
    }
  }

  const dropsByUser = new Map<string, DropAlert[]>();
  const statusByUser = new Map<string, StatusChangeAlert[]>();
  // Row patches keyed by watchlist row id; alert-bearing ones apply only after
  // that user's email actually went out.
  interface RowPatch {
    id: string;
    user_id: string;
    alerted: boolean;
    patch: Record<string, unknown>;
  }
  const rowPatches: RowPatch[] = [];

  // Events are held back until the relist scan below has run: a live relist at the same
  // address REPLACES tonight's off-market/gone alert (classifyDisposition parity — the
  // dashboard "Since your last visit" feed already prefers the relist).
  const pendingEvents: Array<{ w: WatchRow; event: NonNullable<ReturnType<typeof classifyStatusChange>>; cur: Current | null }> = [];

  for (const w of watch) {
    const cur = currents.get(w.listing_key) ?? null;

    // Status classification (handles both present and vanished docs).
    const event = classifyStatusChange({
      prev: w.last_known_status,
      current: cur?.status ?? null,
      soldHit: soldHits.get(w.listing_key) ?? false,
      fallbackStatus: fallbackStatuses.get(w.listing_key) ?? null,
    });
    if (event) pendingEvents.push({ w, event, cur });

    // Price drops — only for docs still present with a price. Policy (dropPolicy.ts):
    // sub-threshold cuts neither alert nor refresh the baseline, so the baseline is a
    // HIGH-WATER mark since the last alert and a slow bleed accumulates until it clears
    // the threshold. Rises refresh the baseline silently.
    if (cur && cur.price != null) {
      const baseline = w.list_price;
      const isNewDrop =
        baseline != null && qualifiesAsDrop(baseline, cur.price) && cur.price !== w.last_alerted_price;
      if (isNewDrop) {
        const list = dropsByUser.get(w.user_id) ?? [];
        list.push({
          listing_key: w.listing_key,
          address: w.address || cur.address || '',
          city: w.city || cur.city || null,
          oldPrice: baseline!,
          newPrice: cur.price,
          thumb: w.thumb || cur.thumb || null,
          brokerage: cur.brokerage ?? null,
        });
        dropsByUser.set(w.user_id, list);
        rowPatches.push({
          id: w.id,
          user_id: w.user_id,
          alerted: true,
          patch: {
            list_price: cur.price,
            last_known_status: cur.status,
            last_alerted_price: cur.price,
            last_alerted_at: runStartIso,
          },
        });
      } else if (!event) {
        const patch: Record<string, unknown> = {};
        if (baseline == null || cur.price > baseline) patch.list_price = cur.price;
        if (cur.status !== w.last_known_status) patch.last_known_status = cur.status;
        if (Object.keys(patch).length) {
          // Silent baseline refresh — safe to apply regardless of email outcome.
          rowPatches.push({ id: w.id, user_id: w.user_id, alerted: false, patch });
        }
      }
    }
  }

  // ── Relist scan ────────────────────────────────────────────────────────────
  // A campaign that died WITHOUT a transaction (tonight's off-market/gone event, or a
  // baseline resolved on an earlier night within the 90-day window) is checked for the
  // same physical address being ACTIVE again under a new MLS# — the terminate-then-
  // relist the dashboard already detects; now email says the same thing.
  const runStartMs = Date.parse(runStartIso);
  const eventRowIds = new Set(pendingEvents.map((p) => p.w.id));
  const relistCandidateRows: WatchRow[] = [];
  for (const { w, event } of pendingEvents) {
    if (event.kind === 'off-market' || event.kind === 'gone') relistCandidateRows.push(w);
  }
  for (const w of watch) {
    if (eventRowIds.has(w.id)) continue;
    if (currents.get(w.listing_key) !== null) continue;
    if (!isRelistScanBaseline(w.last_known_status)) continue;
    const t = w.terminal_since ? Date.parse(w.terminal_since) : NaN;
    if (Number.isFinite(t) && runStartMs - t > RELIST_SCAN_WINDOW_MS) continue;
    relistCandidateRows.push(w); // terminal_since NULL → eligible; stamped below
  }

  const relistByKey = new Map<string, RelistTargetFull>();
  {
    const addrByKey = new Map<string, string | null>();
    for (const w of relistCandidateRows) {
      if (!addrByKey.has(w.listing_key)) addrByKey.set(w.listing_key, w.address);
    }
    const candidates = [...addrByKey].map(([key, address]) => ({ key, address }));
    for (let i = 0; i < candidates.length; i += LOOKUP_BATCH) {
      try {
        const part = await findRelists(ts, candidates.slice(i, i + LOOKUP_BATCH));
        for (const [k, v] of part) relistByKey.set(k, v);
      } catch (e) {
        console.error('[alerts] relist lookup failed:', e instanceof Error ? e.message : e);
        // Affected rows simply behave as "no relist found" tonight — retried tomorrow.
      }
    }
  }

  const watchedByUser = new Map<string, Set<string>>();
  for (const w of watch) {
    const set = watchedByUser.get(w.user_id) ?? new Set<string>();
    set.add(w.listing_key);
    watchedByUser.set(w.user_id, set);
  }

  /** Emit the relisted alert + baseline handling for one row. */
  const emitRelist = (w: WatchRow, target: RelistTargetFull) => {
    const list = statusByUser.get(w.user_id) ?? [];
    list.push({
      listing_key: target.newKey, // row links to the LIVE listing
      address: w.address || target.newAddress || '',
      city: w.city || null,
      kind: 'relisted',
      brokerage: target.brokerage ?? null,
      thumb: target.newThumb || w.thumb || null,
      newPrice: target.newPrice,
    });
    statusByUser.set(w.user_id, list);

    // Re-point the row to the new campaign so future drops/status track it — unless the
    // user ALSO saved the new key (unique user_id+listing_key), in which case the dead
    // row just resolves to 'Relisted' and never fires again.
    const userKeys = watchedByUser.get(w.user_id)!;
    const alreadyWatched = userKeys.has(target.newKey);
    if (!alreadyWatched) userKeys.add(target.newKey); // guard a second dead row re-pointing to the same key
    rowPatches.push({
      id: w.id,
      user_id: w.user_id,
      alerted: true,
      patch: alreadyWatched
        ? { last_known_status: 'Relisted', terminal_since: null }
        : {
            listing_key: target.newKey,
            address: target.newAddress ?? w.address,
            list_price: target.newPrice,
            last_known_status: target.newStatus ?? 'New',
            thumb: target.newThumb ?? w.thumb,
            last_alerted_price: null,
            terminal_since: null,
          },
    });
  };

  // Tonight's events: a live relist replaces off-market/gone; everything else emits as-is.
  for (const { w, event, cur } of pendingEvents) {
    const target =
      event.kind === 'off-market' || event.kind === 'gone' ? relistByKey.get(w.listing_key) : undefined;
    if (target) {
      emitRelist(w, target);
      continue;
    }
    const list = statusByUser.get(w.user_id) ?? [];
    list.push({
      listing_key: w.listing_key,
      address: w.address || cur?.address || '',
      city: w.city || cur?.city || null,
      kind: event.kind,
      detail: event.detail,
      brokerage: cur?.brokerage ?? null,
      // Saved-at thumbnail first (survives the listing leaving the active index once
      // sold/off-market), else the fresh active-index photo. Photo is public; the sold
      // price stays gated. Same precedence the drop rows use.
      thumb: w.thumb || cur?.thumb || null,
    });
    statusByUser.set(w.user_id, list);
    const patch: Record<string, unknown> = {
      last_known_status: resolvedBaseline(event) ?? cur?.status ?? null,
    };
    // Start the 90-day relist-scan window for campaigns that died without a transaction.
    if (event.kind === 'off-market' || event.kind === 'gone') patch.terminal_since = runStartIso;
    rowPatches.push({ id: w.id, user_id: w.user_id, alerted: true, patch });
  }

  // Previously-resolved rows: relist found → alert; none → stamp the scan window once.
  for (const w of relistCandidateRows) {
    if (eventRowIds.has(w.id)) continue; // handled above
    const target = relistByKey.get(w.listing_key);
    if (target) emitRelist(w, target);
    else if (!w.terminal_since) {
      rowPatches.push({ id: w.id, user_id: w.user_id, alerted: false, patch: { terminal_since: runStartIso } });
    }
  }

  // ── Bubbles phase (new-listing alerts) ─────────────────────────────────────
  const bubbleMatchesByUser = new Map<string, BubbleMatches[]>();
  const bubbleAdvances: Array<{ id: string; user_id: string; alerted: boolean; patch: Record<string, unknown> }> = [];

  let hasNotifiedKeys = true;
  let bubbleData: BubbleRow[] | null = null;
  let bubbleErrMsg: string | null = null;
  {
    const first = await supabase
      .from('market_bubbles')
      .select('id, user_id, name, area_type, polygon, source, notify_since, notified_keys, alert_scope, filters')
      .eq('alerts_enabled', true);
    if (!first.error) {
      bubbleData = (first.data ?? []) as unknown as BubbleRow[];
    } else {
      // Pre-095 (no alert_scope) or pre-083 (no notified_keys): degrade in order.
      const pre095 = await supabase
        .from('market_bubbles')
        .select('id, user_id, name, area_type, polygon, source, notify_since, notified_keys')
        .eq('alerts_enabled', true);
      if (!pre095.error) {
        bubbleData = (pre095.data ?? []) as unknown as BubbleRow[]; // alert_scope undefined → 'all'
      } else {
        hasNotifiedKeys = false;
        const legacy = await supabase
          .from('market_bubbles')
          .select('id, user_id, name, area_type, polygon, source, notify_since')
          .eq('alerts_enabled', true);
        if (legacy.error) bubbleErrMsg = legacy.error.message;
        else bubbleData = (legacy.data ?? []).map((r) => ({ ...r, notified_keys: [] })) as unknown as BubbleRow[];
      }
    }
  }

  if (bubbleErrMsg !== null) {
    // Pre-migration-034 deploys land here (unknown column) — skip the phase, never the run.
    console.warn(`[alerts] bubbles phase skipped: ${bubbleErrMsg}`);
  } else {
    for (const b of bubbleData ?? []) {
      try {
        if (!b.notify_since) {
          // First sight: baseline silently (no backlog dumps). Nothing was
          // emailed, so the watermark advances unconditionally.
          await supabase.from('market_bubbles').update({ notify_since: runStartIso }).eq('id', b.id);
          continue;
        }
        const areaClause = buildAreaClause({
          area_type: b.area_type,
          polygon: b.polygon,
          source: b.source as Parameters<typeof buildAreaClause>[0]['source'],
        });
        if (!areaClause) continue;

        // 72h lookback past the watermark: EntryTimestamp is the MLS entry time, and a
        // listing can reach OUR index a day or two later (late publication, sync backlog).
        // The strict watermark silently dropped those; notified_keys dedupes the overlap.
        const notified: NotifiedKey[] = hasNotifiedKeys ? parseNotifiedKeys(b.notified_keys) : [];
        const watermarkMs = new Date(b.notify_since).getTime();
        const sinceMs = hasNotifiedKeys ? watermarkMs - BUBBLE_LOOKBACK_MS : watermarkMs;

        // alert_scope 'filtered': swap the bare price floor for the bubble's saved
        // filter snapshot, translated by the SAME builder the terminal search uses
        // (bubbleAlertFilter). Pre-095 snapshots translate to null → 'all' behaviour.
        const scoped = b.alert_scope === 'filtered' ? bubbleAlertFilter(b.filters) : { clause: null, label: null };
        const baseClauses = scoped.clause ?? SALES_FLOOR;

        const res = await ts.collections('properties').documents().search({
          q: '*',
          query_by: 'City',
          filter_by: `${baseClauses} && ${areaClause} && EntryTimestamp:>${sinceMs}`,
          sort_by: 'EntryTimestamp:desc',
          per_page: MAX_BUBBLE_FETCH,
          include_fields:
            'id,UnparsedAddress,City,ListPrice,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,EntryTimestamp,primaryImageUrl',
        });

        const fetched: NewListingAlert[] = (res.hits ?? []).map((h) => {
          const d = h.document as Record<string, unknown>;
          const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
          return {
            listing_key: String(d.id ?? ''),
            address: (d.UnparsedAddress as string) || 'New listing',
            city: (d.City as string) || null,
            price: num(d.ListPrice),
            beds: num(d.BedroomsTotal),
            baths: num(d.BathroomsTotalInteger),
            brokerage: (d.ListOfficeName as string) || null,
            // Same precedence the app cards use (thumbnailUrl || primaryImageUrl); only
            // primaryImageUrl is in the properties schema, so thumbnailUrl is just a guard.
            thumb: (d.thumbnailUrl as string) || (d.primaryImageUrl as string) || null,
            entryMs: Number(d.EntryTimestamp) || 0,
          };
        });
        const matches = filterFreshMatches(fetched, notified);

        const advancePatch: Record<string, unknown> = { notify_since: runStartIso };
        if (hasNotifiedKeys) {
          advancePatch.notified_keys = advanceNotifiedKeys(
            notified,
            matches.map((m) => m.listing_key),
            runStartMs
          );
        }

        if (matches.length === 0) {
          bubbleAdvances.push({ id: b.id, user_id: b.user_id, alerted: false, patch: advancePatch });
          continue;
        }
        // The lookback window re-fetches already-alerted keys; shrink the displayed
        // total by however many the dedup dropped (same rule buildBubbleSections uses).
        const total = Math.max(matches.length, (res.found ?? fetched.length) - (fetched.length - matches.length));
        const list = bubbleMatchesByUser.get(b.user_id) ?? [];
        list.push({ bubbleId: b.id, bubbleName: b.name, total, matches, filterLabel: scoped.label });
        bubbleMatchesByUser.set(b.user_id, list);
        bubbleAdvances.push({ id: b.id, user_id: b.user_id, alerted: true, patch: advancePatch });
      } catch (e) {
        console.error('[alerts] bubble failed', b.id, e instanceof Error ? e.message : e);
        // No watermark advance — retried tomorrow.
      }
    }
  }

  // ── Compose + send one digest per affected user ────────────────────────────
  const userIds = new Set<string>([
    ...dropsByUser.keys(),
    ...statusByUser.keys(),
    ...bubbleMatchesByUser.keys(),
  ]);

  // One profile lookup per user, reused for sending and baseline gating.
  const emails = new Map<string, string | null>();
  const optedOut = new Map<string, boolean>();
  for (const userId of userIds) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, marketing_opt_out')
      .eq('id', userId)
      .single();
    emails.set(userId, (profile?.email as string | undefined) ?? null);
    optedOut.set(userId, (profile as { marketing_opt_out?: boolean } | null)?.marketing_opt_out === true);
  }

  // Per-stream preferences (migration 106). ONE batched read for tonight's affected users —
  // the table is small and only these users can receive anything.
  //
  // Until this existed the digest honoured only marketing_opt_out, so switching off
  // "Saved home & area alerts" or pressing "Pause all emails for 30 days" on
  // /account/emails changed nothing. Absence of a row means all streams on, so an
  // unreadable table degrades to today's behaviour rather than muting everyone.
  const prefsByUser = new Map<string, EmailPrefsRow>();
  if (userIds.size) {
    try {
      const { data, error } = await supabase
        .from('email_prefs')
        .select('user_id, alerts, cadence, pause_until')
        .in('user_id', [...userIds]);
      if (error) {
        console.warn(`[alerts] email_prefs unavailable (${error.message}) — treating every stream as on`);
      } else {
        for (const row of data ?? []) {
          const r = row as { user_id: string } & EmailPrefsRow;
          prefsByUser.set(r.user_id, r);
        }
      }
    } catch (e) {
      // supabase-js REJECTS on a dropped fetch instead of returning { error } — a network
      // blip here must not mute the whole night.
      console.warn('[alerts] email_prefs read threw — treating every stream as on:', e instanceof Error ? e.message : e);
    }
  }

  const sentUsers = new Set<string>();
  let emailed = 0;
  let suppressed = 0;
  // Users who actually had a renderable digest tonight. Counted HERE, not as userIds.size,
  // so the canary's invariant (sent + suppressed + fell-through = due) is exact: a user who
  // reaches the map but renders to nothing was never owed an email.
  let due = 0;
  // Addresses that actually received a digest tonight. Recorded after the loop so the
  // weekly Data Drop can stand down for them — see stampDigestSent.
  const digested: string[] = [];
  for (const userId of userIds) {
    const payload: DigestPayload = {
      drops: dropsByUser.get(userId) ?? [],
      statusChanges: statusByUser.get(userId) ?? [],
      bubbles: buildBubbleSections(bubbleMatchesByUser.get(userId) ?? []),
    };
    if (!payload.drops.length && !payload.statusChanges.length && !payload.bubbles.length) continue;
    due++;

    const email = emails.get(userId);
    if (!email) continue;
    // Consent gate: one-click unsubscribe (marketing_opt_out), the per-stream "Saved home
    // & area alerts" toggle, or an active "Pause all emails for 30 days". Skip the send but
    // STILL advance baselines (add to sentUsers) so a resubscribe or the end of a pause
    // never dumps a backlog of every change they missed.
    if (!canSendAlerts({ now: runStartMs, marketingOptOut: optedOut.get(userId), prefs: prefsByUser.get(userId) })) {
      sentUsers.add(userId);
      suppressed++;
      continue;
    }

    const uUrl = marketingUnsubscribeUrl(email, SITE);
    const { subject, html, text } = renderAlertsDigest(payload, uUrl);
    try {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject,
        html,
        text,
        headers: { 'List-Unsubscribe': `<${uUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      sentUsers.add(userId);
      digested.push(email);
      emailed++;
    } catch (e) {
      console.error('[alerts] send failed for', userId, e instanceof Error ? e.message : e);
    }
  }

  await stampDigestSent(supabase, digested, new Date().toISOString());

  // ── Persist baselines ──────────────────────────────────────────────────────
  // Silent refreshes always apply. Alert-bearing patches apply when the user's
  // email went out — or when they have no email on file (sending can never
  // succeed, so advancing prevents an infinite re-alert loop).
  const shouldApply = (userId: string, alerted: boolean) =>
    !alerted || sentUsers.has(userId) || !emails.get(userId);

  for (const u of rowPatches) {
    if (!shouldApply(u.user_id, u.alerted)) continue;
    const patch = { ...u.patch };
    // Pre-083 the column doesn't exist; sending it would fail the WHOLE update and
    // freeze the row's baseline (repeat alerts) — strip it instead.
    if (!hasTerminalSince) delete patch.terminal_since;
    if (!Object.keys(patch).length) continue;
    const { error } = await supabase.from('watchlist').update(patch).eq('id', u.id);
    if (error) console.error('[alerts] watchlist patch failed', u.id, error.message);
  }
  for (const b of bubbleAdvances) {
    if (!shouldApply(b.user_id, b.alerted)) continue;
    const { error } = await supabase.from('market_bubbles').update(b.patch).eq('id', b.id);
    if (error) console.error('[alerts] bubble advance failed', b.id, error.message);
  }

  // ── Listing-alerts phase (anonymous email-capture leads) ───────────────────
  // Independent audience/template with its own idempotent baselines; runs in the same
  // nightly invocation so no extra workflow step is needed.
  const la = await runListingAlertsPhase(ts, supabase, resend, {});

  // ── Address-watch phase ("Track this address" leads) ───────────────────────
  const aw = await runAddressWatchPhase(ts, supabase, resend, {});

  // Durable counters so "did the digest actually go out?" is a query, not a log grep.
  await recordEmailSendMetrics(supabase, {
    [EMAIL_METRICS.digestDue]: due,
    [EMAIL_METRICS.digestSent]: emailed,
    [EMAIL_METRICS.digestSuppressed]: suppressed,
  });

  console.log(
    `[alerts] Done. ${watch.length} watched, ${userIds.size} users with events, ${due} owed a digest, ` +
      `${emailed} emails sent, ${suppressed} suppressed on consent. ` +
      `Listing-alerts: ${la.emailed} emailed, ${la.baselined} baselined, ${la.similarMatched} similar matches. ` +
      `Address-watches: ${aw.emailed} emailed, ${aw.baselined} baselined.`
  );
}

// Only run the CLI when executed directly (matches sync.ts / transformer.ts).
// Importing this module (e.g. from tests) must not fire main() — that would
// call Supabase + Resend at import time and crash any consumer.
const isMainModule =
  typeof process !== 'undefined' && process.argv[1]?.includes('alerts.ts');
if (isMainModule) {
  main().catch((e) => {
    console.error('[alerts] Fatal:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
