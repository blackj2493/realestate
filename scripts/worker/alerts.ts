/**
 * Watchlist price-drop email digest.
 *
 * Runs after the nightly sync (see .github/workflows/daily-sync.yml). For every
 * saved property it compares the current list price (Typesense `properties`,
 * the same index the app reads) against the last-known price stored on the
 * watchlist row, then emails each affected user a single digest of the drops.
 *
 * Cadence is DAILY — it piggybacks the once-a-day sync and matches the 24h data
 * freshness rule (CLAUDE.md §4). No realtime claims.
 *
 * Compliance: deterministic comparison only — no LLM touches listing data (§4).
 * Idempotent: `last_alerted_price` dedupes so a given drop is emailed once.
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

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <alerts@pureproperty.ca>';
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pureproperty.ca').replace(/\/$/, '');

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

interface Current {
  price: number | null;
  status: string | null;
  address?: string;
  city?: string;
  thumb?: string;
}

export interface DropAlert {
  listing_key: string;
  address: string;
  city: string | null;
  oldPrice: number;
  newPrice: number;
  thumb: string | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;

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
    };
  } catch {
    return null; // not in the active index (sold / expired / removed)
  }
}

export function renderDigest(drops: DropAlert[]): { subject: string; html: string; text: string } {
  const n = drops.length;
  const subject = `${n} price drop${n === 1 ? '' : 's'} on your watchlist`;

  const rows = drops
    .map((d) => {
      const url = `${SITE}/properties/${encodeURIComponent(d.listing_key)}`;
      const cut = d.oldPrice - d.newPrice;
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
            <a href="${url}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;">
              ${d.address || 'Saved property'}
            </a>
            <div style="color:#64748b;font-size:12px;margin-top:2px;">${d.city || ''}</div>
            <div style="margin-top:6px;font-size:14px;">
              <span style="color:#94a3b8;text-decoration:line-through;">${money(d.oldPrice)}</span>
              &nbsp;→&nbsp;
              <span style="color:#0f766e;font-weight:700;">${money(d.newPrice)}</span>
              <span style="color:#dc2626;font-weight:600;">&nbsp;(−${money(cut)})</span>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">Price drops on your watchlist</h1>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;">
        ${n} of your saved ${n === 1 ? 'property has' : 'properties have'} dropped in price.
      </p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <a href="${SITE}/dashboard"
         style="display:inline-block;margin-top:20px;background:#0891b2;color:#fff;text-decoration:none;
                padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;">
        Open your dashboard
      </a>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;line-height:1.5;">
        You're receiving this because you saved these properties on PureProperty.ca.
        Data is deemed reliable but is not guaranteed accurate. Powered by PROPTX MLS®.
      </p>
    </div>
  </body></html>`;

  const text =
    `Price drops on your watchlist (${n}):\n\n` +
    drops
      .map(
        (d) =>
          `• ${d.address || 'Saved property'} — ${money(d.oldPrice)} -> ${money(d.newPrice)} ` +
          `(-${money(d.oldPrice - d.newPrice)})\n  ${SITE}/properties/${d.listing_key}`
      )
      .join('\n') +
    `\n\nOpen your dashboard: ${SITE}/dashboard`;

  return { subject, html, text };
}

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[alerts] RESEND_API_KEY not set — skipping watchlist digest.');
    return;
  }

  const supabase = getServiceRoleClient();
  const ts = getTypesense();
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('id, user_id, listing_key, address, city, thumb, list_price, last_known_status, last_alerted_price');

  if (error) throw new Error(`watchlist read failed: ${error.message}`);
  const watch = (rows ?? []) as WatchRow[];
  if (watch.length === 0) {
    console.log('[alerts] No watchlist rows. Done.');
    return;
  }

  // Look up each distinct listing once.
  const currents = new Map<string, Current | null>();
  for (const key of new Set(watch.map((w) => w.listing_key))) {
    currents.set(key, await fetchCurrent(ts, key));
  }

  const dropsByUser = new Map<string, DropAlert[]>();
  const rowUpdates: Array<{
    id: string;
    list_price: number;
    last_known_status: string | null;
    alerted?: number;
  }> = [];

  for (const w of watch) {
    const cur = currents.get(w.listing_key);
    if (!cur || cur.price == null) continue; // gone or unknown price — leave as is

    const baseline = w.list_price;
    const isNewDrop =
      baseline != null && cur.price < baseline && cur.price !== w.last_alerted_price;

    if (isNewDrop) {
      const list = dropsByUser.get(w.user_id) ?? [];
      list.push({
        listing_key: w.listing_key,
        address: w.address || cur.address || '',
        city: w.city || cur.city || null,
        oldPrice: baseline!,
        newPrice: cur.price,
        thumb: w.thumb || cur.thumb || null,
      });
      dropsByUser.set(w.user_id, list);
      rowUpdates.push({ id: w.id, list_price: cur.price, last_known_status: cur.status, alerted: cur.price });
    } else if (baseline == null || cur.price !== baseline || cur.status !== w.last_known_status) {
      // Keep the stored snapshot current even when there's nothing to email.
      rowUpdates.push({ id: w.id, list_price: cur.price, last_known_status: cur.status });
    }
  }

  // Email each affected user a single digest.
  let emailed = 0;
  for (const [userId, drops] of dropsByUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();
    const email = profile?.email as string | undefined;
    if (!email) continue;

    const { subject, html, text } = renderDigest(drops);
    try {
      await resend.emails.send({ from: FROM, to: email, subject, html, text });
      emailed++;
    } catch (e) {
      console.error('[alerts] send failed for', userId, e instanceof Error ? e.message : e);
    }
  }

  // Persist updated baselines / dedupe markers.
  const nowIso = new Date().toISOString();
  for (const u of rowUpdates) {
    const patch: Record<string, unknown> = {
      list_price: u.list_price,
      last_known_status: u.last_known_status,
    };
    if (u.alerted != null) {
      patch.last_alerted_price = u.alerted;
      patch.last_alerted_at = nowIso;
    }
    await supabase.from('watchlist').update(patch).eq('id', u.id);
  }

  console.log(
    `[alerts] Done. ${watch.length} watched, ${dropsByUser.size} users with drops, ${emailed} emails sent.`
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
