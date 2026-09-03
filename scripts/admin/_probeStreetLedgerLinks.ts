/**
 * Do the street-ledger links actually go anywhere? — read-only probe.
 *
 * The ledger's rows became links, and a link is a promise: every row now claims the
 * record has a page. This asks prod whether that is true, for real rows on real streets.
 *
 * Three questions, in order:
 *  1. Does `ledgerRowHref` produce a URL for every row real data yields, and does the
 *     route's own parser read the key back out of it?
 *  2. Does that URL RESOLVE on www? Fetched signed-out, so a live record answers 200
 *     with its anon teaser and a suppressed or missing one answers 404. No auth needed:
 *     the question is whether the page exists, not what it shows a consumer.
 *  3. How many rows does the seller opt-out gate remove, and would those rows have been
 *     links to a 404? That is the gate's whole justification, so it is measured, not
 *     asserted.
 *
 * WIRING NOTE: `getStreetLedgerGated` cannot be called from a plain script —
 * `unstable_cache` throws "incrementalCache missing" outside a Next request. So the fetch
 * below repeats the query and the loop, but every DECISION is the real exported function
 * (localityMatch, fsaOf, streetNamesMatch, parseAddress, isOptedOutValue, ledgerRowHref).
 * Keep the SELECT and the predicate order in step with streetLedger.ts if either changes.
 *
 * Reads only — Supabase over PostgREST plus anonymous GETs of our own public pages.
 * Run: npx.cmd tsx --env-file=../Realestate/.env scripts/admin/_probeStreetLedgerLinks.ts
 */
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { parseAddress, streetNamesMatch } from '../../src/lib/watchlist/disposition';
import { isOptedOutValue } from '../../src/lib/compliance/internetDisplay';
import { extractListingKey } from '../../src/lib/listings/listingPath';
import { localityMatch, fsaOf, ledgerRowHref, type LedgerSale } from '../../src/lib/address/streetLedger';

const SITE = 'https://www.pureproperty.ca';
const SCAN_LIMIT = 200;
const MAX_SALES = 80;

/** Streets chosen to span the failure modes the ledger has actually hit: the OREB
 *  naming split, a Toronto district code, a directional city, and a plain small town. */
const SUBJECTS: Array<{ address: string; city: string; postal: string | null; why: string }> = [
  { address: '761 Cappamore Drive', city: 'Nepean', postal: 'K2J 6W3', why: 'geocoder city != feed city (Barrhaven)' },
  { address: '127 Via Toscana', city: 'Vaughan', postal: null, why: 'known sold record, no postal' },
  { address: '100 Yonge Street', city: 'Toronto', postal: 'M5C 2W1', why: 'Toronto district codes' },
  { address: '3380 Singleton Avenue', city: 'London', postal: 'N6L 0E4', why: 'directional city suffix' },
  { address: '39 Centennial Heights Court', city: 'Meaford', postal: null, why: 'small town, thin street' },
  { address: '188 Maplehurst Avenue', city: 'Toronto', postal: null, why: 'the #475 opt-out street' },
];

interface Row {
  sale: LedgerSale;
  href: string | null;
  optedOut: boolean;
}

function probeToken(streetName: string): string | null {
  const tokens = streetName.split(/\s+/).filter((t) => t.length >= 4);
  return tokens.length ? tokens.sort((a, b) => b.length - a.length)[0] : null;
}

/** The streetLedger fetch, minus unstable_cache, keeping opted-out rows so they can be
 *  counted rather than silently dropped. */
