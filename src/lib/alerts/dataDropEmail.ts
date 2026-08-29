/**
 * Weekly Data Drop — renderer (Unit 5). Composes the locked Mode A shell (voice.md §11.9);
 * this file authors NO new visual system.
 *
 * Two shapes from one skeleton:
 *   scope "market"   — the reader picked this place. Headline, three rows, map CTA.
 *   scope "province" — the reader has saved nothing. 70.6% of sends. Its job is CONVERSION,
 *                      so it runs news -> tension -> ask, with a chip per covered market and
 *                      NOTHING between the tension and the ask.
 *
 * Plain language (voice.md §5.1): explain the genuinely specialized terms, leave the
 * self-explanatory ones alone. "Days to sell" and "cut their asking price" need no gloss;
 * glossing them reads as condescending.
 */
import {
  SITE,
  MONO,
  esc,
  shell,
  footer,
  button,
} from "./emailShell";
import type { DataDropPayload } from "@/lib/dataDrop/payload";
import { marketMapUrl } from "@/lib/dataDrop/cameras";
import { utmTagger } from "@/lib/email/utm";

export interface RenderInput {
  payload: DataDropPayload;
  /** Every market the weekly can cover — the chip set. MUST be BOARD_MARKETS. */
  chipMarkets: string[];
  unsubscribeUrl: string;
  manageUrl: string;
  /** Active reader -> the terminal. Dormant or never-unlocked -> the public tracker. */
  ctaTarget: "terminal" | "tracker";
  /** Recipient address and its HMAC — the chips are signed per recipient. */
  email: string;
  signature: string;
}

export interface Rendered {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

const monthDay = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "America/Toronto" })
    : "today";

const weekOf = (now: number): string =>
  new Date(now).toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "America/Toronto" });

/** Strip the <b> tags the payload uses, for the plaintext part. */
const plain = (s: string): string => s.replace(/<\/?b>/g, "");

const trackerUrl = (slug: string) => `${SITE}/data/${slug}`;

/** `utm_source` for every link in this email — see src/lib/email/utm.ts for the scheme. */
const UTM_SOURCE = "data_drop";

/** Tags one link for this send. Built per render, because the campaign is the week id. */
type Tagger = (href: string, content: string) => string;

/**
 * Mobile stylesheet. Two separate problems, one of which was self-inflicted.
 *
 * THE TEXT WAS SMALL BECAUSE THE EMAIL WAS BEING ZOOMED OUT. The chip grid was five
 * columns; at 20% of a ~390px phone that is 78px a cell, which "Mississauga" and
 * "Richmond Hill" cannot fit. The table pushed past 600px, and Gmail scales the WHOLE
 * document down to fit the widest element — so every other line shrank to pay for the
 * chips. Three columns is the actual fix; this stylesheet is the polish on top.
 *
 * The context column is hidden below 480px rather than wrapped. Three columns of
 * label / value / context inside ~340px of usable width gives the value about 60px, and a
 * wrapped "median, among those that cut" costs more legibility than it adds.
 */
const MOBILE_CSS = `
@media only screen and (max-width:480px){
  .dd-pad{padding:20px 18px 24px!important}
  .dd-figure{font-size:46px!important}
  .dd-unit{font-size:27px!important}
  .dd-lede{font-size:17px!important}
  .dd-because{font-size:15px!important}
  .dd-tension{font-size:15px!important;padding:14px 14px!important}
  .dd-sec{font-size:13px!important}
  .dd-rl{font-size:15px!important}
  .dd-rv{font-size:15px!important}
  .dd-rc{display:none!important}
  .dd-src{font-size:13px!important}
  .dd-chip{font-size:15px!important;padding:13px 4px!important}
  .dd-note{font-size:13px!important}
  .dd-also{font-size:14px!important}
}`;

/**
 * Where a chip points: `/api/email/follow-market`, which SAVES the market to the account and
 * then redirects to that city's camera.
 *
 * Both halves matter. A plain map link only moves the reader — it leaves them with no saved
 * area, so next Thursday they get the province email again and the app still thinks they
 * picked nothing. And the redirect is a CAMERA (`?lat=&lng=&z=`), never `?city=`: a text
 * filter pins the map to that place and empties it the moment they pan past the boundary.
 *
 * DELIBERATELY NOT UTM-TAGGED HERE. This URL is an API hop, not a destination — analytics
 * never sees it, only the 302 target. So the chip carries the week as a plain `w=` and the
 * ROUTE tags the page the reader lands on (src/app/api/email/follow-market/route.ts). That
 * also keeps the signed `s=` out of a URLSearchParams round trip, which is exactly the kind
 * of quiet re-encoding that breaks an HMAC.
 */
