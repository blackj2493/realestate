/**
 * /api/email/brief?e=<email>&a=<action>[&b=<bubbleId>]&s=<hmac>
 *
 * The nightly brief's in-email controls that change WHAT it sends, not how often:
 *  - `filter:<preset>` sets one dashboard filter and switches one area to "my filters
 *    only" (see briefAction.ts for why a filter, and why these are separate links);
 *  - `persona:<persona>` reorders the angle picks for an investor or a builder.
 *
 * GET verifies and renders a confirm button. POST verifies again and applies. Nothing is
 * written on GET because mail scanners open every link in a message — see briefAction.ts.
 *
 * WHY A FILTER WRITES THE DASHBOARD LENS. A city area's "my filters only" alert IS the
 * dashboard lens: reconcileCityAlerts re-snaps every filtered city row to it on each
 * dashboard save. Writing the area alone would hold until the reader's next dashboard
 * visit and then silently revert. So the tap writes the lens, then re-snaps the same rows
 * reconcile would, and the confirm page says that the dashboard changes too.
 *
 * WHAT IT NEVER DOES. It never creates a dashboard_prefs row. A row with no regions would
 * load as an empty dashboard ("server wins on load"), which is a far worse outcome than a
 * link that asks the reader to open the dashboard once.
 */
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  FILTER_PRESETS,
  applyPreset,
  parseBriefAction,
  verifyBriefAction,
  type BriefAction,
  type ParsedBriefAction,
} from "@/lib/alerts/briefAction";
import { PERSONA_PICK_LABEL } from "@/lib/alerts/digest";
import { DEFAULT_ACTIVITY_LENS, normalizeConfig, type MarketActivityLens } from "@/lib/dashboard/config";
import { SITE, esc } from "@/lib/alerts/emailShell";

export const dynamic = "force-dynamic";

type Sb = ReturnType<typeof getServiceRoleClient>;

interface Params {
  email: string;
  action: string;
  bubbleId: string;
  sig: string;
}

function readParams(get: (k: string) => string | null): Params {
  return {
    email: get("e") || "",
    action: get("a") || "",
    bubbleId: get("b") || "",
    sig: get("s") || "",
  };
}

