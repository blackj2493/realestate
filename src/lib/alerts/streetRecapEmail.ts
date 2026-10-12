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

/**
 * Phone sizes. Gmail's app honours a head <style> for Gmail accounts; everything below also
 * reads acceptably at the inline (desktop) sizes when it does not.
 *
 * LAYOUT RULES learned from the first real send (2026-10-12, read on a phone in Gmail's dark
 * mode): no sentence set in the monospace face (a mono line wraps mid-phrase and strands a
 * "·"), no value cell wider than its label (a nowrap note in the value column squeezed every
 * label onto two lines), and no zebra or tinted backgrounds that the dark-mode inversion turns
 * into muddy grey bands. Figures stay mono; words do not.
 */
const MOBILE_CSS = `
@media only screen and (max-width:480px){
  .sr-figure{font-size:46px!important}
  .sr-unit{font-size:25px!important}
  .sr-lede{font-size:17px!important}
  .sr-because{font-size:15px!important}
  .sr-stat{font-size:20px!important}
  .sr-cap{font-size:12px!important}
  .sr-sec{font-size:12px!important}
  .sr-rl{font-size:15px!important}
  .sr-rv{font-size:15px!important}
  .sr-note{font-size:14px!important}
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
  // What the figure is made of, said once. It replaced "Measured across every sale we have on
  // record for the month", which filled the line without telling the reader anything.
  const basis = hasDom
    ? `Based on ${p.local.sales} sale${p.local.sales === 1 ? "" : "s"} ${where ? `in ${esc(where)}` : "near you"}. `
    : "";
  const because = v
    ? `${basis}Across ${esc(p.scope.city)} as a whole it was <b>${p.cityAgg?.medianDom} days</b>, so ` +
      `${where ? esc(where) : "your area"} is moving ${v.faster ? "faster" : "slower"} than the city around it.`
    : p.cityAgg?.medianDom != null
      ? `${basis}Across ${esc(p.scope.city)} it was <b>${p.cityAgg.medianDom} days</b> — about the same.`
      : basis.trim();

  return `
    <span class="sr-figure" style="font-family:${MONO};font-size:52px;font-weight:600;color:#0a1828;letter-spacing:-.02em;line-height:1;">${esc(figure)}<span class="sr-unit" style="font-size:27px;color:#55707f;font-weight:500;">${esc(unit)}</span></span>
    <p class="sr-lede" style="font-size:16px;line-height:1.5;color:#0a1828;margin:10px 0 0;">${lede}</p>
    ${because ? `<p class="sr-because" style="font-size:14px;line-height:1.6;color:#3d5665;margin:12px 0 0;">${because}</p>` : ""}`;
}

/**
 * The standing-inventory block — the most useful thing we know, and the line no
 * home-value email says, because they all lead with a price instead.
 *
 * Sold homes took ~18 days. Homes still listed have been sitting ~63. That gap is the
 * market, stated in a way an owner can act on.
 *
 * Three figures side by side, each with a one-line caption: a table row of cells, which
 * every client lays out, rather than one mono sentence that wrapped mid-phrase. The days
 * figure is a MEDIAN, so the caption says "typical" — the old "30 days each" claimed every
 * listing had sat exactly that long. The comparison sentence is printed only when the gap is
 * real (STANDING_GAP_*): the first live send stated "Homes here either go quickly or they do
 * not go at all" beside 28 days sold against 30 days listed, which says no such thing.
 */
const STANDING_GAP_RATIO = 1.5;
const STANDING_GAP_DAYS = 14;

function standingBlock(p: StreetRecapPayload): string {
  const a = p.actives;
  if (!a || a.medianTrueDom == null) return "";

  const stat = (figure: string, caption: string) => `
        <td valign="top" style="padding:0 6px 0 0;">
          <div class="sr-stat" style="font-family:${MONO};font-size:22px;font-weight:600;color:#0a1828;line-height:1.1;white-space:nowrap;">${figure}</div>
          <div class="sr-cap" style="font-size:12px;line-height:1.4;color:#55707f;margin-top:4px;">${caption}</div>
        </td>`;
  const cells = [
    stat(a.active.toLocaleString("en-CA"), "homes still for sale"),
    stat(`${a.medianTrueDom}<span style="font-size:14px;font-weight:500;color:#55707f;"> days</span>`, "typical time listed so far"),
    p.cutPct != null ? stat(`${whole(p.cutPct)}%`, "have cut their price") : "",
  ].filter(Boolean);

  const sold = p.local.medianDom;
  const gap =
    sold != null && a.medianTrueDom >= sold * STANDING_GAP_RATIO && a.medianTrueDom - sold >= STANDING_GAP_DAYS
      ? `<p class="sr-note" style="font-size:14px;line-height:1.6;color:#3d5665;margin:12px 0 0;">The homes still for sale have been listed ${a.medianTrueDom} days so far. The ones that sold took ${sold}.</p>`
      : "";

  return `${secHd("The homes that have not sold")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>${cells.join("")}</tr>
    </table>${gap}`;
}

/**
 * The month's figures as label / value rows. The secondary fact (a type's sale count, the
 * city's above-asking share) sits UNDER the label as a caption, never beside the value: in
 * the value column it was set nowrap, so it widened that column until every label wrapped.
 * The value column holds one short figure and is sized to it.
 */
function rowsBlock(p: StreetRecapPayload): string {
  type Row = { k: string; v: string; sub?: string } | { head: string };
  const rows: Row[] = [];
  rows.push({ k: "Homes sold", v: String(p.local.sales) });
  if (p.abovePct != null) {
    rows.push({
      k: "Sold above asking",
      v: `${whole(p.abovePct)}%`,
      sub: p.cityAbovePct != null ? `Across ${p.scope.city}: ${whole(p.cityAbovePct)}%` : undefined,
    });
  }
  const types = printableTypes(p.local.byType);
  if (types.length) rows.push({ head: "Time to sell, by type" });
  for (const t of types) {
    rows.push({ k: tableLabel(t.type), v: `${t.medianDom} days`, sub: `${t.sales} sold` });
  }

  const tr = rows
    .map((r) => {
      if ("head" in r) {
        return `<tr><td colspan="2" style="padding:16px 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#55707f;font-weight:700;">${esc(r.head)}</td></tr>`;
      }
      const sub = r.sub
        ? `<div style="font-size:12px;line-height:1.4;color:#7a8f9c;margin-top:2px;">${esc(r.sub)}</div>`
        : "";
      return `<tr>
        <td class="sr-rl" valign="top" style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:1.4;color:#3d5665;">${esc(r.k)}${sub}</td>
        <td class="sr-rv" valign="top" align="right" style="padding:10px 0 10px 12px;border-bottom:1px solid #e2e8f0;font-family:${MONO};font-size:14px;font-weight:600;line-height:1.4;color:#0a1828;white-space:nowrap;">${esc(r.v)}</td>
      </tr>`;
    })
    .join("");

  const where = placeName(p);
  return `${secHd(`${where ? esc(where) : "Near you"}, ${esc(p.monthLabel)}`)}
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

/**
 * Row labels in the HTML table, which want the plain category ("Semi-detached"), not the
 * sentence word ("semi") that typeLabel capitalises for the plaintext part.
 */
const TABLE_LABEL: Record<string, string> = {
  Detached: "Detached",
  "Semi-Detached": "Semi-detached",
  "Att/Row/Townhouse": "Townhouse",
  "Condo Townhouse": "Condo townhouse",
  "Condo Apartment": "Condo",
  Link: "Linked home",
};
const tableLabel = (t: string): string => TABLE_LABEL[t.trim()] ?? typeLabel(t);
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
    standingBlock(p),
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

  // The month, one word: "YOUR STREET" wrapped onto two lines in Gmail's app, and it named a
  // street where the figures describe a neighbourhood or a postal area.
  const html = shell({ preheader, headerLabel: esc(p.monthLabel.toUpperCase()), body, headStyle: MOBILE_CSS });

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
      `Still for sale: ${p.actives.active.toLocaleString("en-CA")} homes. ` +
        `Typical time listed so far: ${p.actives.medianTrueDom} days.` +
        (p.cutPct != null ? ` ${whole(p.cutPct)}% have cut their price.` : ""),
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
