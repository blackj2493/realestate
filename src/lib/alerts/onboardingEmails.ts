/**
 * Onboarding-drip email renderers (engagement build plan 1.4 + 5.1).
 *
 * Pure renderers — subject + html + text from a fully-shaped payload, no I/O (the
 * onboarding worker fetches live data via onboardingData.ts and passes it here, exactly
 * like digest.ts / the alerts worker). Every email composes emailShell (shell/footer/
 * button) so it inherits the branded shell + CASL/MLS-compliant footer.
 *
 * Copy is the owner-approved onboarding mockup (2A/2B/#3/finish-account), held to the
 * plain-language rule (voice.md §5.1): specialized finance terms — Cap Rate, Capital
 * Burn — are glossed once; self-evident ones (True days on market) are left alone.
 *
 * Compliance: 2B shows REAL active listings, so every row carries the listing brokerage
 * (TRREB §6.3(c)) and the footer keeps the "deemed reliable … PROPTX MLS®" notice. The
 * other emails show no live listing data (mls:false).
 */

import { shell, footer, button, MONO, money, listingUrl, esc, SITE } from "./emailShell";

// ── Shared payload types (produced by onboardingData.ts) ───────────────────────

export interface OnboardingListingRow {
  listing_key: string;
  address: string;
  city: string | null;
  price: number | null;
  thumb: string | null;
  brokerage: string | null;
  /** Board this row leads (e.g. "Highest Cap Rate"). */
  boardTitle: string;
  /** Short metric label (e.g. "CAP", "TRUE DOM"). */
  metricLabel: string;
  /** Formatted metric value (e.g. "8.4%", "198d"). */
  metricValue: string;
}

export interface OnboardingAreaData {
  /** Display label for the area (e.g. "Woodbridge"). */
  areaName: string;
  /** New active listings in the area over the lens window (IDX-safe aggregate). */
  newCount: number | null;
  /** Active listings for sale now (IDX-safe aggregate). */
  activeCount: number | null;
  /** One representative row per board (up to 6). */
  rows: OnboardingListingRow[];
}

/** A plain real listing shown in #3 ("homes worth saving") — real MLS photo in prod. */
export interface SaveHomeListing {
  listing_key: string;
  address: string;
  city: string | null;
  price: number | null;
  thumb: string | null;
  brokerage: string | null;
}

interface FooterOpts {
  unsubscribeUrl?: string;
  manageUrl?: string;
}

type Rendered = { subject: string; html: string; text: string };

// ── Local row helpers (modelled on digest.ts; kept self-contained so the live
//    digest markup is never disturbed) ─────────────────────────────────────────

const isHttpUrl = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

// Public MLS marketing media (PropTx) — pre-watermarked, so safe in an unauthenticated
// email; a blocked/missing photo degrades to a clean gray box, not a broken-image icon.
function thumbCell(listingKey: string, thumb: string | null | undefined): string {
  const box =
    "display:block;width:84px;height:63px;border-radius:6px;border:0;background:#eef2f6;object-fit:cover;";
  const inner = isHttpUrl(thumb)
    ? `<img src="${thumb}" width="84" height="63" alt="" style="${box}">`
    : `<span style="${box}"></span>`;
  return `<td width="84" valign="top" style="width:84px;padding:12px 12px 12px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(listingKey)}" style="text-decoration:none;">${inner}</a>
      </td>`;
}

// TRREB §6.3(c): brokerage on EVERY listing row, same "Brokerage unavailable" fallback
// the cards use when the feed omits ListOfficeName.
const brokerageLine = (b: string | null) =>
  `<div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(b || "Brokerage unavailable")}</div>`;

function boardRowHtml(r: OnboardingListingRow): string {
  const priceStr = r.price != null ? money(r.price) : "";
  return `
      <tr>
        ${thumbCell(r.listing_key, r.thumb)}
        <td valign="top" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:11px;font-weight:700;color:#0891b2;text-transform:uppercase;letter-spacing:.06em;">${esc(r.boardTitle)}</div>
          <a href="${listingUrl(r.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;">${esc(r.address)}</a>
          <div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(r.city || "")}</div>
          ${brokerageLine(r.brokerage)}
          <div style="margin-top:6px;font-size:13px;color:#0f172a;">
            <span style="font-family:${MONO};font-weight:700;color:#0e7490;">${esc(r.metricValue)}</span>
            <span style="font-family:${MONO};color:#64748b;font-size:11px;"> ${esc(r.metricLabel)}</span>
            ${priceStr ? ` &middot; <strong>${priceStr}</strong>` : ""}
          </div>
        </td>
      </tr>`;
}

