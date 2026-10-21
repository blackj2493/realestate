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
 * ONE SIGN-IN LINK (owner decision 2026-10-21). VOW Agreement §(f) keeps analytics built from
 * sold data on the password-protected site, so sold prices, True DOM and closed-lease rents
 * never print here. The email gives everything it can print, then ONE link — "See what they
 * sold for" — to the page that shows the rest after sign-in. Four locked teasers were tried
 * in a mockup and read like an advert; one reason to click is enough. The True DOM of homes
 * still for sale used to print in a "homes that have not sold" block; it is VOW, so it went.
 *
 * Plain language (voice.md §5.1): "days to sell", "cut their asking price" and "sold above
 * asking" are self-explanatory, so none of them is glossed. Nothing here needs a glossary.
 */
import { SITE, MONO, esc, shell, footer, button, link } from "./emailShell";
import { utmTagger } from "@/lib/email/utm";
import type { StreetRecapPayload } from "@/lib/streetRecap/payload";

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

/** Plurals for the hero: "24 semis sold". */
const TYPE_PLURAL: Record<string, string> = {
  Detached: "detached homes",
  "Semi-Detached": "semis",
  "Att/Row/Townhouse": "townhouses",
  "Condo Townhouse": "condo townhouses",
  "Condo Apartment": "condos",
  Link: "linked homes",
};
const typePlural = (t: string): string => TYPE_PLURAL[t.trim()] ?? `${typeWord(t)}s`;

/** The analytics page's type keys (src/lib/dashboard/propertyTypes.ts). */
const ANALYTICS_TYPE: Record<string, string> = {
  Detached: "detached",
  "Semi-Detached": "semi",
  "Att/Row/Townhouse": "town",
  "Condo Townhouse": "town",
  "Condo Apartment": "condo",
  Link: "link",
};

/**
 * The one sign-in link: the analytics page for the reader's area and type, which shows the
 * sold prices, the price range and True DOM to a signed-in reader. The neighbourhood when we
 * have it, else the city of the cohort. Never the FSA — analytics does not know it.
 */
function soldUrl(p: StreetRecapPayload): string {
  const region = p.scope.kind === "region" ? p.scope.label : p.scope.city || null;
  const q = new URLSearchParams();
  if (region) q.set("region", region);
  const t = p.home ? ANALYTICS_TYPE[p.home.type] : undefined;
  if (t) q.set("types", t);
  const qs = q.toString();
  return `${SITE}/analytics${qs ? `?${qs}` : ""}`;
}

/** Two months must differ by at least this many points for an arrow; below it is noise. */
const MIN_ABOVE_SHIFT = 5;

/** Price-cut share at or above which "If you ever sell" warns about starting high. */
const MANY_CUTS_PCT = 25;

/** A city comparison is a claim only past this many days (see domVerdict). */
const MIN_DOM_GAP = 3;

// ── Hero figures ──────────────────────────────────────────────────────────────

/**
 * The reader's own type when it clears the floor ("24 semis"), else every home in the
 * cohort. The comparison follows the same choice, so a semi is never compared with every
 * home in the city.
 */
function heroFigures(p: StreetRecapPayload): {
  count: number;
  noun: string;
  dom: number | null;
  cityDom: number | null;
} {
  if (p.home) {
    return {
      count: p.home.sales,
      noun: typePlural(p.home.type),
      dom: p.home.medianDom,
      cityDom: p.home.cityMedianDom,
    };
  }
  return {
    count: p.local.sales,
    noun: p.local.sales === 1 ? "home" : "homes",
    dom: p.local.medianDom,
    cityDom: p.cityAgg?.medianDom ?? null,
  };
}

// ── Subject ───────────────────────────────────────────────────────────────────

