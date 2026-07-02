/**
 * Welcome email — sent once, on first authenticated load (see /api/welcome).
 *
 * Pure renderer: {subject, html, text} from a WelcomeInput (§4 — deterministic,
 * no LLM). Personalized when `intent` (the area they were viewing pre-signup) is
 * present, generic otherwise. Its job is ACTIVATION: get the user to save an area
 * or add a watchlist listing, which is what switches on the daily alerts digest.
 *
 * Compliance:
 *  - No VOW data in email. We show a count of ACTIVE (for-sale) listings only —
 *    never a sold price (those stay behind the authenticated session).
 *  - CASL: sender is identified and every send carries a working unsubscribe link.
 */

export interface WelcomeIntent {
  label: string; // "Madawaska Valley"
  slug: string; // "madawaska-valley"
  prov?: string; // "on"
}

export interface WelcomeInput {
  name?: string | null;
  intent?: WelcomeIntent | null;
  /** Active for-sale listings in the intent area (best-effort; null = unknown). */
  listingCount?: number | null;
  siteUrl: string;
  /** Primary CTA target (already absolute). */
  ctaUrl: string;
  unsubscribeUrl: string;
}

function firstName(name?: string | null): string {
  const n = (name || "").trim().split(/\s+/)[0];
  return n || "there";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderWelcomeEmail(input: WelcomeInput): { subject: string; html: string; text: string } {
  const { name, intent, listingCount, siteUrl, ctaUrl, unsubscribeUrl } = input;
  const fn = firstName(name);
  const hasIntent = !!intent?.label;
  const hasCount = typeof listingCount === "number" && listingCount > 0;

  const subject = hasIntent
    ? `${intent!.label}: welcome to PureProperty`
    : "Welcome to PureProperty";

  const ctaLabel = hasIntent
    ? hasCount
      ? `See ${listingCount!.toLocaleString("en-CA")} homes in ${intent!.label} →`
      : `See homes in ${intent!.label} →`
    : "Find your area →";

  const lead = hasIntent
    ? hasCount
      ? `You were looking at <strong>${esc(intent!.label)}</strong> — there are <strong>${listingCount!.toLocaleString("en-CA")}</strong> homes for sale there right now.`
      : `You were looking at <strong>${esc(intent!.label)}</strong>.`
    : `PureProperty shows every active Ontario MLS® listing — with the cap-rate, school, walkability and development intelligence the consumer portals leave out.`;

  const action = hasIntent
    ? `Save the area (draw it on the map, or add a home to your watchlist) and we'll email you the moment prices drop or new listings appear${intent!.label ? ` in ${esc(intent!.label)}` : ""}.`
    : `Search an area, then save it or add homes to your watchlist — we'll alert you on price drops and new listings, automatically.`;

  const textLead = hasIntent
    ? hasCount
      ? `You were looking at ${intent!.label} — ${listingCount!.toLocaleString("en-CA")} homes for sale there right now.`
      : `You were looking at ${intent!.label}.`
    : `PureProperty shows every active Ontario MLS listing, with cap-rate, school, walkability and development intelligence the portals leave out.`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;margin-bottom:24px;">PURE<span style="color:#38bdf8;">PROPERTY</span></div>
    <h1 style="font-size:22px;line-height:1.3;color:#ffffff;margin:0 0 12px;">Welcome, ${esc(fn)} 👋</h1>
    <p style="font-size:15px;line-height:1.6;color:#cbd5e1;margin:0 0 16px;">${lead}</p>
    <p style="font-size:15px;line-height:1.6;color:#cbd5e1;margin:0 0 24px;">${action}</p>
    <a href="${esc(ctaUrl)}" style="display:inline-block;background:#10b981;color:#04120c;font-weight:700;text-decoration:none;font-size:15px;padding:12px 24px;border-radius:8px;">${esc(ctaLabel)}</a>
    <p style="font-size:13px;line-height:1.6;color:#94a3b8;margin:28px 0 0;">Once you save an area or a listing, you'll get a single daily digest — price drops, status changes, and new homes that match. No noise.</p>
    <hr style="border:none;border-top:1px solid #1e293b;margin:28px 0 16px;" />
    <p style="font-size:11px;line-height:1.6;color:#64748b;margin:0;">
      PureProperty · Ontario, Canada. You're receiving this because you created a PureProperty account.<br/>
      <a href="${esc(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a> from PureProperty emails at any time.
    </p>
  </div></body></html>`;

  const text = [
    `Welcome, ${fn}!`,
    ``,
    textLead,
    ``,
    hasIntent
      ? `Save the area (draw it on the map, or add a home to your watchlist) and we'll email you when prices drop or new listings appear.`
      : `Search an area, then save it or add homes to your watchlist — we'll alert you on price drops and new listings.`,
    ``,
    `${ctaLabel.replace(/ →$/, "")}: ${ctaUrl}`,
    ``,
    `Once you save an area or a listing, you'll get a single daily digest — price drops, status changes, and new matches.`,
    ``,
    `— PureProperty · Ontario, Canada`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