// ── "App UI" illustration helpers — dark cards that show what a feature looks like,
//    reproducing the owner-approved mockup. Email-safe: inline styles, inline-block
//    chips, tables for two-sided rows. No flexbox, no SVG (Gmail strips inline SVG), so
//    the little house drawings from the mockup can't ride along — real sends use real MLS
//    photos in the listing rows; these blocks are pure styled HTML that DOES render. ──
const UI_CARD = "background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;margin-top:12px;";
const uiCard = (inner: string) => `<div style="${UI_CARD}">${inner}</div>`;
const uiLabel = (t: string) =>
  `<div style="font-family:${MONO};font-size:11px;font-weight:700;color:#e2e8f0;text-transform:uppercase;letter-spacing:.08em;">${t}</div>`;
const uiSub = (t: string) => `<div style="font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5;">${t}</div>`;
const uiCap = (t: string) => `<div style="font-size:12px;color:#94a3b8;margin-top:12px;line-height:1.5;">${t}</div>`;
const mono10 = (t: string) =>
  `<div style="font-family:${MONO};font-size:10px;color:#64748b;letter-spacing:.08em;text-transform:uppercase;">${t}</div>`;
// A pill/chip: highlighted (on) = cyan, else outlined. `label` is trusted markup (entities).
const chip = (label: string, on = false) =>
  `<span style="display:inline-block;border:1px solid ${on ? "#0891b2" : "#334155"};background:${on ? "rgba(8,145,178,.15)" : "transparent"};color:${on ? "#67e8f9" : "#94a3b8"};border-radius:6px;padding:6px 11px;font-size:12px;font-weight:600;margin:8px 6px 0 0;">${label}</span>`;
// A segmented [A][B][C] control with one segment active.
const scopeSeg = (labels: string[], activeIdx: number) =>
  `<span style="display:inline-block;border:1px solid #334155;border-radius:6px;overflow:hidden;vertical-align:middle;">` +
  labels
    .map(
      (l, i) =>
        `<span style="display:inline-block;padding:5px 10px;font-size:11px;font-weight:600;${i === activeIdx ? "background:rgba(8,145,178,.18);color:#67e8f9;" : "color:#94a3b8;"}">${l}</span>`
    )
    .join("") +
  `</span>`;

const H1 = 'style="font-size:18px;color:#0f172a;margin:0 0 10px;"';
const P = 'style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 12px;"';
const FINE = 'style="font-size:12px;color:#94a3b8;margin:14px 0 0;"';

// ── 2A · "Get more out of your dashboard" (added an area, under-using it) ───────