/** The subject leads on the hero's figure; the preheader on the strongest printable fact. */
function subjectFor(p: StreetRecapPayload): { subject: string; preheader: string } {
  const where = placeName(p);
  const h = heroFigures(p);
  const gap = h.dom != null && h.cityDom != null ? h.cityDom - h.dom : null;
  const pace =
    gap != null && Math.abs(gap) >= MIN_DOM_GAP
      ? `, ${gap > 0 ? "faster" : "slower"} than ${p.scope.city}`
      : "";

  const subject = `${h.count} ${h.noun} sold ${where ? `in ${where}` : "near you"} in ${p.monthLabel}${pace}`;

  const bits: string[] = [];
  if (pace && h.dom != null && h.cityDom != null) bits.push(`${h.dom} days near you, ${h.cityDom} across the city.`);
  else if (h.dom != null) bits.push(`They took a typical ${h.dom} days to sell.`);
  if (p.cutPct != null) bits.push(`${whole(p.cutPct)}% of homes for sale near you have cut their price.`);
  else if (p.abovePct != null) bits.push(`${whole(p.abovePct)}% sold over asking.`);
  return { subject, preheader: bits.join(" ") || `What changed near ${p.address} in ${p.monthLabel}.` };
}

// ── Fragments ─────────────────────────────────────────────────────────────────

const secHd = (t: string) =>
  `<h2 class="sr-sec" style="font-size:12px;color:#334155;text-transform:uppercase;letter-spacing:.10em;margin:28px 0 8px;">${t}</h2>`;

const para = (html: string) =>
  `<p class="sr-note" style="font-size:15px;line-height:1.6;color:#0a1828;margin:0;">${html}</p>`;

function heroBlock(p: StreetRecapPayload, soldHref: string): string {
  const h = heroFigures(p);
  const gap = h.dom != null && h.cityDom != null ? h.cityDom - h.dom : null;
  const where = placeName(p);

  const parts = [`near <b>${esc(p.address)}</b> in ${esc(p.monthLabel)}.`];
  if (h.dom != null) parts.push(`They took a typical <b>${h.dom} days</b> to sell.`);
  if (gap != null && Math.abs(gap) >= MIN_DOM_GAP) {
    parts.push(
      `Across ${esc(p.scope.city)} it was ${h.cityDom} days, so ${where ? esc(where) : "your area"} is moving ${gap > 0 ? "faster" : "slower"}.`
    );
  } else if (h.cityDom != null) {
    parts.push(`Across ${esc(p.scope.city)} it was about the same.`);
  }

  return `${secHd(p.home ? "Homes like yours" : "Homes near you")}
    <span class="sr-figure" style="font-family:${MONO};font-size:52px;font-weight:600;color:#0a1828;letter-spacing:-.02em;line-height:1;">${h.count}<span class="sr-unit" style="font-size:24px;color:#55707f;font-weight:500;"> ${esc(h.noun)} sold</span></span>
    <p class="sr-lede" style="font-size:16px;line-height:1.55;color:#0a1828;margin:10px 0 0;">${parts.join(" ")}</p>
    <div style="margin:16px 0 0;">${button("See what they sold for &rarr;", soldHref)}</div>
    <p class="sr-cap" style="font-size:12px;line-height:1.5;color:#55707f;margin:8px 0 0;">Sold prices, the price range for homes like yours, and the real time to sell. Shown on PureProperty when you sign in.</p>`;
}

/** One sentence on what the market numbers mean together, or nothing when they say nothing. */
function marketMeaning(p: StreetRecapPayload, prevMonth: string): string | null {
  if (p.abovePct == null || p.prevAbovePct == null) return null;
  const shift = p.abovePct - p.prevAbovePct;
  if (shift <= -MIN_ABOVE_SHIFT) {
    return p.cutPct != null && p.cutPct >= MANY_CUTS_PCT
      ? `Fewer homes sold over asking than in ${prevMonth}, and many sellers have cut their price. Buyers near you have more choice.`
      : `Fewer homes sold over asking than in ${prevMonth}. Buyers near you are competing less.`;
  }
  if (shift >= MIN_ABOVE_SHIFT) {
    return `More homes sold over asking than in ${prevMonth}. Buyers near you are competing harder.`;
  }
  return null;
}