const chipUrl = (city: string, email: string, sig: string, weekId: string) =>
  `${SITE}/api/email/follow-market?e=${encodeURIComponent(email)}&s=${encodeURIComponent(sig)}` +
  `&city=${encodeURIComponent(city)}&w=${encodeURIComponent(weekId)}`;

// ── Subject + preheader ───────────────────────────────────────────────────────

function subjectFor(p: DataDropPayload): { subject: string; preheader: string } {
  const r = p.region;
  const fig = `${p.headline.figure}${p.headline.unit}`;
  switch (p.headline.kind) {
    case "over_ask_flip":
      return {
        subject:
          Number(p.headline.figure) >= 50
            ? `More than half of ${r} homes now sell over asking`
            : `Fewer than half of ${r} homes now sell over asking`,
        preheader: plain(p.headline.because).slice(0, 120),
      };
    case "leverage":
      return {
        subject: `${r}: ${fig} of sellers have now cut their price`,
        preheader: plain(p.headline.because).slice(0, 120),
      };
    case "speed":
      return {
        subject: `${r} homes now take ${p.headline.figure} days to sell`,
        preheader: plain(p.headline.because).slice(0, 120),
      };
    case "supply":
      return {
        subject: `${fig} homes are for sale in ${r} right now`,
        preheader: plain(p.headline.because).slice(0, 120),
      };
    case "bidding":
      return {
        subject: `${fig} of ${r} sales closed above asking`,
        preheader: plain(p.headline.because).slice(0, 120),
      };
    default:
      return {
        subject: `A typical ${r} home sold for ${p.headline.figure} last month`,
        preheader: plain(p.headline.because).slice(0, 120),
      };
  }
}

// ── Fragments ─────────────────────────────────────────────────────────────────

/**
 * The hero number. This is a STAT TILE, not a chart — the three supporting metrics are a
 * share, a dollar amount and a day count, which share no scale, so bars across them would
 * encode magnitude against nothing. The number itself is the visual.
 *
 * The short cyan rule under the figure echoes the header's accent bar, so the eye lands on
 * the number, then the rule, then the sentence — one path instead of a wall of left-aligned
 * text. It is the cheapest structure available in email and costs no images.
 */
function headlineBlock(p: DataDropPayload, now: number): string {
  return `
    <p style="font-family:${MONO};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin:0 0 16px;">
      ${esc(p.region)} &middot; week of ${weekOf(now)}
    </p>
    <p class="dd-figure" style="font-family:${MONO};font-size:52px;line-height:1;font-weight:700;color:#0a1828;letter-spacing:-.02em;margin:0 0 10px;">
      ${esc(p.headline.figure)}<span class="dd-unit" style="font-size:30px;color:#475569;">${esc(p.headline.unit)}</span>
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>
      <td style="width:44px;height:3px;background:#0891b2;line-height:3px;font-size:0;">&#8203;</td>
    </tr></table>
    <p class="dd-lede" style="font-size:16px;line-height:1.55;color:#0f172a;margin:0 0 8px;">${p.headline.lede}</p>
    <p class="dd-because" style="font-size:14px;line-height:1.6;color:#475569;margin:0;">${p.headline.because}</p>`;
}

