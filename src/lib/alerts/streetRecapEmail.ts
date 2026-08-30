/**
 * The monthly Street Recap — renderer.
 *
 * Composes the locked Mode A shell (voice.md §11.9); this file authors no new visual system.
 *
 * WHAT IT DELIBERATELY DOES NOT CONTAIN: a price, a valuation, or anything derived from a
 * model. Counts, shares and day-counts only. That is what lets ONE rendering serve a reader
 * who accepted VOW terms and one who never did — no gate, no second variant, no risk of
 * leaking a figure or its direction. A test enforces it.
 *
 * Plain language (voice.md §5.1): "days to sell", "cut their asking price" and "sold above
 * asking" are self-explanatory, so none of them is glossed. Nothing here needs a glossary.
 */
import { SITE, MONO, esc, shell, footer, button } from "./emailShell";
import { utmTagger } from "@/lib/email/utm";
import {
  printableTypes,
  domVerdict,
  type StreetRecapPayload,
} from "@/lib/streetRecap/payload";

export interface RecapRenderInput {
  payload: StreetRecapPayload;
  /** The watched home's coordinates — the CTA lands on its camera, never a city filter. */
  lat: number | null;
  lng: number | null;
  unsubscribeUrl: string;
  manageUrl: string;
}

export interface RecapRendered {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

const UTM_SOURCE = "street_recap";
type Tagger = (href: string, content: string) => string;

/** Campaign is the month, so month-on-month is a group-by rather than a string parse. */
const campaignOf = (monthLabel: string, now: number): string =>
  `${new Date(now).toLocaleDateString("en-CA", { year: "numeric", timeZone: "America/Toronto" })}-${monthLabel.toLowerCase()}`;

/**
 * Where "see what's for sale" lands: a CAMERA on the watched home, never `?city=`.
 * A text filter pins the map to that place and empties it the moment they pan past the
 * boundary — the same reason the Data Drop's market chips use coordinates.
 */
const mapUrl = (lat: number | null, lng: number | null): string =>
  lat != null && lng != null
    ? `${SITE}/properties?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&z=14`
    : `${SITE}/properties`;

const MOBILE_CSS = `
@media only screen and (max-width:480px){
  .sr-pad{padding:20px 18px 24px!important}
  .sr-figure{font-size:46px!important}
  .sr-unit{font-size:25px!important}
  .sr-lede{font-size:17px!important}
  .sr-because{font-size:15px!important}
  .sr-tension{font-size:15px!important;padding:14px 14px!important}
  .sr-sec{font-size:13px!important}
  .sr-rl{font-size:15px!important}
  .sr-rv{font-size:15px!important}
  .sr-note{font-size:13px!important}
}`;

/**
 * Shares are rendered as whole percents. The payload keeps a decimal because it is a
 * measurement; the email drops it because "26.1% went above asking" claims a precision the
 * reader has no use for and the underlying cohort does not really support.
 */
const whole = (n: number | null | undefined): string | null =>
  n == null ? null : String(Math.round(n));

// ── Subject ───────────────────────────────────────────────────────────────────

/**
 * The subject leads on whatever the hero block leads on. They must agree: a subject about
 * a count opening onto a hero about days reads as two emails stapled together.
 *
 * The PREHEADER carries the interesting part, in order of what is actually worth saying:
 * the city comparison when it is big enough to be a claim, then the standing-inventory gap
 * (usually the strongest thing we know), then the above-asking share.
 */
/**
 * A place a reader would say out loud, or null.
 *
 * An FSA is a sorting code. "Homes in N7G sold in 23 days" tells someone in Strathroy
 * nothing about Strathroy, and the postal area is not what they call where they live. When
 * the cohort is an FSA the email says "near you" and lets the address in the lede do the
 * locating — which is true regardless of how the feed files their town.
 */
const placeName = (p: StreetRecapPayload): string | null =>
  p.scope.kind === "fsa" ? null : p.scope.label;

function subjectFor(p: StreetRecapPayload): { subject: string; preheader: string } {
  const v = domVerdict(p);
  const where = placeName(p);

  const preheader =
    v && p.cityAgg?.medianDom != null
      ? `Across ${p.scope.city} it took ${p.cityAgg.medianDom} days.` +
        (p.actives?.medianTrueDom != null
          ? ` The ones that didn't sell have been listed ${p.actives.medianTrueDom}.`
          : "")
      : p.actives?.medianTrueDom != null
        ? `The ones that didn't sell are still listed after ${p.actives.medianTrueDom} days.`
        : p.abovePct != null
          ? `${whole(p.abovePct)}% of them went above asking.`
          : `What changed near ${p.address} in ${p.monthLabel}.`;

  if (p.local.medianDom != null) {
    return {
      subject: where
        ? `Homes in ${where} sold in ${p.local.medianDom} days last month`
        : `Homes near you sold in ${p.local.medianDom} days last month`,
      preheader,
    };
  }
  return {
    subject: where
      ? `${p.local.sales} homes sold in ${where} last month`
      : `${p.local.sales} homes sold near you last month`,
    preheader,
  };
}

// ── Fragments ─────────────────────────────────────────────────────────────────

const secHd = (t: string) =>
  `<h2 class="sr-sec" style="font-size:12px;color:#334155;text-transform:uppercase;letter-spacing:.10em;margin:24px 0 8px;">${t}</h2>`;

function headlineBlock(p: StreetRecapPayload): string {
  const v = domVerdict(p);
  const hasDom = p.local.medianDom != null;
  const figure = hasDom ? String(p.local.medianDom) : String(p.local.sales);
  const unit = hasDom ? " days" : " sold";

  const lede = hasDom
    ? `is how long a home near <b>${esc(p.address)}</b> took to sell in ${p.monthLabel}.`
    : `homes changed hands near <b>${esc(p.address)}</b> in ${p.monthLabel}.`;

  const where = placeName(p);
  const because = v
    ? `Across ${esc(p.scope.city)} as a whole it was <b>${p.cityAgg?.medianDom} days</b>. ` +
      `${where ? esc(where) : "Your area"} is moving ${v.faster ? "faster" : "slower"} than the city around it.`
    : p.cityAgg?.medianDom != null
      ? `Across ${esc(p.scope.city)} it was <b>${p.cityAgg.medianDom} days</b> — about the same.`
      : `Measured across every sale we have on record for the month.`;

  return `
    <span class="sr-figure" style="font-family:${MONO};font-size:52px;font-weight:600;color:#0a1828;letter-spacing:-.02em;line-height:1;">${esc(figure)}<span class="sr-unit" style="font-size:27px;color:#55707f;font-weight:500;">${esc(unit)}</span></span>
    <p class="sr-lede" style="font-size:16px;line-height:1.5;color:#0a1828;margin:10px 0 0;">${lede}</p>
    <p class="sr-because" style="font-size:14px;line-height:1.6;color:#3d5665;margin:13px 0 0;">${because}</p>`;
}

/**
 * The standing-inventory block — the most useful thing we know, and the line no
 * home-value email says, because they all lead with a price instead.
 *
 * Sold homes took ~18 days. Homes still listed have been sitting ~63. That gap is the
 * market, stated in a way an owner can act on.
 */
function tensionBlock(p: StreetRecapPayload): string {
  const a = p.actives;
  if (!a || a.medianTrueDom == null) return "";
  const cut = p.cutPct != null ? `<b>${whole(p.cutPct)}%</b> of them have already cut their asking price. ` : "";
  return `
    <div class="sr-tension" style="background:#f1f6f8;border:1px solid #d7e3e9;border-radius:5px;padding:15px 16px;margin:20px 0 0;">
      <div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#55707f;font-weight:700;">But that is only the homes that sold</div>
      <div style="font-family:${MONO};font-size:20px;font-weight:600;color:#0a1828;margin-top:6px;">${a.active.toLocaleString("en-CA")} still for sale &middot; ${a.medianTrueDom} days each</div>
      <div style="font-size:13px;color:#3d5665;margin-top:7px;line-height:1.5;">${cut}Homes here either go quickly or they do not go at all.</div>
    </div>`;
}

function rowsBlock(p: StreetRecapPayload): string {
  const rows: { k: string; v: string; note?: string }[] = [];
  rows.push({ k: "Homes sold", v: String(p.local.sales) });
  if (p.abovePct != null) {
    rows.push({
      k: "Sold above asking",
      v: `${whole(p.abovePct)}%`,
      note: p.cityAbovePct != null ? `${p.scope.city} ${whole(p.cityAbovePct)}%` : undefined,
    });
  }
  for (const t of printableTypes(p.local.byType)) {
    rows.push({ k: typeLabel(t.type), v: `${t.medianDom} days`, note: `${t.sales} sold` });
  }

  const tr = rows
    .map((r, idx) => {
      const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
      const note = r.note
        ? `<span style="color:#7a8f9c;font-weight:400;font-size:12px;"> &middot; ${esc(r.note)}</span>`
        : "";
      return `<tr>
        <td class="sr-rl" style="padding:11px 12px;background:${bg};font-size:14px;color:#3d5665;">${esc(r.k)}</td>
        <td class="sr-rv" align="right" style="padding:11px 12px;background:${bg};font-family:${MONO};font-size:14px;font-weight:600;color:#0a1828;white-space:nowrap;">${esc(r.v)}${note}</td>
      </tr>`;
    })
    .join("");

  return `${secHd(`Near you, ${esc(p.monthLabel)}`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${tr}</table>`;
}

/**
 * Feed sub-types read like database values, because they are. In a sentence they need to
 * sound like the thing a person owns: "Att/Row/Townhouse" is a townhouse.
 */
const TYPE_WORD: Record<string, string> = {
  Detached: "detached home",
  "Semi-Detached": "semi",
  "Att/Row/Townhouse": "townhouse",
  "Condo Townhouse": "condo townhouse",
  "Condo Apartment": "condo",
  Link: "linked home",
};

const typeWord = (t: string): string => TYPE_WORD[t.trim()] ?? t.trim().toLowerCase();

/**
 * The same names, capitalised for a table row. "Att/Row/Townhouse" is how the feed files a
 * townhouse; it is not a word, and printing it in a row label makes the email look like a
 * database export.
 */
const typeLabel = (t: string): string => {
  const w = typeWord(t);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const article = (w: string): string => ("aeiou".includes(w[0]?.toLowerCase() ?? "") ? "An" : "A");

/**
 * The line a reader forwards to a neighbour — but only when there is a contrast worth
 * forwarding.
 *
 * Real August data made the case: Patterson detached sold in 23 days and townhouses in 21.
 * "A detached home sells in 23 days. A townhouse takes 21." is not an insight, it is two
 * numbers next to each other. Below MIN_SPREAD the sentence is dropped entirely rather than
 * padded — the email is already saying enough.
 */
const MIN_TYPE_SPREAD_DAYS = 5;

function typeContrast(p: StreetRecapPayload): string {
  const types = printableTypes(p.local.byType);
  if (types.length < 2) return "";
  const [a, b] = types;
  if (a.medianDom == null || b.medianDom == null) return "";
  if (Math.abs(a.medianDom - b.medianDom) < MIN_TYPE_SPREAD_DAYS) return "";
  const aw = typeWord(a.type);
  const bw = typeWord(b.type);
  return `<p class="sr-note" style="font-size:14px;line-height:1.6;color:#3d5665;margin:14px 0 0;">${article(aw)} ${esc(aw)} near you now sells in ${a.medianDom} days. ${article(bw).toLowerCase() === "an" ? "An" : "A"} ${esc(bw)} takes ${b.medianDom}.</p>`;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderStreetRecapEmail(i: RecapRenderInput, now = Date.now()): RecapRendered {
  const p = i.payload;
  const { subject, preheader } = subjectFor(p);

  const tag: Tagger = utmTagger(UTM_SOURCE, campaignOf(p.monthLabel, now));
  const manageUrl = tag(i.manageUrl, "manage");
  const ctaUrl = tag(mapUrl(i.lat, i.lng), "cta");

  const body = [
    headlineBlock(p),
    tensionBlock(p),
    rowsBlock(p),
    typeContrast(p),
    `<div style="margin:26px 0 0;">${button("See what's for sale near you &rarr;", ctaUrl)}</div>`,
    footer({
      intro: `You get this because you asked us to watch ${esc(p.address)}.`,
      manageUrl,
      unsubscribeUrl: i.unsubscribeUrl,
    }).replace(
      "Data is deemed reliable",
      `Aggregate figures only. No estimate of your home's value.<br>Data is deemed reliable`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const html = shell({ preheader, headerLabel: "YOUR STREET", body, headStyle: MOBILE_CSS });

  // ── Plaintext part. Required, not optional (§11.7 item 6). ──────────────────
  const t: string[] = [];
  t.push(`${(placeName(p) ?? "NEAR YOU").toUpperCase()} — ${p.monthLabel.toUpperCase()}`, "");
  if (p.local.medianDom != null) {
    t.push(`${p.local.medianDom} days is how long a home near ${p.address} took to sell.`, "");
    if (p.cityAgg?.medianDom != null) t.push(`Across ${p.scope.city} it was ${p.cityAgg.medianDom} days.`, "");
  } else {
    t.push(`${p.local.sales} homes sold near ${p.address} in ${p.monthLabel}.`, "");
  }
  if (p.actives?.medianTrueDom != null) {
    t.push(
      `Still for sale: ${p.actives.active.toLocaleString("en-CA")} homes, ` +
        `listed ${p.actives.medianTrueDom} days each` +
        (p.cutPct != null ? `, ${whole(p.cutPct)}% of them already cut.` : "."),
      ""
    );
  }
  t.push(`NEAR YOU, ${p.monthLabel.toUpperCase()}`, "");
  t.push(`  ${"Homes sold".padEnd(24)}${p.local.sales}`);
  if (p.abovePct != null) t.push(`  ${"Sold above asking".padEnd(24)}${whole(p.abovePct)}%`);
  for (const ty of printableTypes(p.local.byType)) {
    t.push(`  ${typeLabel(ty.type).padEnd(24)}${ty.medianDom} days (${ty.sales} sold)`);
  }
  t.push("");
  // Parity with the HTML part: the same sentence, under the same spread rule.
  const tc = printableTypes(p.local.byType);
  if (tc.length >= 2 && tc[0].medianDom != null && tc[1].medianDom != null &&
      Math.abs(tc[0].medianDom - tc[1].medianDom) >= MIN_TYPE_SPREAD_DAYS) {
    t.push(
      `${article(typeWord(tc[0].type))} ${typeWord(tc[0].type)} near you now sells in ` +
        `${tc[0].medianDom} days. ${article(typeWord(tc[1].type))} ${typeWord(tc[1].type)} ` +
        `takes ${tc[1].medianDom}.`,
      ""
    );
  }
  t.push("See what's for sale near you:", ctaUrl, "");
  t.push("--");
  t.push(`You get this because you asked us to watch ${p.address}.`);
  t.push(`Manage emails:  ${manageUrl}`);
  t.push(`Unsubscribe:    ${i.unsubscribeUrl}`);
  t.push("");
  t.push("Aggregate figures only. No estimate of your home's value.");
  t.push("Data is deemed reliable but not guaranteed accurate.");
  t.push("Powered by PROPTX MLS(R).");
  t.push("PureProperty - 268 America Ave, Vaughan, ON L6A 3G7");

  return { subject, preheader, html, text: t.join("\n") };
}