async function ledgerRows(address: string, city: string, postal: string | null): Promise<Row[] | null> {
  const streetName = parseAddress(`${address}, ${city}`).streetName;
  const token = streetName ? probeToken(streetName) : null;
  if (!streetName || !token) return null;
  const fsa = fsaOf(postal);
  const { data, error } = await getServiceRoleClient()
    .from('raw_vow_sold')
    .select(
      'listing_key, unparsed_address, city, city_region, close_price, purchase_contract_date, property_sub_type, ' +
        'internet_display:raw_payload->>InternetEntireListingDisplayYN, ' +
        'internet_address_display:raw_payload->>InternetAddressDisplayYN'
    )
    .ilike('unparsed_address', `%${token.replace(/[%_,()]/g, '')}%`)
    .eq('transaction_type', 'For Sale')
    .gte('close_price', 1)
    .order('purchase_contract_date', { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) {
    console.error(`  query failed: ${error.message}`);
    return null;
  }

  const rows: Row[] = [];
  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const rowAddress = typeof r.unparsed_address === 'string' ? r.unparsed_address : '';
    const parsed = parseAddress(rowAddress);
    if (!streetNamesMatch(streetName, parsed.streetName)) continue;
    const rowCity = typeof r.city === 'string' ? r.city : '';
    if (!localityMatch(city, fsa, rowCity, typeof r.city_region === 'string' ? r.city_region : '', fsaOf(parsed.postal)))
      continue;
    const close = Number(r.close_price);
    const dateISO = typeof r.purchase_contract_date === 'string' ? r.purchase_contract_date : '';
    if (!(close >= 1) || !dateISO) continue;
    const sale: LedgerSale = {
      listingKey: String(r.listing_key ?? ''),
      address: rowAddress.split(',')[0].trim(),
      city: rowCity,
      closePrice: close,
      dateISO: dateISO.slice(0, 10),
      subType: typeof r.property_sub_type === 'string' && r.property_sub_type ? r.property_sub_type : null,
    };
    rows.push({
      sale,
      href: ledgerRowHref(sale),
      optedOut: isOptedOutValue(r.internet_display) || isOptedOutValue(r.internet_address_display),
    });
    if (rows.length >= MAX_SALES) break;
  }
  return rows;
}

const statusCache = new Map<string, number>();
async function status(href: string): Promise<number> {
  const cached = statusCache.get(href);
  if (cached !== undefined) return cached;
  try {
    // GET, not HEAD: the route is force-dynamic and a HEAD can short-circuit before the
    // record lookup that decides 200 vs 404 — the exact thing being measured.
    const res = await fetch(`${SITE}${href}`, { redirect: 'follow', headers: { 'user-agent': 'pp-link-probe' } });
    statusCache.set(href, res.status);
    return res.status;
  } catch {
    statusCache.set(href, 0);
    return 0;
  }
}

async function main() {
  const totals = { rows: 0, linked: 0, unlinked: 0, ok: 0, notFound: 0, other: 0, optedOut: 0, optedOutLive: 0 };
  const badKeys: string[] = [];
  const broken: string[] = [];

  for (const s of SUBJECTS) {
    const rows = await ledgerRows(s.address, s.city, s.postal);
    console.log(`\n=== ${s.address}, ${s.city} — ${s.why}`);
    if (!rows) {
      console.log('  no street name / no rows');
      continue;
    }
    const kept = rows.filter((r) => !r.optedOut);
    console.log(`  ${rows.length} row(s) matched, ${rows.length - kept.length} removed by the opt-out gate`);
    totals.optedOut += rows.length - kept.length;

    // Every opted-out row, checked against prod: if these resolve, the gate costs a live
    // link; if they 404, the gate is what stops the ledger promising a dead page.
    for (const r of rows.filter((x) => x.optedOut)) {
      const href = ledgerRowHref(r.sale);
      if (!href) continue;
      const code = await status(href);
      if (code === 200) totals.optedOutLive++;
      console.log(`  [opted-out] ${r.sale.listingKey} ${href} -> ${code}`);
    }

    for (const r of kept) {
      totals.rows++;
      if (!r.href) {
        totals.unlinked++;
        badKeys.push(`${r.sale.listingKey} (${r.sale.address})`);
        continue;
      }
      totals.linked++;
      // Question 1: the route must read the key back out of the slug we built.
      const slug = r.href.split('/').pop()!;
      const roundTrip = extractListingKey(slug);
      if (roundTrip !== extractListingKey(r.sale.listingKey)) {
        broken.push(`ROUND-TRIP ${r.sale.listingKey} -> ${r.href} -> ${roundTrip}`);
      }
      // Question 2: does prod serve it?
      const code = await status(r.href);
      if (code === 200) totals.ok++;
      else if (code === 404) {
        totals.notFound++;
        broken.push(`404 ${r.sale.listingKey} ${r.href}`);
      } else {
        totals.other++;
        broken.push(`${code} ${r.sale.listingKey} ${r.href}`);
      }
    }
    const sample = kept.slice(0, 3).map((r) => `${r.sale.address} -> ${r.href ?? '(no link)'}`);
    for (const line of sample) console.log(`  ${line}`);
  }

  console.log('\n=== TOTALS ===');
  console.table([totals]);
  if (badKeys.length) {
    console.log('\nRows rendered without a link (key the route cannot parse):');
    for (const k of badKeys) console.log(`  ${k}`);
  }
  if (broken.length) {
    console.log('\nLINKS THAT DID NOT RESOLVE:');
    for (const b of broken) console.log(`  ${b}`);
  } else {
    console.log('\nEvery link resolved.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
