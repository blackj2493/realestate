/**
 * Nightly alerts digest — price drops + status changes (watchlist) + new
 * listings (saved market bubbles). ONE email per user per day.
 *
 * Architecture: compare-at-read (spec docs/superpowers/specs/2026-06-10-granular-alerts-design.md).
 * Baselines: watchlist.list_price / last_known_status, market_bubbles.notify_since.
 * Cadence is DAILY — it piggybacks the once-a-day sync and matches the 24h data
 * freshness rule (CLAUDE.md §4). No realtime claims.
 *
 * Compliance: deterministic comparisons only — no LLM touches listing data (§4).
 * Sold prices NEVER appear in email (the sold row is a tease linking to the
 * gated listing page); the listing brokerage is shown on every row.
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
import { classifyStatusChange, isTerminalStatus, resolvedBaseline } from '@/lib/alerts/transitions';
import {
  buildBubbleSections,
  type BubbleMatches,
  type NewListingAlert,
} from '@/lib/alerts/bubbleDigest';
import {
  renderAlertsDigest,
  type DigestPayload,
  type DropAlert,
  type StatusChangeAlert,
} from '@/lib/alerts/digest';
import { renderListingAlertEmail, type ListingAlertChange } from '@/lib/alerts/listingAlertEmail';
import { unsubscribeUrl, marketingUnsubscribeUrl } from '@/lib/alerts/unsubscribe';
import { SENDERS } from '@/lib/alerts/senders';

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
}

interface BubbleRow {
  id: string;
  user_id: string;
  name: string;
  area_type: 'draw' | 'commute' | 'school';
  polygon: [number, number][];
  source: { kind: string; schoolKey?: string };
  notify_since: string | null;
}

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
}

/**
 * Listing-alerts phase — the ANONYMOUS email-capture leads (listing_alerts table), which
 * have no account so are invisible to the watchlist phase above. Same compare-at-read model:
 * seed a per-subscription baseline on first sight (silent), then email on a real price drop
 * or status change, advancing the baseline ONLY after a successful send (idempotent).
 * One digest per email address (a lead can watch several listings). `similar` subscriptions
 * (new-inventory matching) are NOT delivered yet — counted and deferred.
 *
 * Exported + `dryRun` so it can be exercised in isolation without importing/running main()
 * (which would fire the live watchlist send). dryRun performs ZERO writes and ZERO sends.
 */