async function userIdFor(sb: Sb, email: string): Promise<string | null> {
  const { data, error } = await sb.from("profiles").select("id").ilike("email", email.trim().toLowerCase()).maybeSingle();
  if (error) {
    console.error("[email/brief] profile lookup failed:", error.message);
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

interface AreaRow {
  id: string;
  user_id: string;
  name: string;
  area_type: string;
  filters: unknown;
}

/** The area, only if it is a city area owned by this account. */
async function ownedCityArea(sb: Sb, userId: string, bubbleId: string): Promise<AreaRow | null> {
  const { data, error } = await sb
    .from("market_bubbles")
    .select("id, user_id, name, area_type, filters")
    .eq("id", bubbleId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as AreaRow;
  return row.user_id === userId && row.area_type === "city" ? row : null;
}

function lensOf(filters: unknown): MarketActivityLens | null {
  if (!filters || typeof filters !== "object" || !("lens" in filters)) return null;
  const raw = (filters as { lens?: unknown }).lens;
  return raw && typeof raw === "object" ? normalizeConfig({ marketActivity: raw }).marketActivity : null;
}

type Outcome = { ok: true; message: string } | { ok: false; message: string };

const FAIL = "This link couldn't be verified. Please use a link from a recent email, or change this from your dashboard.";
const NEEDS_DASHBOARD =
  "Open your dashboard once to finish setting up, then this link will work. Nothing was changed.";

async function applyFilter(sb: Sb, userId: string, area: AreaRow, preset: ParsedBriefAction & { kind: "filter" }): Promise<Outcome> {
  const { data: prefs, error: prefsErr } = await sb
    .from("dashboard_prefs")
    .select("config")
    .eq("user_id", userId)
    .maybeSingle();
  if (prefsErr) return { ok: false, message: FAIL };
  const rawConfig = (prefs as { config?: unknown } | null)?.config;

  let lens: MarketActivityLens;
  if (rawConfig && typeof rawConfig === "object") {
    lens = applyPreset(normalizeConfig(rawConfig).marketActivity, preset.preset);
    // Merge into the stored blob rather than writing normalizeConfig's output, so any
    // field this route does not know about survives untouched.
    const next = { ...(rawConfig as Record<string, unknown>), marketActivity: lens };
    const upd = await sb
      .from("dashboard_prefs")
      .update({ config: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (upd.error) return { ok: false, message: FAIL };

    // Re-snap the other filtered city rows, exactly as reconcileCityAlerts would on the
    // next dashboard save — only rows holding a lens; a snapshot-shaped row is left alone.
    const { data: rows } = await sb
      .from("market_bubbles")
      .select("id, area_type, alert_scope, filters")
      .eq("user_id", userId)
      .eq("area_type", "city")
      .eq("alert_scope", "filtered");
    for (const r of (rows ?? []) as Array<{ id: string; filters: unknown }>) {
      if (r.id === area.id || !lensOf(r.filters)) continue;
      await sb.from("market_bubbles").update({ filters: { lens } }).eq("id", r.id);
    }
  } else {
    // No dashboard row to hold a lens. Filter this one area on its own lens; there is no
    // reconcile to revert it, because reconcile runs from the dashboard save path.
    lens = applyPreset(lensOf(area.filters) ?? DEFAULT_ACTIVITY_LENS, preset.preset);
  }

  const upd = await sb
    .from("market_bubbles")
    .update({ alert_scope: "filtered", filters: { lens } })
    .eq("id", area.id)
    .eq("user_id", userId);
  if (upd.error) return { ok: false, message: FAIL };
  return {
    ok: true,
    message: `Done. From tomorrow, ${esc(area.name)} sends ${FILTER_PRESETS[preset.preset].confirm}. Your dashboard shows the same filter.`,
  };
}

async function applyPersona(sb: Sb, userId: string, persona: ParsedBriefAction & { kind: "persona" }): Promise<Outcome> {
  const { data: prefs, error } = await sb.from("dashboard_prefs").select("config").eq("user_id", userId).maybeSingle();
  if (error) return { ok: false, message: FAIL };
  const rawConfig = (prefs as { config?: unknown } | null)?.config;
  if (!rawConfig || typeof rawConfig !== "object") return { ok: false, message: NEEDS_DASHBOARD };
  const next = { ...(rawConfig as Record<string, unknown>), persona: persona.persona };
  const upd = await sb
    .from("dashboard_prefs")
    .update({ config: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (upd.error) return { ok: false, message: FAIL };
  return {
    ok: true,
    message: `Done. From tomorrow, your picks are ordered for ${PERSONA_PICK_LABEL[persona.persona].toLowerCase()}. Your dashboard uses the same view.`,
  };
}

async function apply(p: Params): Promise<Outcome> {
  try {
    const sb = getServiceRoleClient();
    const userId = await userIdFor(sb, p.email);
    if (!userId) return { ok: false, message: FAIL };
    const parsed = parseBriefAction(p.action as BriefAction);
    if (parsed.kind === "persona") return applyPersona(sb, userId, parsed);
    const area = await ownedCityArea(sb, userId, p.bubbleId);
    if (!area) return { ok: false, message: FAIL };
    return applyFilter(sb, userId, area, parsed);
  } catch (err) {
    console.error("[email/brief] threw:", err);
    return { ok: false, message: FAIL };
  }
}

/** What the confirm button will do, in one sentence. Reads the area name; writes nothing. */
async function describe(p: Params): Promise<string | null> {
  const parsed = parseBriefAction(p.action as BriefAction);
  if (parsed.kind === "persona")
    return `Order your nightly picks for ${PERSONA_PICK_LABEL[parsed.persona].toLowerCase()}?`;
  let where = "this area";
  try {
    const sb = getServiceRoleClient();
    const userId = await userIdFor(sb, p.email);
    const area = userId ? await ownedCityArea(sb, userId, p.bubbleId) : null;
    if (!area) return null;
    where = esc(area.name);
  } catch {
    return null;
  }
  return `Send ${FILTER_PRESETS[parsed.preset].confirm} in ${where} from tomorrow? This also sets the same filter on your dashboard.`;
}

function shell(inner: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PureProperty</title>
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;color:#0f172a;">
${inner}
<p style="margin-top:20px;"><a href="${SITE}/dashboard" style="color:#0891b2;text-decoration:none;font-weight:600;font-size:14px;">Open your dashboard &rarr;</a></p>
</div>`;
}

function html(body: string, status: number): NextResponse {
  return new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const failPage = (message = FAIL) =>
  html(shell(`<p style="color:#475569;font-size:14px;line-height:1.6;">${message}</p>`), 400);

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const p = readParams((k) => sp.get(k));
  if (!verifyBriefAction(p.email, p.action, p.bubbleId, p.sig)) return failPage();
  const question = await describe(p);
  if (!question) return failPage();
  const hidden = (["e", "a", "b", "s"] as const)
    .map((k, i) => `<input type="hidden" name="${k}" value="${esc([p.email, p.action, p.bubbleId, p.sig][i])}">`)
    .join("");
  return html(
    shell(`<div style="font-size:16px;font-weight:700;line-height:1.5;">${question}</div>
<form method="post" action="/api/email/brief" style="margin-top:18px;">${hidden}
<button type="submit" style="background:#0891b2;color:#fff;border:0;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Yes, do it</button>
</form>`),
    200
  );
}

export async function POST(request: Request) {
  let p: Params;
  try {
    const form = await request.formData();
    p = readParams((k) => {
      const v = form.get(k);
      return typeof v === "string" ? v : null;
    });
  } catch {
    return failPage();
  }
  if (!verifyBriefAction(p.email, p.action, p.bubbleId, p.sig)) return failPage();
  const outcome = await apply(p);
  if (!outcome.ok) return failPage(outcome.message);
  return html(shell(`<div style="font-size:16px;font-weight:700;line-height:1.5;">${outcome.message}</div>`), 200);
}
