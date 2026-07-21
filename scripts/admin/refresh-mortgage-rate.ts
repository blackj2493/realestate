/**
 * Refresh market_rates.five_year_fixed — the calculator's mortgage-rate seed.
 *
 * Pulls the latest Bank of Canada Valet observation for the 5-year conventional
 * mortgage (posted), trues it down to a typical discounted street rate, sanity-
 * bounds the result, and upserts it into market_rates. Read by
 * src/lib/finance/getMortgageRate.ts (24h cache, hardcoded fallback).
 *
 * Cheap by design: one free, keyless HTTP GET per run; monthly cadence. On ANY
 * problem (fetch error, unparseable payload, out-of-band value) it writes NOTHING
 * and exits non-zero — the last good row keeps serving and notifyRun.ts emails the
 * failure. Guards the dominant "silent-null freezes into cache" failure mode.
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-mortgage-rate.ts            # dry-run (prints, no write)
 *   npx tsx scripts/admin/refresh-mortgage-rate.ts --apply    # upsert market_rates
 */

// TLS env before importing the supabase client (mirrors the other refresh jobs).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  MORTGAGE_RATE_KEY,
  BOC_VALET_SERIES,
  POSTED_TO_STREET_DISCOUNT_PCT,
  MORTGAGE_RATE_BOUNDS,
  parseValetLatest,
  resolveStreetRate,
  sanitizeRatePct,
} from "@/lib/finance/mortgageRates";

dotenv.config({ path: [".env.local", ".env"] });

const APPLY = process.argv.includes("--apply");
const VALET_URL = `https://www.bankofcanada.ca/valet/observations/${BOC_VALET_SERIES}/json?recent=1`;

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`Mortgage-rate refresh · series ${BOC_VALET_SERIES} · ${APPLY ? "APPLY" : "dry-run"}`);

  // 1) Fetch (bounded — a hung endpoint must not hang the job).
  let raw: unknown;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(VALET_URL, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) die(`Bank of Canada Valet returned HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    die(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Parse + true posted → street.
  const latest = parseValetLatest(raw, BOC_VALET_SERIES);
  if (!latest) die(`could not parse a ${BOC_VALET_SERIES} observation from the Valet payload`);
  const street = resolveStreetRate(latest.valuePct, POSTED_TO_STREET_DISCOUNT_PCT);
  const rate = sanitizeRatePct(street);

  console.log(
    `  posted ${latest.valuePct}% (as of ${latest.date}) − ${POSTED_TO_STREET_DISCOUNT_PCT}% discount → street ${street.toFixed(3)}%`
  );

  // 3) Bounds guard — reject garbage rather than freezing it into the seed.
  if (rate == null) {
    die(
      `resolved rate ${street.toFixed(3)}% is outside the sanity band ` +
        `[${MORTGAGE_RATE_BOUNDS.minPct}, ${MORTGAGE_RATE_BOUNDS.maxPct}] — not writing`
    );
  }

  if (!APPLY) {
    console.log(`  would write: ${MORTGAGE_RATE_KEY} = ${rate}% (as_of ${latest.date}). Re-run with --apply.`);
    return;
  }

  // 4) Upsert (only reached with a valid, in-band rate).
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) die("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.from("market_rates").upsert(
    {
      key: MORTGAGE_RATE_KEY,
      rate_pct: rate,
      as_of: latest.date,
      source: `Bank of Canada Valet ${BOC_VALET_SERIES} (posted) − ${POSTED_TO_STREET_DISCOUNT_PCT}% discount`,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (error) die(`upsert failed: ${error.message}`);

  console.log(`✅ wrote ${MORTGAGE_RATE_KEY} = ${rate}% (as of ${latest.date}).`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