/** Section header with the brand's accent tick — same cyan as the header rule. */
function secHd(title: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:26px 0 10px;"><tr>
    <td style="width:12px;height:2px;background:#0891b2;line-height:2px;font-size:0;">&#8203;</td>
    <td style="padding-left:8px;"><span class="dd-sec" style="font-size:12px;color:#334155;text-transform:uppercase;letter-spacing:.10em;font-weight:700;">${title}</span></td>
  </tr></table>`;
}

function rowsBlock(p: DataDropPayload): string {
  if (!p.rows.length) return "";
  // Zebra banding rather than hairlines: it survives Gmail's dark-mode inversion (a 1px
  // #f1f5f9 rule disappears into an inverted background) and gives the eye a row to track
  // across on a narrow screen.
  const tr = p.rows
    .map((r, idx) => {
      const bg = idx % 2 === 0 ? "#f8fafc" : "#ffffff";
      return `
      <tr>
        <td class="dd-rl" style="padding:11px 12px;background:${bg};font-size:14px;color:#475569;">${esc(r.label)}</td>
        <td class="dd-rv" align="right" style="padding:11px 8px;background:${bg};font-family:${MONO};font-size:15px;font-weight:700;color:#0a1828;white-space:nowrap;">${esc(r.value)}</td>
        <td class="dd-rc" align="right" style="padding:11px 12px;background:${bg};font-size:12px;color:#64748b;">${esc(r.context)}</td>
      </tr>`;
    })
    .join("");
  return `${secHd("The rest of the picture")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${tr}</table>`;
}

/** The source line — a trust device before it is a link, and three public backlinks. */
function sourcesBlock(p: DataDropPayload, tag: Tagger): string {
  const links = p.trackers
    .map(
      (t) =>
        `<a href="${tag(trackerUrl(t.slug), `tracker-${t.slug}`)}" style="color:#0e7490;text-decoration:none;font-weight:600;">${esc(t.label)}</a>`
    )
    .join(" &middot; ");
  return `<p class="dd-src" style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#64748b;">Check the tables: ${links}</p>`;
}

/**
 * The tension block — the one place in this email a real visualization earns its keep.
 *
 * The three supporting rows are a share, a dollar amount and a day count: no shared scale,
 * so a bar beside each would encode magnitude against nothing. This is different. It is a
 * single measure (share of sales above asking) across named places on a common scale, and
 * the whole argument of the province email is that the average hides how far apart those
 * places are. Showing them does the persuading the sentence can only assert.
 *
 * A RANKED BAR LIST, not a range strip. The first attempt drew one segment on a 0-100 track
 * with "10% Hamilton" left-aligned and "37% Oshawa" right-aligned — so each label sat at the
 * edge of the container while its mark sat somewhere in the middle, pointing at nothing, and
 * two thirds of the track carried no information at all. Bars sorted high to low, each with
 * its own name and value on its own line, fixes both: every label is anchored to its own
 * mark, and the comparison the reader must make is now the length difference between
 * adjacent rows.
 *
 * Scaled to the largest value rather than to 100, so the widest bar fills the track and no
 * space is spent on emptiness. Every bar carries its absolute value, so nothing is implied
 * by length alone. One measure, so no legend. Ontario is the REFERENCE row, not a peer, so
 * it takes the neutral ink and the cities take the brand hue — and it is labelled, never
 * distinguished by colour alone.
 *
 * Built from nested percentage-width table cells: email cannot rely on SVG and must never
 * depend on a remote image.
 */
function spreadChart(spread: NonNullable<DataDropPayload["spread"]>): string {
  const points = [spread.high, ...(spread.mid ? [spread.mid] : []), spread.low];
  const max = Math.max(...points.map((p) => p.pct)) || 1;

  const row = (pt: { region: string; pct: number }, isRef: boolean) => {
    const w = Math.max(3, Math.round((pt.pct / max) * 100));
    const fill = isRef ? "#64748b" : "#0891b2";
    return `
      <tr>
        <td width="30%" style="padding:4px 8px 4px 0;font-size:12px;color:${isRef ? "#334155" : "#475569"};${isRef ? "font-weight:700;" : ""}white-space:nowrap;">${esc(pt.region)}</td>
        <td width="55%" style="padding:4px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            <tr>
              <td width="${w}%" style="background:${fill};height:11px;line-height:11px;font-size:0;border-radius:3px;">&#8203;</td>
              <td width="${100 - w}%" style="font-size:0;line-height:11px;">&#8203;</td>
            </tr>
          </table>
        </td>
        <td width="15%" align="right" style="padding:4px 0 4px 8px;font-family:${MONO};font-size:12px;font-weight:700;color:#0a1828;">${pt.pct.toFixed(0)}%</td>
      </tr>`;
  };

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:14px 0 4px;border-collapse:collapse;">
      ${points.map((pt) => row(pt, pt.region === spread.mid?.region)).join("")}
    </table>
    <p style="margin:6px 0 0;font-size:11px;color:#64748b;">Share of sales closing above the asking price, last month.</p>`;
}

function tensionBlock(p: DataDropPayload): string {
  if (!p.spread) return "";
  const { low, high, mid } = p.spread;
  // Name the places in the sentence too. The chart shows the shape; the sentence has to
  // survive an images-off client and a reader who only skims the bold line.
  const claim = mid
    ? `<b>But the province-wide number hides your city.</b> ${esc(high.region)} is at ${high.pct.toFixed(0)}%. ${esc(low.region)} is at ${low.pct.toFixed(0)}%. The ${mid.pct.toFixed(0)}% average describes neither one.`
    : `<b>But the province-wide number hides your city.</b> ${esc(high.region)} is at ${high.pct.toFixed(0)}% and ${esc(low.region)} is at ${low.pct.toFixed(0)}%.`;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0 0;">
      <tr>
        <td style="width:3px;background:#0891b2;font-size:0;line-height:0;">&#8203;</td>
        <td class="dd-tension" style="background:#f8fafc;padding:15px 16px;font-size:14px;line-height:1.6;color:#334155;">
          ${claim}
          ${spreadChart(p.spread)}
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#334155;">Pick your city below to see its own numbers.</p>
        </td>
      </tr>
    </table>`;
}

/**
 * The chip grid. Every market the weekly can cover, five per row.
 *
 * Driven by BOARD_MARKETS, never a hand-written list: the set a reader may pick must equal
 * the set the next send can serve, or the chip makes a promise the following Thursday
 * breaks. (QUICK_PICK_MARKETS is NOT that set — it carries London, which has no board row,
 * and omits Milton/Oshawa/Whitby/Ajax/Pickering, which do.)
 */
function chipsBlock(markets: string[], email: string, sig: string, weekId: string): string {
  // THREE, not five. At 20% of a ~390px phone a cell is 78px, which "Mississauga" and
  // "Richmond Hill" cannot fit — the table pushed past 600px and Gmail scaled the entire
  // document down to compensate, which is what made every other line look tiny. At 33% the
  // widest label fits on the narrowest common phone and nothing is scaled.
  const PER_ROW = 3;
  const rows: string[] = [];
  for (let i = 0; i < markets.length; i += PER_ROW) {
    const cells = markets.slice(i, i + PER_ROW);
    const pad = PER_ROW - cells.length;
    const tds = cells
      .map(
        (c) =>
          `<td width="33.33%" style="padding:3px;">
             <a class="dd-chip" href="${chipUrl(c, email, sig, weekId)}" style="display:block;text-align:center;text-decoration:none;padding:10px 4px;font-size:13px;font-weight:600;color:#0a1828;background:#ffffff;border:1px solid #cbd5e1;border-radius:5px;">${esc(c).replace(/ /g, "&nbsp;")}</a>
           </td>`
      )
      .join("");
    const filler = pad > 0 ? `<td width="${(33.33 * pad).toFixed(2)}%">&#8203;</td>` : "";
    rows.push(`<tr>${tds}${filler}</tr>`);
  }
  return `${secHd("Pick your market &mdash; one tap")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows.join("")}</table>
    <p class="dd-note" style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#64748b;">
      Next Thursday this email is about your city instead of the province. Change or remove it
      any time. Don't see yours? Reply and tell us &mdash; we add markets as the data covers them.
    </p>`;
}

function othersBlock(p: DataDropPayload): string {
  if (!p.others.length) return "";
  const list = p.others
    .map((o) => `<span style="color:#0a1828;font-weight:600;">${esc(o.region)}</span> ${esc(o.value)}`)
    .join(" &middot; ");
  return `<p class="dd-also" style="font-size:13px;color:#475569;margin:20px 0 0;line-height:1.6;">Also in your markets: ${list}</p>`;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderDataDropEmail(i: RenderInput, now = Date.now()): Rendered {
  const p = i.payload;
  const { subject, preheader } = subjectFor(p);

  // One tagger per send. The campaign is this week's id, so "did week 3 beat week 2" is a
  // group-by rather than a string parse. The unsubscribe link is NEVER passed through it —
  // see the warning in src/lib/email/utm.ts.
  const tag: Tagger = utmTagger(UTM_SOURCE, p.weekId);
  const manageUrl = tag(i.manageUrl, "manage");

  // A province send NEVER points at the terminal: "Ontario" is not a city, so `?city=Ontario`
  // seeds a filter that matches nothing. It goes to the public tracker, which is also the
  // right destination for a reader who has saved nothing and may not even be unlocked.
  const useTerminal = p.scope === "market" && i.ctaTarget === "terminal";
  // Camera seed, never a city text filter — same reason as the chips.
  const ctaUrl = tag(
    useTerminal ? marketMapUrl(SITE, p.region) : trackerUrl(p.trackers[0]?.slug ?? "price-cuts"),
    "cta"
  );
  const ctaLabel =
    p.scope === "province"
      ? "See every neighbourhood"
      : useTerminal
        ? `See ${p.region} on the map`
        : `See the ${p.region} tables`;

  const body = [
    headlineBlock(p, now),
    // Province send: tension immediately after the news, ask immediately after the rows.
    // Nothing may sit between the tension and the ask.
    p.scope === "province" ? tensionBlock(p) : "",
    rowsBlock(p),
    sourcesBlock(p, tag),
    p.scope === "province" ? chipsBlock(i.chipMarkets, i.email, i.signature, p.weekId) : "",
    `<div style="margin:26px 0 0;">${button(`${ctaLabel} &rarr;`, ctaUrl)}</div>`,
    othersBlock(p),
    footer({
      intro: "You get this because the weekly market update is on.",
      manageUrl,
      unsubscribeUrl: i.unsubscribeUrl,
    }).replace(
      "Data is deemed reliable",
      `Aggregate figures only. Data as of ${monthDay(p.dataAsOf)}.<br>Data is deemed reliable`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const html = shell({ preheader, headerLabel: "WEEKLY DATA DROP", body, headStyle: MOBILE_CSS });

  // ── Plaintext part. Required, not optional (§11.7 item 6). ──────────────────
  const t: string[] = [];
  t.push(`${p.region.toUpperCase()} - WEEK OF ${weekOf(now).toUpperCase()}`, "");
  t.push(`${p.headline.figure}${p.headline.unit} ${plain(p.headline.lede)}`, "");
  t.push(plain(p.headline.because), "");
  if (p.scope === "province" && p.spread) {
    t.push("But the province-wide number hides your city.", "");
    t.push("  Share of sales closing above the asking price, last month:");
    const pts = [p.spread.high, ...(p.spread.mid ? [p.spread.mid] : []), p.spread.low];
    const mx = Math.max(...pts.map((x) => x.pct)) || 1;
    for (const pt of pts) {
      const bars = "#".repeat(Math.max(1, Math.round((pt.pct / mx) * 24)));
      t.push(`    ${pt.region.padEnd(12)}${bars.padEnd(25)}${pt.pct.toFixed(0)}%`);
    }
    t.push("", "Pick your city below to see its own numbers.", "");
  }
  if (p.rows.length) {
    t.push("THE REST OF THE PICTURE", "");
    for (const r of p.rows) t.push(`  ${r.label.padEnd(22)}${r.value.padEnd(10)}${r.context}`);
    t.push("");
  }
  t.push("Check the tables:");
  for (const tr of p.trackers)
    t.push(`  ${tr.label.padEnd(18)}${tag(trackerUrl(tr.slug), `tracker-${tr.slug}`)}`);
  t.push("");
  if (p.scope === "province") {
    t.push("PICK YOUR MARKET - one tap:");
    for (const m of i.chipMarkets)
      t.push(`  ${m.padEnd(16)}${chipUrl(m, i.email, i.signature, p.weekId)}`);
    t.push("");
    t.push("Don't see yours? Reply and tell us - we add markets as the data covers them.", "");
  }
  t.push(`${ctaLabel}:`, ctaUrl, "");
  if (p.others.length) {
    t.push(`Also in your markets: ${p.others.map((o) => `${o.region} ${o.value}`).join(", ")}`, "");
  }
  t.push("--");
  t.push("You get this because the weekly market update is on.");
  t.push(`Manage emails:  ${manageUrl}`);
  t.push(`Unsubscribe:    ${i.unsubscribeUrl}`);
  t.push("");
  t.push(`Aggregate figures only. Data as of ${monthDay(p.dataAsOf)}.`);
  t.push("Data is deemed reliable but not guaranteed accurate.");
  t.push("Powered by PROPTX MLS(R).");
  t.push("PureProperty - 268 America Ave, Vaughan, ON L6A 3G7");

  return { subject, preheader, html, text: t.join("\n") };
}
