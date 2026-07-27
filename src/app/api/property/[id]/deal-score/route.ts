/**
 * GET /api/property/[id]/deal-score — slim, deal-score-only slice of getListingDetail.
 *
 * The Command Center Quick Look drawer calls this so its Deal Score + Estimated Sale
 * match the full report EXACTLY (same engine, same AVM-anchored inputs, same gating),
 * without pulling the heavy bundle (media, rooms, sale history) the full /api/property/[id]
 * route returns. Everything else in the drawer stays zero-fetch.
 *
 * It reads through getListingDetailCached — the SAME cached loader the server page and the
 * sibling /api/property/[id] route use. This is load-bearing: the AVM is recomputed against
 * a live comp set, so an UNCACHED read here would drift a few dollars from the page's cached
 * estimate and the drawer would show a different number for the same listing. Sharing the
 * cache entry makes the two surfaces read one identical estimate.
 */

import { NextRequest, NextResponse } from "next/server";
import { gateVowDerived } from "@/lib/property/getListingDetail";
import { getListingDetailCached } from "@/lib/property/getListingDetailCached";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { logVowAccess } from "@/lib/audit/vowAccessLog";
import { resolveSalePrice } from "@/lib/avm/salePrice";
import { buildDatasheet } from "@/lib/property/datasheet";

export const dynamic = "force-dynamic";

/**
 * The four Structural Vitals the Quick Look drawer shows, resolved through the SAME
 * registry the full report's data sheet uses (datasheet.ts "vitals" group) so the drawer
 * renders identical strings ("Radiant · Gas", "Wall Unit(s)"). These are public IDX facts —
 * NOT VOW-derived — so gateVowDerived leaves them intact and they're returned for anon too.
 * A value is null when the feed left the field empty; the drawer then hides that row rather
 * than showing a bare "—" next to populated rows.
 */
function resolveVitals(payload: Record<string, unknown>) {
  const rows = buildDatasheet(payload).find((g) => g.group.id === "vitals")?.rows ?? [];
  const pick = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return {
    lot: pick("LotWidth"), // "40 x 100 Feet"
    propertyAge: pick("ApproximateAge"),
    heating: pick("HeatType"), // "Radiant · Gas"
    cooling: pick("Cooling"), // "Wall Unit(s)"
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const detail = await getListingDetailCached(id);
    if (!detail) {
      return NextResponse.json({ notFound: true }, { status: 404 });
    }

    // VOW gating mirrors /api/property/[id]: a CONSUMER-level gate (signed in AND accepted
    // the VOW Terms), not mere login — parity with the server page so the drawer and the
    // full report gate the SAME way. VOW-derived metrics (AVM, Deal Score) are stripped for
    // non-consumers; the has* flags (from the UNGATED detail) tell the client where real
    // data exists so it can render a locked teaser.
    const { user, isConsumer } = await getConsumer();
    const isAuthed = isConsumer;
    if (isConsumer && user) await logVowAccess(user.id, `listing:${id}`);
    const hasEstimate = (detail.estimate?.estimatedValue ?? 0) > 0;
    const hasExpectedSale = (detail.expectedSale?.expectedPrice ?? 0) > 0;
    const hasDealScore = detail.dealScore.score !== null;
    const view = gateVowDerived(detail, isAuthed);

    const listPriceRaw = (view.full_payload as Record<string, unknown> | null)?.ListPrice;
    const listPrice = typeof listPriceRaw === "number" && listPriceRaw > 0 ? listPriceRaw : null;
    const salePrice = resolveSalePrice({
      listPrice,
      isActive: view.status.kind === "active",
      expectedSale: view.expectedSale,
      estimate: view.estimate,
    });

    return NextResponse.json({
      dealScore: view.dealScore,
      estimate: view.estimate,
      salePrice,
      // Public structural facts absent from the light Typesense index doc (Heating/Cooling),
      // so the drawer can show the real values the full report shows instead of "—".
      vitals: resolveVitals(view.full_payload),
      isAuthed,
      hasDealScore,
      hasEstimate,
      hasExpectedSale,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg.includes("timeout")) {
      return NextResponse.json({ notFound: true }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to fetch deal score", details: msg }, { status: 500 });
  }
}
