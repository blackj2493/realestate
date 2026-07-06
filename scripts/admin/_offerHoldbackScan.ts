/**
 * (a) Offer-holdback remark availability scan.
 *
 * Streams the ACTIVE `properties` collection from Typesense and measures how often a
 * listing's PublicRemarks DECLARE a scheduled offer process — the EXPLICIT bidding-war
 * signal ("offers reviewed on …", "holding back offers", "offer date/night", "no bully
 * offers", "register offers") — versus "offers anytime" (explicit NON-holdback). Also
 * reports how often holdback listings are threshold-priced (list ending in $_99,000 /
 * just under a round boundary) to test the 999-price ⇄ declared-holdback correlation.
 *
 * Purpose: decide whether the explicit "offers held back" remark is reliable enough in
 * the PropTx feed to use as a first-class bidding-war signal (stronger than inferring
 * from price digits).
 *
 * READ-ONLY. No writes. Deterministic regex, no LLM (CLAUDE.md §4). PublicRemarks is
 * stored (index:false) in the collection, so export returns it. Typesense Cloud presents
 * a valid TLS cert — no cert-verification bypass needed.
 *
 *   npx.cmd tsx --env-file=.env scripts/admin/_offerHoldbackScan.ts
 */

const HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const ADMIN_KEY = (process.env.TYPESENSE_ADMIN_API_KEY || '').trim();
if (!ADMIN_KEY) {
  console.error('❌ Missing TYPESENSE_ADMIN_API_KEY in env');
  process.exit(1);
}

const INCLUDE = 'id,ListPrice,OriginalListPrice,PropertySubType,City,PublicRemarks';
const EXPORT_URL =
  `https://${HOST}:443/collections/properties/documents/export` +
  `?include_fields=${encodeURIComponent(INCLUDE)}` +
  `&filter_by=${encodeURIComponent('ListPrice:>=100000')}`;

// ── threshold-price detectors (integer dollars) ──────────────────────────────
const mod = (n: number, m: number) => ((n % m) + m) % m;
const isX99k = (p: number) => mod(p, 100000) === 99000; // $_99,000  (999k, 1,299k…)
const isJustUnder100k = (p: number) => mod(p, 100000) >= 95000; // top $5k of a 100k band
const isJustUnder1M = (p: number) => mod(p, 1000000) >= 990000; // top $10k under a round $1M
const isThreshold = (p: number) => isX99k(p) || isJustUnder100k(p) || isJustUnder1M(p);

// ── remark detectors ─────────────────────────────────────────────────────────
// Declared, scheduled offer process (holdback / offer date / bully policy / registration).
// Broadened to catch the common GTA phrasings seen in the first pass.
const reHoldback =
  /(hold(?:ing)?\s+(?:back\s+)?offers?|offers?\s+held\s+back|offers?\s+(?:will\s+be\s+)?(?:review|present|accept)(?:ed|ing)?\s+(?:on|at|by|any|as|thu|mon|tue|wed|fri|sat|sun|[0-9])|offer\s+(?:date|night|presentation|registration)|delayed\s+offers?|no\s+offers?\s+(?:until|will\s+be)|set\s+(?:offer\s+)?date\s+for\s+offers?|no\s+(?:bully|pre-?emptive)\s+offers?|register(?:ed|ing)?\s+(?:to\s+)?offers?|bidding\s+war|improved\s+offer|will\s+not\s+(?:look\s+at|review|present)\s+offers?)/i;
const reBully = /\b(?:bully|pre-?emptive)\s+offers?\b/i;
const reAnytime = /(?:offers?\s+(?:anytime|any\s+time|welcome\s+any\s*time|considered\s+any\s*time)|no\s+offer\s+date)/i;
const reOfferMention = /\boffers?\b/i;
// Diagnostics (boilerplate, NOT a holdback declaration on their own).
const reIrrevocable = /\birrevocable\b/i;
const reMultiple = /\bmultiple\s+offers?\b/i;

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
}