export function renderDashboardEducationEmail(opts: { areaName: string } & FooterOpts): Rendered {
  const area = esc(opts.areaName);
  const subject = `Get more out of your ${opts.areaName} dashboard`;
  const preheader = "Rank it to your goal, filter it — and it's already watching for new listings.";

  const bellRow = `<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:12px;"><tr>
        <td style="color:#e7eef5;font-size:13px;font-weight:600;">&#9662; ${area}</td>
        <td align="right">${scopeSeg(["All listings", "My filters only"], 0)}&nbsp;<span style="display:inline-block;border:1px solid #0891b2;background:rgba(8,145,178,.15);color:#67e8f9;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;vertical-align:middle;">&#128276; Alerts on</span></td>
      </tr></table>`;

  const body = `
      <h1 ${H1}>Make your ${area} dashboard work for you</h1>
      <p ${P}>You're following ${area} — and new listings there already come to your inbox. Three quick ways to get more out of it:</p>
      ${uiCard(
        uiLabel("1 · Rank it to your goal") +
          `<div>${chip("&#10003; Cash flow", true)}${chip("Flip")}${chip("To live in")}${chip("Develop")}</div>` +
          uiCap(
            `Pick what you're after and the boards reorder — cash-flow buyers see <b style="color:#cbd5e1;">Cap Rate</b> (the yearly return if you rented it out) and <b style="color:#cbd5e1;">Capital Burn</b> (what it costs to hold each month) first; flippers see the biggest <b style="color:#cbd5e1;">price drops</b> and the homes that have sat <b style="color:#cbd5e1;">longest on the market</b>.`
          )
      )}
      ${uiCard(
        uiLabel("2 · Filter to your kind of home") +
          `<div>${chip("&#10003; Detached", true)}${chip("&#10003; 3+ beds", true)}${chip("&#10003; &le; $1.5M", true)}</div>` +
          uiCap("Set property type, beds, or price — every board and count updates to match.")
      )}
      ${uiCard(
        uiLabel("3 · You're already getting alerts") +
          bellRow +
          uiCap(`New ${area} listings come to your inbox. Switch to <b style="color:#cbd5e1;">My filters only</b>, or mute them, with the bell on the ${area} section anytime.`)
      )}
      <div style="margin:20px 0 0;">${button(`Open your ${area} dashboard &rarr;`, `${SITE}/dashboard`)}</div>
      <p ${FINE}>Tune or turn off any of this in one tap.</p>
      ${footer({
        intro: "You created a PureProperty.ca account.",
        manageUrl: opts.manageUrl,
        unsubscribeUrl: opts.unsubscribeUrl,
        mls: false,
      })}`;

  const html = shell({ preheader, headerLabel: "GETTING STARTED", body });
  const text =
    `Make your ${opts.areaName} dashboard work for you\n\n` +
    `You're following ${opts.areaName} — and new listings there already come to your inbox. Three ways to get more out of it:\n\n` +
    `1. Rank it to your goal — pick what you're after and the boards reorder (cash-flow buyers see Cap Rate, the yearly return if you rented it out, and Capital Burn, the monthly cost to hold, first).\n` +
    `2. Filter to your kind of home — set property type, beds, or price and every board updates.\n` +
    `3. You're already getting alerts — switch to "My filters only" or mute them with the bell anytime.\n\n` +
    `Open your dashboard: ${SITE}/dashboard\n` +
    (opts.unsubscribeUrl ? `\nUnsubscribe: ${opts.unsubscribeUrl}` : "");
  return { subject, html, text };
}

// ── 2B · "Add your first area" (no area yet) — data-driven example ──────────────

