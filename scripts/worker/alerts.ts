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

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <alerts@pureproperty.ca>';
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

function getTypesense(): Client {
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
            'id,UnparsedAddress,City,ListPrice,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,EntryTimestamp',
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
  for (const userId of userIds) {
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).single();
    emails.set(userId, (profile?.email as string | undefined) ?? null);
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

    const { subject, html, text } = renderAlertsDigest(payload);
    try {
      await resend.emails.send({ from: FROM, to: email, subject, html, text });
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

  console.log(
    `[alerts] Done. ${watch.length} watched, ${userIds.size} users with events, ${emailed} emails sent.`
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
