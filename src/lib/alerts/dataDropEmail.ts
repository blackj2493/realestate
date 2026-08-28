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
  sectionHeader,
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

function headlineBlock(p: DataDropPayload, now: number): string {
  return `
    <p style="font-family:${MONO};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin:0 0 18px;">
      ${esc(p.region)} &middot; week of ${weekOf(now)}
    </p>
    <p style="font-family:${MONO};font-size:52px;line-height:1;font-weight:700;color:#0a1828;letter-spacing:-.02em;margin:0 0 12px;">
      ${esc(p.headline.figure)}<span style="font-size:30px;color:#475569;">${esc(p.headline.unit)}</span>
    </p>
    <p style="font-size:16px;line-height:1.55;color:#0f172a;margin:0 0 10px;">${p.headline.lede}</p>
    <p style="font-size:14px;line-height:1.6;color:#475569;margin:0;">${p.headline.because}</p>`;
}

function rowsBlock(p: DataDropPayload): string {
  if (!p.rows.length) return "";
  const tr = p.rows
    .map(
      (r, idx) => `
      <tr>
        <td style="padding:9px 0;${idx ? "border-top:1px solid #f1f5f9;" : ""}font-size:14px;color:#475569;">${esc(r.label)}</td>
        <td align="right" style="padding:9px 0 9px 12px;${idx ? "border-top:1px solid #f1f5f9;" : ""}font-family:${MONO};font-size:14px;font-weight:700;color:#0a1828;white-space:nowrap;">${esc(r.value)}</td>
        <td align="right" style="padding:9px 0 9px 14px;${idx ? "border-top:1px solid #f1f5f9;" : ""}font-size:12px;color:#64748b;">${esc(r.context)}</td>
      </tr>`
    )
    .join("");
  return `${sectionHeader("The rest of the picture")}
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
  return `<p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#64748b;">Check the tables: ${links}</p>`;
}

function tensionBlock(p: DataDropPayload): string {
  if (!p.spread) return "";
  const gap = Math.round(p.spread.high.pct - p.spread.low.pct);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0 0;">
      <tr>
        <td style="width:3px;background:#0891b2;">&nbsp;</td>
        <td style="background:#f8fafc;padding:15px 16px;font-size:14px;line-height:1.6;color:#334155;">
          <b>But the province-wide number hides your city.</b>
          The share of homes selling above asking runs from
          <span style="font-family:${MONO};font-weight:700;color:#0a1828;">${p.spread.low.pct.toFixed(0)}%</span> in ${esc(p.spread.low.region)} to
          <span style="font-family:${MONO};font-weight:700;color:#0a1828;">${p.spread.high.pct.toFixed(0)}%</span> in ${esc(p.spread.high.region)}
          &mdash; a ${gap}-point spread. Pick your city below to see its own numbers.
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
  const PER_ROW = 5;
  const rows: string[] = [];
  for (let i = 0; i < markets.length; i += PER_ROW) {
    const cells = markets.slice(i, i + PER_ROW);
    const pad = PER_ROW - cells.length;
    const tds = cells
      .map(
        (c) =>
          `<td width="20%" style="padding:3px;">
             <a href="${chipUrl(c, email, sig)}" style="display:block;text-align:center;text-decoration:none;padding:10px 4px;font-size:13px;font-weight:600;color:#0a1828;background:#ffffff;border:1px solid #cbd5e1;border-radius:5px;">${esc(c).replace(/ /g, "&nbsp;")}</a>
           </td>`
      )
      .join("");
    const filler = pad > 0 ? `<td width="${20 * pad}%">&nbsp;</td>` : "";
    rows.push(`<tr>${tds}${filler}</tr>`);
  }
  return `${sectionHeader("Pick your market &mdash; one tap")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows.join("")}</table>
    <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#64748b;">
      Next Thursday this email is about your city instead of the province. Change or remove it
      any time. Don't see yours? Reply and tell us &mdash; we add markets as the data covers them.
    </p>`;
}

function othersBlock(p: DataDropPayload): string {
  if (!p.others.length) return "";
  const list = p.others
    .map((o) => `<span style="color:#0a1828;font-weight:600;">${esc(o.region)}</span> ${esc(o.value)}`)
    .join(" &middot; ");
  return `<p style="font-size:13px;color:#475569;margin:20px 0 0;line-height:1.6;">Also in your markets: ${list}</p>`;
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

  const html = shell({ preheader, headerLabel: "WEEKLY DATA DROP", body });

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
