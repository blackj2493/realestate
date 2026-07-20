import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { SENDERS } from "@/lib/alerts/senders";
import {
  evaluateSearchHealth,
  REPORTABLE_KINDS,
  ALERT_COOLDOWN_MS,
  BURST_WINDOW_MS,
  GRIND_WINDOW_MS,
  type ReportableKind,
} from "@/lib/telemetry/searchHealthPolicy";

export const dynamic = "force-dynamic";

/**
 * POST /api/telemetry/search-timeout — anonymous beacon for browser-side Typesense
 * search failures (the terminal talks to Typesense Cloud directly, so these never
 * appear in server logs; see 2026-07-20 "timeout of 15000ms exceeded" incident).
 *
 * Writes one search_health_events row (migration 091), prunes 30-day-old rows, then
 * evaluates the alert policy (searchHealthPolicy.ts): sustained/widespread failures
 * email the owner ONCE per cooldown window; a kind='alert_sent' marker row records
 * the send. Every failure path returns 2xx quietly — telemetry must never generate
 * user-visible errors, and a pre-091 deploy simply no-ops.
 */

const limiter = makeRateLimiter({ windowMs: 60_000, max: 6 });
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const OPS_EMAIL = process.env.OPS_ALERT_EMAIL || "blackj8591@gmail.com";

const ok = () => NextResponse.json({ ok: true });

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) return ok(); // silently drop — a beacon never needs a 429 story

    const body = (await req.json().catch(() => null)) as {
      kind?: unknown;
      durationMs?: unknown;
      sessionId?: unknown;
      context?: unknown;
    } | null;
    if (!body) return ok();

    const kind = body.kind as ReportableKind;
    if (!REPORTABLE_KINDS.includes(kind)) return ok();
    const durationMs = Number(body.durationMs);
    const duration =
      Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 600_000 ? Math.round(durationMs) : null;
    const sessionId = str(body.sessionId, 64);
    const ctxIn = (body.context ?? {}) as Record<string, unknown>;
    const context = {
      path: str(ctxIn.path, 200),
      message: str(ctxIn.message, 300),
      fn: str(ctxIn.fn, 50),
    };

    const supabase = getServiceRoleClient();
    const { error: insErr } = await supabase.from("search_health_events").insert({
      kind,
      duration_ms: duration,
      session_id: sessionId,
      context,
    });
    if (insErr) return ok(); // pre-091 (table missing) or transient — never surface

    const nowMs = Date.now();

    // Opportunistic retention prune — indexed delete, cheap when nothing matches.
    await supabase
      .from("search_health_events")
      .delete()
      .lt("occurred_at", new Date(nowMs - RETENTION_MS).toISOString());

    // ── Alert evaluation ─────────────────────────────────────────────────────
    const hourIso = new Date(nowMs - BURST_WINDOW_MS).toISOString();
    const dayIso = new Date(nowMs - GRIND_WINDOW_MS).toISOString();

    const [{ data: hourRows }, { count: dayCount }, { data: lastAlert }] = await Promise.all([
      supabase
        .from("search_health_events")
        .select("session_id")
        .neq("kind", "alert_sent")
        .gte("occurred_at", hourIso)
        .limit(1000),
      supabase
        .from("search_health_events")
        .select("id", { count: "exact", head: true })
        .neq("kind", "alert_sent")
        .gte("occurred_at", dayIso),
      supabase
        .from("search_health_events")
        .select("occurred_at")
        .eq("kind", "alert_sent")
        .order("occurred_at", { ascending: false })
        .limit(1),
    ]);

    const hourCount = hourRows?.length ?? 0;
    const hourSessions = new Set((hourRows ?? []).map((r) => r.session_id ?? "unknown")).size;
    const lastAlertAtMs = lastAlert?.[0]?.occurred_at ? Date.parse(lastAlert[0].occurred_at) : null;

    const decision = evaluateSearchHealth({
      hourCount,
      hourSessions,
      dayCount: dayCount ?? 0,
      lastAlertAtMs,
      nowMs,
    });
    if (!decision.alert || !process.env.RESEND_API_KEY) return ok();

    // Mark BEFORE sending: a concurrent beacon must not double-email, and a failed
    // send costing one cooldown window is the cheaper mistake.
    const { error: markErr } = await supabase.from("search_health_events").insert({
      kind: "alert_sent",
      context: { reason: decision.reason, hourCount, hourSessions, dayCount: dayCount ?? 0 },
    });
    if (markErr) return ok();

    const subject = `[ops] Terminal search failures — ${
      decision.reason === "burst"
        ? `${hourCount} in the last hour across ${hourSessions} sessions`
        : `${dayCount} in the last 24h`
    }`;
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
    const text = [
      `Browser-side Typesense search failures crossed the "${decision.reason}" threshold.`,
      ``,
      `Last hour:  ${hourCount} failures across ${hourSessions} distinct sessions`,
      `Last 24h:   ${dayCount ?? 0} failures`,
      ``,
      `This is the map-terminal "Search Error / timeout exceeded" mode — the cluster itself`,
      `is usually healthy while connections to it hang (see 2026-07-20 diagnosis).`,
      ``,
      `Check, in order:`,
      `1. ${site}/properties — does the terminal load for you right now?`,
      `2. Typesense Cloud status: https://cloud-status.typesense.org/`,
      `3. Cluster dashboard (memory/CPU/latency): https://cloud.typesense.org/clusters`,
      `4. If this keeps recurring, consider enabling High Availability on the cluster —`,
      `   the current single hardcoded node is a single point of failure.`,
      ``,
      `Raw log: search_health_events table (Supabase). Next alert suppressed for ${Math.round(
        ALERT_COOLDOWN_MS / 3_600_000
      )}h.`,
    ].join("\n");

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: SENDERS.alerts.from,
      to: OPS_EMAIL,
      subject,
      text,
    });

    return ok();
  } catch (e) {
    console.error("[telemetry/search-timeout]", e instanceof Error ? e.message : e);
    return ok();
  }
}