export function renderAddAreaEmail(opts: { example: OnboardingAreaData | null } & FooterOpts): Rendered {
  const subject = "Your own live dashboard for any neighbourhood";
  const preheader = "Follow a city or a single community — every listing, ranked.";
  const ex = opts.example;
  const exName = ex ? esc(ex.areaName) : "Woodbridge";

  // Stat tiles (New + Active) — both IDX-safe aggregates; render only what we have.
  const statTiles: string[] = [];
  if (ex?.newCount != null)
    statTiles.push(statTile("New listings", ex.newCount.toLocaleString("en-CA")));
  if (ex?.activeCount != null)
    statTiles.push(statTile("For sale now", ex.activeCount.toLocaleString("en-CA")));

  const exampleBlock = ex
    ? `
      <p ${P}>Here's <b>${exName}</b>, for example — real listings, live:</p>
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-top:4px;background:#f8fafc;">
        <div style="font-family:${MONO};font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em;">Your ${exName} dashboard</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">Every listing, ranked — reordered to match what you're after. Updated daily.</div>
        ${statTiles.length ? `<table role="presentation" style="margin-top:12px;border-collapse:collapse;"><tr>${statTiles.join("")}</tr></table>` : ""}
        ${
          ex.rows.length
            ? `<table style="width:100%;border-collapse:collapse;margin-top:8px;">${ex.rows.map(boardRowHtml).join("")}</table>
        <div style="font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.5;">
          Cap Rate = the yearly return if you rented it out. Capital Burn = what it costs to hold each month.
          True days on market = the real time for sale, relists included.
        </div>`
            : ""
        }
        <div style="font-size:12px;color:#475569;margin-top:12px;">Six ways in — plus every new listing and sale, and live market stats. Updated daily.</div>
      </div>`
    : "";

  const setupCard = uiCard(
    uiLabel("Set up your terminal") +
      uiSub(`Search <b style="color:#cbd5e1;">any</b> city, neighbourhood, or community — each one loads into your dashboard the moment you add it.`) +
      `<div style="margin-top:12px;"><span style="display:inline-block;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e7eef5;font-size:12px;font-weight:600;">+ Add areas</span></div>` +
      // Search field (a two-cell table keeps the hint right-aligned without floats).
      `<table role="presentation" width="100%" style="border-collapse:separate;margin-top:12px;"><tr>
        <td style="border:1px solid #334155;border-radius:6px;padding:11px 12px;">
          <table role="presentation" width="100%" style="border-collapse:collapse;"><tr>
            <td style="color:#e7eef5;font-size:14px;">&#128269;&nbsp;&nbsp;Woodbridge</td>
            <td align="right" style="font-family:${MONO};color:#64748b;font-size:11px;">search any community</td>
          </tr></table>
        </td>
      </tr></table>` +
      // Autocomplete dropdown.
      `<div style="border:1px solid #1e293b;border-radius:6px;margin-top:6px;overflow:hidden;">
        <div style="padding:9px 12px;background:rgba(8,145,178,.12);color:#e7eef5;font-size:13px;">&#128205;&nbsp; <b>Woodbridge</b> &middot; Vaughan</div>
        <div style="padding:9px 12px;color:#64748b;font-size:13px;border-top:1px solid #1e293b;">&#128205;&nbsp; Kleinburg &middot; Vaughan</div>
      </div>` +
      `<div style="margin-top:14px;">${mono10("or tap a popular one")}</div>` +
      `<div>${chip("+ Toronto")}${chip("+ Ottawa")}${chip("+ Mississauga")}${chip("&#10003; Vaughan", true)}${chip("Show more…")}</div>` +
      uiCap(`Search any neighbourhood — <b style="color:#cbd5e1;">Woodbridge</b>, <b style="color:#cbd5e1;">Leslieville</b>, <b style="color:#cbd5e1;">Westboro</b> — not just the popular cities. It's saved the instant you add it.`) +
      `<div style="font-size:12px;color:#94a3b8;margin-top:12px;">And when you add it — <b style="color:#cbd5e1;">email me new listings</b>&nbsp; ${scopeSeg(["All", "My filters", "Off"], 0)}</div>`
  );

  const body = `
      <h1 ${H1}>Follow a neighbourhood. See everything in it.</h1>
      <p ${P}>Add an area you care about — a whole city, or a single community like ${exName} — and PureProperty builds you a live dashboard for it: every home ranked the ways that matter, plus every new listing and recent sale. Updated daily.</p>
      <p ${P}>Add as many as you like. Tighter areas mean sharper detail. Search any city, neighbourhood, or community — not just the popular ones — and it's saved the instant you add it.</p>
      ${setupCard}
      ${exampleBlock}
      <p ${P} style="margin-top:14px;">You'll get the dashboard the instant you add it — and new listings start coming to your inbox automatically (you pick all, just your filters, or off, right when you add it).</p>
      <div style="margin:18px 0 0;">${button("Add your first area &rarr;", `${SITE}/dashboard`)}</div>
      <p ${FINE}>At most one email a day, and only when there's something new. Turn it off anytime.</p>
      ${footer({
        intro: "You created a PureProperty.ca account.",
        manageUrl: opts.manageUrl,
        unsubscribeUrl: opts.unsubscribeUrl,
        mls: !!ex && ex.rows.length > 0,
      })}`;

  const html = shell({ preheader, headerLabel: "GETTING STARTED", body });

  const textRows = ex?.rows.length
    ? "\n\n" +
      `Here's ${ex.areaName}, for example:\n` +
      ex.rows
        .map(
          (r) =>
            `• ${r.boardTitle}: ${r.address}${r.brokerage ? ` — ${r.brokerage}` : ""} — ${r.metricValue} ${r.metricLabel}${r.price != null ? ` · ${money(r.price)}` : ""}\n  ${listingUrl(r.listing_key)}`
        )
        .join("\n")
    : "";
  const text =
    `Follow a neighbourhood. See everything in it.\n\n` +
    `Add an area you care about — a whole city, or a single community like ${exName} — and PureProperty builds you a live dashboard: every home ranked the ways that matter, plus every new listing and recent sale. Updated daily.` +
    textRows +
    `\n\nAdd your first area: ${SITE}/dashboard\n` +
    (opts.unsubscribeUrl ? `\nUnsubscribe: ${opts.unsubscribeUrl}` : "");
  return { subject, html, text };
}

