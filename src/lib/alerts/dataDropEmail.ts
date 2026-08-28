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
 */
const chipUrl = (city: string, email: string, sig: string) =>
  `${SITE}/api/email/follow-market?e=${encodeURIComponent(email)}&s=${encodeURIComponent(sig)}&city=${encodeURIComponent(city)}`;

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
      <td style="width:44px;height:3px;background:#0891b2;line-height:3px;font-size:0;">&nbsp;</td>
    </tr></table>
    <p class="dd-lede" style="font-size:16px;line-height:1.55;color:#0f172a;margin:0 0 8px;">${p.headline.lede}</p>
    <p class="dd-because" style="font-size:14px;line-height:1.6;color:#475569;margin:0;">${p.headline.because}</p>`;
}

/** Section header with the brand's accent tick — same cyan as the header rule. */
function secHd(title: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:26px 0 10px;"><tr>
    <td style="width:12px;height:2px;background:#0891b2;line-height:2px;font-size:0;">&nbsp;</td>
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
function sourcesBlock(p: DataDropPayload): string {
  const links = p.trackers
    .map(
      (t) =>
        `<a href="${trackerUrl(t.slug)}" style="color:#0e7490;text-decoration:none;font-weight:600;">${esc(t.label)}</a>`
    )
    .join(" &middot; ");
  return `<p class="dd-src" style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#64748b;">Check the tables: ${links}</p>`;
}

/**
 * The tension block — and the ONE place in this email a real visualization earns its keep.
 *
 * The three supporting rows are a share, a dollar amount and a day count: no shared scale,
 * so a bar beside each would encode magnitude against nothing. The spread is different. It
 * is a single measure (share of sales above asking) on a common 0-100 scale, and the whole
 * argument of this email is that the province average hides how wide that range is. Showing
 * the range does the persuading that the sentence can only assert.
 *
 * One series, so no legend; both ends are directly labelled, so identity is never carried by
 * colour alone. The track is a neutral surface, the range is one brand hue, and every number
 * stays in ink — the mark carries the shape, the text carries the values.
 *
 * Built from nested percentage-width table cells because an email cannot use SVG reliably
 * and must never depend on a remote image.
 */
function tensionBlock(p: DataDropPayload): string {
  if (!p.spread) return "";
  const lo = p.spread.low.pct;
  const hi = p.spread.high.pct;
  const gap = Math.round(hi - lo);

  // Scale 0-100 with a little breathing room, clamped so a wide range cannot overflow.
  const pos = (v: number) => Math.max(0, Math.min(100, v));
  const lead = pos(lo);
  const span = Math.max(2, pos(hi) - pos(lo));
  const trail = Math.max(0, 100 - lead - span);

  const bar = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0 6px;border-collapse:collapse;">
      <tr>
        <td width="${lead.toFixed(1)}%" style="height:10px;background:#e2e8f0;line-height:10px;font-size:0;border-radius:5px 0 0 5px;">&nbsp;</td>
        <td width="${span.toFixed(1)}%" style="height:10px;background:#0891b2;line-height:10px;font-size:0;">&nbsp;</td>
        <td width="${trail.toFixed(1)}%" style="height:10px;background:#e2e8f0;line-height:10px;font-size:0;border-radius:0 5px 5px 0;">&nbsp;</td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td align="left" style="font-family:${MONO};font-size:11px;color:#475569;">${lo.toFixed(0)}% ${esc(p.spread.low.region)}</td>
        <td align="right" style="font-family:${MONO};font-size:11px;color:#475569;">${hi.toFixed(0)}% ${esc(p.spread.high.region)}</td>
      </tr>
    </table>`;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0 0;">
      <tr>
        <td style="width:3px;background:#0891b2;">&nbsp;</td>
        <td class="dd-tension" style="background:#f8fafc;padding:15px 16px;font-size:14px;line-height:1.6;color:#334155;">
          <b>But the province-wide number hides your city.</b>
          The share of homes selling above asking runs ${gap} points wide.
          ${bar}
          <span style="display:block;margin-top:8px;">Pick your city below to see its own numbers.</span>
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
function chipsBlock(markets: string[], email: string, sig: string): string {
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
             <a class="dd-chip" href="${chipUrl(c, email, sig)}" style="display:block;text-align:center;text-decoration:none;padding:10px 4px;font-size:13px;font-weight:600;color:#0a1828;background:#ffffff;border:1px solid #cbd5e1;border-radius:5px;">${esc(c).replace(/ /g, "&nbsp;")}</a>
           </td>`
      )
      .join("");
    const filler = pad > 0 ? `<td width="${(33.33 * pad).toFixed(2)}%">&nbsp;</td>` : "";
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

  // A province send NEVER points at the terminal: "Ontario" is not a city, so `?city=Ontario`
  // seeds a filter that matches nothing. It goes to the public tracker, which is also the
  // right destination for a reader who has saved nothing and may not even be unlocked.
  const useTerminal = p.scope === "market" && i.ctaTarget === "terminal";
  // Camera seed, never a city text filter — same reason as the chips.
  const ctaUrl = useTerminal
    ? marketMapUrl(SITE, p.region)
    : trackerUrl(p.trackers[0]?.slug ?? "price-cuts");
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
    sourcesBlock(p),
    p.scope === "province" ? chipsBlock(i.chipMarkets, i.email, i.signature) : "",
    `<div style="margin:26px 0 0;">${button(`${ctaLabel} &rarr;`, ctaUrl)}</div>`,
    othersBlock(p),
    footer({
      intro: "You get this because the weekly market update is on.",
      manageUrl: i.manageUrl,
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
    t.push(
      `But the province-wide number hides your city. The share of homes selling above ` +
        `asking runs from ${p.spread.low.pct.toFixed(0)}% in ${p.spread.low.region} to ` +
        `${p.spread.high.pct.toFixed(0)}% in ${p.spread.high.region} — a ` +
        `${Math.round(p.spread.high.pct - p.spread.low.pct)}-point spread. ` +
        `Pick your city below to see its own numbers.`,
      ""
    );
  }
  if (p.rows.length) {
    t.push("THE REST OF THE PICTURE", "");
    for (const r of p.rows) t.push(`  ${r.label.padEnd(22)}${r.value.padEnd(10)}${r.context}`);
    t.push("");
  }
  t.push("Check the tables:");
  for (const tr of p.trackers) t.push(`  ${tr.label.padEnd(18)}${trackerUrl(tr.slug)}`);
  t.push("");
  if (p.scope === "province") {
    t.push("PICK YOUR MARKET - one tap:");
    for (const m of i.chipMarkets) t.push(`  ${m.padEnd(16)}${chipUrl(m, i.email, i.signature)}`);
    t.push("");
    t.push("Don't see yours? Reply and tell us - we add markets as the data covers them.", "");
  }
  t.push(`${ctaLabel}:`, ctaUrl, "");
  if (p.others.length) {
    t.push(`Also in your markets: ${p.others.map((o) => `${o.region} ${o.value}`).join(", ")}`, "");
  }
  t.push("--");
  t.push("You get this because the weekly market update is on.");
  t.push(`Manage emails:  ${i.manageUrl}`);
  t.push(`Unsubscribe:    ${i.unsubscribeUrl}`);
  t.push("");
  t.push(`Aggregate figures only. Data as of ${monthDay(p.dataAsOf)}.`);
  t.push("Data is deemed reliable but not guaranteed accurate.");
  t.push("Powered by PROPTX MLS(R).");
  t.push("PureProperty - 268 America Ave, Vaughan, ON L6A 3G7");

  return { subject, preheader, html, text: t.join("\n") };
}