async function main() {
  console.log('========================================');
  console.log('  (a) Offer-holdback remark availability scan');
  console.log('  source: Typesense `properties` (active listings, ListPrice>=100k)');
  console.log('========================================\n');
  console.log('📥 Streaming export…');

  const res = await fetch(EXPORT_URL, { headers: { 'X-TYPESENSE-API-KEY': ADMIN_KEY } });
  if (!res.ok || !res.body) {
    console.error(`❌ export failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    process.exit(1);
  }

  let total = 0;
  let withRemarks = 0;
  let holdback = 0;
  let bully = 0;
  let anytime = 0;
  let offerMention = 0;
  let irrevocable = 0;
  let multiple = 0;
  let holdbackThreshold = 0;
  let allThreshold = 0;
  const examples: string[] = [];

  const handle = (line: string) => {
    if (!line.trim()) return;
    let d: {
      ListPrice?: number;
      PropertySubType?: string;
      City?: string;
      PublicRemarks?: string;
    };
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    total++;
    const price = Number(d.ListPrice) || 0;
    const th = price > 0 && isThreshold(price);
    if (th) allThreshold++;
    const rem = (d.PublicRemarks || '').toString();
    if (!rem.trim()) return;
    withRemarks++;
    if (reOfferMention.test(rem)) offerMention++;
    if (reIrrevocable.test(rem)) irrevocable++;
    if (reMultiple.test(rem)) multiple++;
    if (reBully.test(rem)) bully++;
    if (reAnytime.test(rem)) anytime++;
    if (reHoldback.test(rem)) {
      holdback++;
      if (th) holdbackThreshold++;
      if (examples.length < 15) {
        const m = rem.match(reHoldback);
        const i = m && m.index !== undefined ? m.index : 0;
        const snip = rem.slice(Math.max(0, i - 35), i + 70).replace(/\s+/g, ' ').trim();
        examples.push(`$${price.toLocaleString()} [${d.PropertySubType || '?'}, ${d.City || '?'}]  …${snip}…`);
      }
    }
  };

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handle(buf);

  console.log(`   total active listings scanned: ${total.toLocaleString()}\n`);

  console.log('════════ Remark availability ════════');
  console.log(`  non-empty PublicRemarks   : ${withRemarks.toLocaleString()} (${pct(withRemarks, total)} of listings)`);
  console.log(`  mention "offer(s)" at all : ${offerMention.toLocaleString()} (${pct(offerMention, withRemarks)} of remarks)`);
  console.log(`  DECLARED holdback/offer-date: ${holdback.toLocaleString()} (${pct(holdback, withRemarks)} of remarks)`);
  console.log(`    ├─ of which "bully/pre-emptive" language: ${bully.toLocaleString()}`);
  console.log(`  "offers anytime / no offer date" (NON-holdback): ${anytime.toLocaleString()} (${pct(anytime, withRemarks)} of remarks)`);
  console.log(`  — diagnostics (boilerplate, not holdback on their own) —`);
  console.log(`  "irrevocable" mention  : ${irrevocable.toLocaleString()} (${pct(irrevocable, withRemarks)})`);
  console.log(`  "multiple offers" clause: ${multiple.toLocaleString()} (${pct(multiple, withRemarks)})\n`);

  console.log('════════ 999-price ⇄ declared-holdback correlation ════════');
  console.log(`  threshold-priced among ALL active     : ${pct(allThreshold, total)}`);
  console.log(`  threshold-priced among HOLDBACK active: ${pct(holdbackThreshold, holdback)}`);
  console.log(
    `  → lift: holdback listings are ${
      allThreshold > 0 && holdback > 0
        ? ((holdbackThreshold / holdback) / (allThreshold / total)).toFixed(2)
        : 'n/a'
    }× as likely to be threshold-priced\n`,
  );

  console.log('════════ Example holdback remarks (eyeball precision) ════════');
  for (const e of examples) console.log(`  • ${e}`);
  console.log('\n✅ Done.');
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