function statTile(label: string, value: string): string {
  return `<td style="padding:0 24px 0 0;">
      <div style="font-family:${MONO};font-size:22px;font-weight:700;color:#0f172a;">${esc(value)}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">${esc(label)}</div>
    </td>`;
}

// ── #3 · "Save the homes you like" (no saved homes yet) ────────────────────────

// A real listing row for #3 — real MLS photo (or clean gray fallback), address,
// brokerage (TRREB §6.3(c)), price, and a "save" link back to the listing page.
function saveHomeRowHtml(r: SaveHomeListing): string {
  return `
      <tr>
        ${thumbCell(r.listing_key, r.thumb)}
        <td valign="top" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <a href="${listingUrl(r.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;">${esc(r.address)}</a>
          <div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(r.city || "")}</div>
          ${brokerageLine(r.brokerage)}
          <div style="margin-top:6px;font-size:14px;color:#0f172a;">
            ${r.price != null ? `<strong>${money(r.price)}</strong>` : ""}
            <a href="${listingUrl(r.listing_key)}" style="color:#0891b2;text-decoration:none;font-weight:600;font-size:12px;margin-left:8px;">&#9829; save</a>
          </div>
        </td>
      </tr>`;
}

export function renderSaveHomeEmail(
  opts: { homes?: SaveHomeListing[]; areaName?: string } & FooterOpts
): Rendered {
  const subject = "Save the homes you like — we'll watch the price for you";
  const preheader = "We'll tell you the second the price drops or it sells.";
  const homes = opts.homes ?? [];
  const areaBit = opts.areaName ? ` in ${esc(opts.areaName)}` : "";

  // Two ways to save — affordances only (no empty thumbnail; the real homes below carry
  // the photos). Heart on a card, or the Add-to-Watchlist button on the listing page.
  const saveWaysCard = uiCard(
    `<table role="presentation" width="100%" style="border-collapse:collapse;"><tr>
        <td valign="top" width="52%" style="padding-right:14px;">
          ${mono10("On a listing card")}
          <div style="margin-top:10px;"><span style="display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:999px;padding:6px 12px;color:#f0466a;font-size:14px;font-weight:600;">&#9829;&nbsp; <span style="color:#e7eef5;">Tap to save</span></span></div>
        </td>
        <td valign="top" style="padding-left:14px;">
          ${mono10("Or on its page")}
          <div style="margin-top:10px;"><span style="display:inline-block;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e7eef5;font-size:12px;font-weight:600;">&#128278;&nbsp; Add to Watchlist</span></div>
        </td>
      </tr></table>` +
      uiCap(`Tap the <span style="color:#f0466a;">&#9829;</span> heart on any home — or <b style="color:#cbd5e1;">Add to Watchlist</b> on its page.`)
  );

  // Real homes to save (real MLS photos in prod). Only render when we have some.
  const homesSection = homes.length
    ? `<h2 style="font-size:13px;color:#334155;text-transform:uppercase;letter-spacing:.08em;margin:26px 0 4px;">Homes${areaBit} worth a look</h2>
       <table style="width:100%;border-collapse:collapse;">${homes.map(saveHomeRowHtml).join("")}</table>`
    : "";

  // Price-move mechanic as TEXT — the numbers are illustrative, so no fabricated
  // listing/photo sits behind them; the strike-through shows exactly what an alert says.
  const priceMech = `
      <p ${P} style="margin-top:18px;">And the moment a price moves, you'll get an email — for example:</p>
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#f8fafc;">
        <span style="font-family:${MONO};font-size:10px;letter-spacing:.08em;color:#64748b;text-transform:uppercase;">Example alert</span>
        <div style="margin-top:6px;font-size:15px;">
          <span style="color:#94a3b8;text-decoration:line-through;">${money(1299000)}</span>
          &nbsp;&rarr;&nbsp;<span style="color:#0f766e;font-weight:700;">${money(1259000)}</span>
          <span style="color:#dc2626;font-weight:600;">&nbsp;(&minus;${money(40000)})</span>
        </div>
      </div>`;

  const body = `
      <h1 ${H1}>Save the homes you like</h1>
      <p ${P}>When you find a home worth watching, tap the heart to save it. We'll email you if the price drops, if it sells, or if it comes back on the market.</p>
      ${saveWaysCard}
      ${homesSection}
      ${priceMech}
      <div style="margin:18px 0 0;">${button("Find homes to save &rarr;", `${SITE}/properties`)}</div>
      <p ${FINE}>Everything you save lives in one place, with the numbers behind each one.</p>
      ${footer({
        intro: "You created a PureProperty.ca account.",
        manageUrl: opts.manageUrl,
        unsubscribeUrl: opts.unsubscribeUrl,
        // Real listings shown → keep the MLS notice; none → drop it.
        mls: homes.length > 0,
      })}`;

  const html = shell({ preheader, headerLabel: "GETTING STARTED", body });

  const textHomes = homes.length
    ? "\n\n" +
      `Homes${opts.areaName ? ` in ${opts.areaName}` : ""} worth a look:\n` +
      homes
        .map(
          (r) =>
            `• ${r.address}${r.brokerage ? ` — ${r.brokerage}` : ""}${r.price != null ? ` — ${money(r.price)}` : ""}\n  ${listingUrl(r.listing_key)}`
        )
        .join("\n")
    : "";
  const text =
    `Save the homes you like\n\n` +
    `When you find a home worth watching, tap the heart to save it (or "Add to Watchlist" on its page). We'll email you if the price drops, if it sells, or if it comes back on the market.` +
    textHomes +
    `\n\nAnd the moment a price moves, you'll get an email — for example: ${money(1299000)} -> ${money(1259000)} (-${money(40000)}).\n\n` +
    `Find homes to save: ${SITE}/properties\n` +
    (opts.unsubscribeUrl ? `\nUnsubscribe: ${opts.unsubscribeUrl}` : "");
  return { subject, html, text };
}