function marketBlock(p: StreetRecapPayload, prevMonth: string): string {
  const stat = (figure: string, caption: string) => `
        <td valign="top" style="padding:0 8px 0 0;">
          <div class="sr-stat" style="font-family:${MONO};font-size:22px;font-weight:600;color:#0a1828;line-height:1.1;white-space:nowrap;">${figure}</div>
          <div class="sr-cap" style="font-size:12px;line-height:1.4;color:#55707f;margin-top:4px;">${caption}</div>
        </td>`;

  const cells: string[] = [];
  if (p.abovePct != null) {
    const prev =
      p.prevAbovePct != null && Math.abs(p.abovePct - p.prevAbovePct) >= MIN_ABOVE_SHIFT
        ? `<br>${p.abovePct < p.prevAbovePct ? "&#9660;" : "&#9650;"} from ${whole(p.prevAbovePct)}% in ${esc(prevMonth)}`
        : "";
    cells.push(stat(`${whole(p.abovePct)}%`, `sold over asking${prev}`));
  }
  if (p.actives) cells.push(stat(p.actives.active.toLocaleString("en-CA"), "homes for sale now"));
  if (p.cutPct != null) cells.push(stat(`${whole(p.cutPct)}%`, "of those have cut their price"));
  if (!cells.length) return "";

  const meaning = marketMeaning(p, prevMonth);
  return `${secHd("The market around you")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>${cells.join("")}</tr>
    </table>${meaning ? `<p class="sr-note" style="font-size:14px;line-height:1.6;color:#3d5665;margin:12px 0 0;">${meaning}</p>` : ""}`;
}

/**
 * Advice an owner can use, from listing data only (price cuts are IDX). It reads the cut
 * share, so the text changes with the market instead of repeating the market block: many
 * cuts warn about starting high, few cuts say a fair first price sells here.
 */
function sellNote(p: StreetRecapPayload): string | null {
  if (p.cutPct == null) return null;
  return p.cutPct >= MANY_CUTS_PCT
    ? `${whole(p.cutPct)}% of the homes for sale near you have cut their price. A home that starts too high waits longer, and buyers notice the cut.`
    : `Only ${whole(p.cutPct)}% of the homes for sale near you have cut their price. Here, a home priced right at the start usually sells without a cut.`;
}

function sellBlock(p: StreetRecapPayload): string {
  const n = sellNote(p);
  if (!n) return "";
  return `${secHd("If you ever sell")}
    <p style="font-size:16px;font-weight:700;color:#0a1828;margin:0 0 6px;">The first price matters most</p>
    ${para(n)}`;
}

function renoBlock(p: StreetRecapPayload, href: string): string {
  if (p.source !== "reno") return "";
  return `${secHd("Your renovation check")}
    ${para("You checked what a renovation adds to your home. Run it again to see it with this month's sales and leases.")}
    <p style="margin:10px 0 0;font-size:15px;">${link("See your result again &rarr;", href)}</p>`;
}

function schoolBlock(p: StreetRecapPayload, href: string): string {
  const s = p.school;
  if (!s) return "";
  const score = s.score != null ? ` (score ${s.score.toFixed(1)}/10, from EQAO results)` : "";
  return `${secHd("Your school zone")}
    ${para(`Your home is in the zone for <b>${esc(s.name)}</b>${score}.`)}
    <p style="margin:10px 0 0;font-size:15px;">${link("See the school zones near you &rarr;", href)}</p>`;
}

/** Replies go to SENDERS.streetRecap.replyTo, a monitored inbox. */
const PRICE_CHECK =
  "Thinking about what your home could sell for? Reply to this email for a free price check from a licensed agent.";