export async function runListingAlertsPhase(
  ts: Client,
  supabase: ReturnType<typeof getServiceRoleClient>,
  resend: Resend,
  opts: { dryRun?: boolean } = {}
): Promise<{ processed: number; baselined: number; emailed: number; deferred: number }> {
  const dryRun = !!opts.dryRun;
  const runStartIso = new Date().toISOString();

  // Page through active subscriptions (PostgREST caps a select at 1,000 rows).
  const rows: ListingAlertRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('listing_alerts')
      .select('id, listing_key, email, address, city, kind, last_price, last_status')
      .eq('status', 'active')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) {
      // Pre-migration-051/052 deploys (missing table/columns) → skip the phase, never the run.
      console.warn(`[alerts] listing_alerts phase skipped: ${error.message}`);
      return { processed: 0, baselined: 0, emailed: 0, deferred: 0 };
    }
    const chunk = (data ?? []) as ListingAlertRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }

  const deferred = rows.filter((r) => r.kind === 'similar').length; // new-listing matching not built yet
  const actionable = rows.filter((r) => r.kind !== 'similar');
  if (actionable.length === 0) {
    if (deferred) console.log(`[alerts] listing_alerts: 0 actionable, ${deferred} 'similar' deferred.`);
    return { processed: 0, baselined: 0, emailed: 0, deferred };
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

  // Silent refreshes always apply.
  for (const p of silentPatches) await supabase.from('listing_alerts').update(p.patch).eq('id', p.id);

  // One digest per email; advance that email's baselines only after a successful send.
  let emailed = 0;
  for (const [email, changes] of changesByEmail) {
    const uUrl = unsubscribeUrl(email, SITE);
    const { subject, html, text } = renderListingAlertEmail({ changes, unsubscribeUrl: uUrl });
    if (dryRun) {
      console.log(`[alerts][dry-run] listing-alert → ${email}: "${subject}" (${changes.length} change(s))`);
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
    `[alerts] listing_alerts: ${actionable.length} active, ${baselined} baselined, ${emailed} emailed, ${deferred} deferred.`
  );
  return { processed: actionable.length, baselined, emailed, deferred };
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
  const allRows: WatchRow[] = [];
  let offset = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('watchlist')
      .select('id, user_id, listing_key, address, city, thumb, list_price, last_known_status, last_alerted_price')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`watchlist read failed: ${error.message}`);
    const chunk = (page ?? []) as WatchRow[];
    allRows.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  const watch = allRows;

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

  for (const w of watch) {
    const cur = currents.get(w.listing_key) ?? null;

    // Status classification (handles both present and vanished docs).
    const event = classifyStatusChange({
      prev: w.last_known_status,
      current: cur?.status ?? null,
      soldHit: soldHits.get(w.listing_key) ?? false,
      fallbackStatus: fallbackStatuses.get(w.listing_key) ?? null,
    });

    if (event) {
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
      rowPatches.push({
        id: w.id,
        user_id: w.user_id,
        alerted: true,
        patch: { last_known_status: resolvedBaseline(event) ?? cur?.status ?? null },
      });
    }

    // Price drops — unchanged semantics; only for docs still present with a price.
    if (cur && cur.price != null) {
      const baseline = w.list_price;
      const isNewDrop = baseline != null && cur.price < baseline && cur.price !== w.last_alerted_price;
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
      } else if (!event && (baseline == null || cur.price !== baseline || cur.status !== w.last_known_status)) {
        // Silent baseline refresh — safe to apply regardless of email outcome.
        rowPatches.push({
          id: w.id,
          user_id: w.user_id,
          alerted: false,
          patch: { list_price: cur.price, last_known_status: cur.status },
        });
      }
    }
  }

  // ── Bubbles phase (new-listing alerts) ─────────────────────────────────────
  const bubbleMatchesByUser = new Map<string, BubbleMatches[]>();
  const bubbleAdvances: Array<{ id: string; user_id: string; alerted: boolean }> = [];

  const { data: bubbleRows, error: bubbleErr } = await supabase
    .from('market_bubbles')
    .select('id, user_id, name, area_type, polygon, source, notify_since')
    .eq('alerts_enabled', true);

  if (bubbleErr) {
    // Pre-migration-034 deploys land here (unknown column) — skip the phase, never the run.
    console.warn(`[alerts] bubbles phase skipped: ${bubbleErr.message}`);
  } else {
    for (const b of (bubbleRows ?? []) as BubbleRow[]) {
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

        const sinceMs = new Date(b.notify_since).getTime();
        const res = await ts.collections('properties').documents().search({
          q: '*',
          query_by: 'City',
          filter_by: `${SALES_FLOOR} && ${areaClause} && EntryTimestamp:>${sinceMs}`,
          sort_by: 'EntryTimestamp:desc',
          per_page: MAX_BUBBLE_FETCH,
          include_fields:
            'id,UnparsedAddress,City,ListPrice,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,EntryTimestamp,primaryImageUrl',
        });

        const matches: NewListingAlert[] = (res.hits ?? []).map((h) => {
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

        if (matches.length === 0) {
          bubbleAdvances.push({ id: b.id, user_id: b.user_id, alerted: false });
          continue;
        }
        const list = bubbleMatchesByUser.get(b.user_id) ?? [];
        list.push({ bubbleId: b.id, bubbleName: b.name, total: res.found ?? matches.length, matches });
        bubbleMatchesByUser.set(b.user_id, list);
        bubbleAdvances.push({ id: b.id, user_id: b.user_id, alerted: true });
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

  const sentUsers = new Set<string>();
  let emailed = 0;
  for (const userId of userIds) {
    const payload: DigestPayload = {
      drops: dropsByUser.get(userId) ?? [],
      statusChanges: statusByUser.get(userId) ?? [],
      bubbles: buildBubbleSections(bubbleMatchesByUser.get(userId) ?? []),
    };
    if (!payload.drops.length && !payload.statusChanges.length && !payload.bubbles.length) continue;

    const email = emails.get(userId);
    if (!email) continue;
    // One-click unsubscribe (marketing_opt_out): skip the send but still advance baselines
    // (add to sentUsers below) so a resubscribe never dumps a backlog of missed changes.
    if (optedOut.get(userId)) {
      sentUsers.add(userId);
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
      emailed++;
    } catch (e) {
      console.error('[alerts] send failed for', userId, e instanceof Error ? e.message : e);
    }
  }

  // ── Persist baselines ──────────────────────────────────────────────────────
  // Silent refreshes always apply. Alert-bearing patches apply when the user's
  // email went out — or when they have no email on file (sending can never
  // succeed, so advancing prevents an infinite re-alert loop).
  const shouldApply = (userId: string, alerted: boolean) =>
    !alerted || sentUsers.has(userId) || !emails.get(userId);

  for (const u of rowPatches) {
    if (!shouldApply(u.user_id, u.alerted)) continue;
    await supabase.from('watchlist').update(u.patch).eq('id', u.id);
  }
  for (const b of bubbleAdvances) {
    if (!shouldApply(b.user_id, b.alerted)) continue;
    await supabase.from('market_bubbles').update({ notify_since: runStartIso }).eq('id', b.id);
  }

  // ── Listing-alerts phase (anonymous email-capture leads) ───────────────────
  // Independent audience/template with its own idempotent baselines; runs in the same
  // nightly invocation so no extra workflow step is needed.
  const la = await runListingAlertsPhase(ts, supabase, resend, {});

  console.log(
    `[alerts] Done. ${watch.length} watched, ${userIds.size} users with events, ${emailed} emails sent. ` +
      `Listing-alerts: ${la.emailed} emailed, ${la.baselined} baselined, ${la.deferred} deferred.`
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