// ── Finish-account nudge — shared by the "didn't unlock" (1.3) and
//    "abandoned signup" (5.1) cases; only the CTA target differs ────────────────

export function renderFinishAccountEmail(opts: { ctaUrl: string } & FooterOpts): Rendered {
  const subject = "You're almost in — one step left";
  const preheader = "Finish setting up your PureProperty account.";

  const body = `
      <h1 ${H1}>You're almost in</h1>
      <p ${P}>You started setting up your PureProperty account but didn't finish. It takes about a minute — enter your email, grab the code we send you, and you're in.</p>
      <p ${P}>Once you're in, you'll see what most buyers never do: what a home is really worth, how long it's actually been for sale, and what it would cost to own.</p>
      <div style="margin:18px 0 0;">${button("Finish setting up my account &rarr;", opts.ctaUrl)}</div>
      <p ${FINE}>If you didn't try to sign up, just ignore this.</p>
      ${footer({
        intro: "You started a PureProperty.ca account.",
        unsubscribeUrl: opts.unsubscribeUrl,
        mls: false,
      })}`;

  const html = shell({ preheader, headerLabel: "ALMOST THERE", body });
  const text =
    `You're almost in\n\n` +
    `You started setting up your PureProperty account but didn't finish. It takes about a minute — enter your email, grab the code we send you, and you're in.\n\n` +
    `Once you're in, you'll see what most buyers never do: what a home is really worth, how long it's actually been for sale, and what it would cost to own.\n\n` +
    `Finish setting up my account: ${opts.ctaUrl}\n` +
    (opts.unsubscribeUrl ? `\nStop these: ${opts.unsubscribeUrl}` : "") +
    `\n\nIf you didn't try to sign up, just ignore this.`;
  return { subject, html, text };
}