/** "September" for an "October" recap. */
function monthBefore(label: string): string {
  const i = new Date(`${label} 15, 2000`).getMonth();
  if (Number.isNaN(i)) return "last month";
  return new Date(Date.UTC(2000, (i + 11) % 12, 15, 12)).toLocaleDateString("en-CA", {
    month: "long",
    timeZone: "UTC",
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderStreetRecapEmail(i: RecapRenderInput, now = Date.now()): RecapRendered {
  const p = i.payload;
  const { subject, preheader } = subjectFor(p);
  const prevMonth = monthBefore(p.monthLabel);

  const tag: Tagger = utmTagger(UTM_SOURCE, campaignOf(p.monthLabel, now));
  const manageUrl = tag(i.manageUrl, "manage");
  const soldHref = tag(soldUrl(p), "sold");
  const renoHref = tag(`${SITE}/whats-my-home-hiding`, "reno");
  const schoolHref = tag(mapUrl(i.lat, i.lng), "schools");

  const intro =
    p.source === "reno"
      ? "You get this because you checked a home on PureProperty."
      : `You get this because you asked us to watch ${esc(p.address)}.`;

  const body = [
    heroBlock(p, soldHref),
    marketBlock(p, prevMonth),
    sellBlock(p),
    renoBlock(p, renoHref),
    schoolBlock(p, schoolHref),
    `<p class="sr-note" style="font-size:14px;line-height:1.6;color:#3d5665;margin:28px 0 0;">${PRICE_CHECK}</p>`,
    footer({ intro, manageUrl, unsubscribeUrl: i.unsubscribeUrl }).replace(
      "Data is deemed reliable",
      `Aggregate figures only. No estimate of your home's value.<br>Data is deemed reliable`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  // The month, one word: "YOUR STREET" wrapped onto two lines in Gmail's app.
  const html = shell({ preheader, headerLabel: esc(p.monthLabel.toUpperCase()), body, headStyle: MOBILE_CSS });

  // ── Plaintext part. Required, not optional (§11.7 item 6). Same sections, same rules. ──
  const h = heroFigures(p);
  const t: string[] = [];
  t.push(`${(placeName(p) ?? "NEAR YOU").toUpperCase()} — ${p.monthLabel.toUpperCase()}`, "");
  t.push(`${h.count} ${h.noun} sold near ${p.address} in ${p.monthLabel}.`);
  if (h.dom != null) t.push(`They took a typical ${h.dom} days to sell.`);
  if (h.dom != null && h.cityDom != null) t.push(`Across ${p.scope.city} it was ${h.cityDom} days.`);
  t.push("", "See what they sold for (sign in):", soldHref, "");
  t.push("THE MARKET AROUND YOU");
  if (p.abovePct != null) {
    t.push(
      `  Sold over asking: ${whole(p.abovePct)}%` +
        (p.prevAbovePct != null ? ` (${whole(p.prevAbovePct)}% in ${prevMonth})` : "")
    );
  }
  if (p.actives) t.push(`  Homes for sale now: ${p.actives.active.toLocaleString("en-CA")}`);
  if (p.cutPct != null) t.push(`  Of those, cut their price: ${whole(p.cutPct)}%`);
  const m = marketMeaning(p, prevMonth);
  if (m) t.push("", m);
  t.push("");
  const sn = sellNote(p);
  if (sn) t.push("IF YOU EVER SELL", sn, "");
  if (p.source === "reno") t.push("YOUR RENOVATION CHECK", "See your result again:", renoHref, "");
  if (p.school) {
    t.push(
      "YOUR SCHOOL ZONE",
      `${p.school.name}${p.school.score != null ? ` (score ${p.school.score.toFixed(1)}/10)` : ""}`,
      schoolHref,
      ""
    );
  }
  t.push(PRICE_CHECK, "");
  t.push("--");
  t.push(intro);
  t.push(`Manage emails:  ${manageUrl}`);
  t.push(`Unsubscribe:    ${i.unsubscribeUrl}`);
  t.push("");
  t.push("Aggregate figures only. No estimate of your home's value.");
  t.push("Data is deemed reliable but not guaranteed accurate.");
  t.push("Powered by PROPTX MLS(R).");
  t.push("PureProperty - 268 America Ave, Vaughan, ON L6A 3G7");

  return { subject, preheader, html, text: t.join("\n") };
}
