/**
 * VOW-only ACTIVE listings at a given address.
 *
 * These are the ~16.4k homes the VOW datafeed carries that IDX does not. They are
 * invisible everywhere else on the site, which is why 86-2945 Thomas Street could be
 * listed at $599,000 and our address page still said nothing was for sale.
 *
 * SERVER-ONLY. Never import from a client bundle.
 *
 * THE GATE IS THE POINT — three layers, in order of how hard they are to defeat:
 *
 *   1. The table is RLS-on-with-no-policies. The browser's key cannot read it at all;
 *      only the service role can. A routing mistake cannot leak a row.
 *   2. This module returns TWO DIFFERENT SHAPES. The anonymous shape has no price, no
 *      beds/baths, no brokerage and no photo URL — those fields do not exist on the
 *      type, so a component cannot render what it was never handed. The gated fields
 *      are not fetched-then-hidden; they are never selected.
 *   3. Nothing resolves at all unless VOW_ACTIVES_ENABLED is "true".
 *
 * Per the PROPTX VOW Datafeed Agreement a VOW is a "secure password-protected internet
 * website" and Listing Information may be displayed "solely for the purpose of use by
 * Consumers". The licence attaches to the FEED, not the listing's status: an Active
 * listing delivered over VOW is VOW Listing Information exactly as a sold one is.
 */
import { getServiceRoleClient } from "@/lib/supabase/client";
import { parseAddress, unitsMatch, normalizeUnit, type ParsedAddress } from "@/lib/watchlist/disposition";

/** What an ANONYMOUS visitor may know: that a listing exists, and what kind. */
export interface VowActiveTeaser {
  locked: true;
  /** "For Sale" / "For Lease" — the public transaction kind, no price. */
  kind: string;
  /** "Condo Townhouse", "Detached" — public property classification. */
  propertySubType: string | null;
  /** Existence bit only. The real media URL never reaches this path. */
  hasPhoto: boolean;
  /**
   * Opaque key for /api/vow-active/{hash}/photo-blur — the property hash, never the MLS
   * number. A VOW-only listing's key is itself VOW Listing Information, so it must not
   * appear in markup an anonymous visitor receives.
   */
  blurHash: string | null;
}

/** What a signed-in CONSUMER may know: everything. */
export interface VowActiveFull {
  locked: false;
  listingKey: string;
  kind: string;
  propertySubType: string | null;
  address: string | null;
  unit: string | null;
  listPrice: number | null;
  mlsStatus: string | null;
  brokerage: string | null;
  photos: string[];
  listedOn: string | null;
}

export type VowActive = VowActiveTeaser | VowActiveFull;

function enabled(): boolean {
  return String(process.env.VOW_ACTIVES_ENABLED ?? "").toLowerCase() === "true";
}

/** Columns safe to select for the anonymous path — no price, no media, no brokerage. */
const PUBLIC_COLS = "property_hash, transaction_type, property_sub_type, media_urls, unparsed_address, unit_number, city, postal_code";
const FULL_COLS = `${PUBLIC_COLS}, listing_key, list_price, mls_status, full_payload, original_entry_timestamp`;

/**
 * Find a VOW-only active listing at this address.
 *
 * Matching is unit-aware and reuses the same rules as the rest of the address stack:
 * a condo block shares one civic number and one postal code, so without the unit leg
 * this would happily return unit 62's listing for unit 86 — the exact defect that
 * started this work.
 */
export async function getVowActiveByAddress(
  address: string,
  city: string,
  postal: string | null,
  unit: string | null,
  isConsumer: boolean
): Promise<VowActive | null> {
  if (!enabled()) return null;

  const parsed = parseAddress(`${address}, ${city}${postal ? ` ${postal}` : ""}`);
  const subject: ParsedAddress = { ...parsed, unit: normalizeUnit(unit) || parsed.unit };
  if (!subject.streetNumber || !subject.streetName) return null;

  const token = subject.streetName.split(/\s+/).sort((a, b) => b.length - a.length)[0];
  if (!token || token.length < 3) return null;

  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb
      .from("vow_active_listings")
      // Anonymous callers never even SELECT the gated columns.
      .select(isConsumer ? FULL_COLS : PUBLIC_COLS)
      .ilike("unparsed_address", `${subject.streetNumber}%${token.replace(/[%_,()]/g, "")}%`)
      .limit(25);
    if (error || !data?.length) return null;

    // The select list is chosen at runtime (anon vs consumer), which defeats supabase-js's
    // type-level column parser — hence the widening cast rather than a generated row type.
    const hit = (data as unknown as Array<Record<string, unknown>>).find((r) => {
      const cand = parseAddress(String(r.unparsed_address ?? ""));
      // The feed's structured UnitNumber beats anything parsed out of the display
      // string — use it when present.
      const candUnit = normalizeUnit(String(r.unit_number ?? "")) || cand.unit;
      if (cand.streetNumber !== subject.streetNumber) return false;
      if (!unitsMatch(subject, { ...cand, unit: candUnit })) return false;
      if (subject.postal && cand.postal) return subject.postal === cand.postal;
      return true;
    });
    if (!hit) return null;

    const media = Array.isArray(hit.media_urls) ? (hit.media_urls as string[]) : [];
    const kind = String(hit.transaction_type ?? "").trim() || "Listed";
    const subType = (hit.property_sub_type as string | null) ?? null;

    if (!isConsumer) {
      // Existence bit only — the real media URL is deliberately discarded here,
      // mirroring getSoldPublicByKey's hasPhoto treatment. What the browser gets is a
      // link to our own blur route, which returns a 24px colour field.
      const hash = String(hit.property_hash ?? "");
      return {
        locked: true,
        kind,
        propertySubType: subType,
        hasPhoto: media.length > 0,
        blurHash: /^[0-9a-f]{64}$/.test(hash) ? hash : null,
      };
    }

    const payload = (hit.full_payload ?? {}) as Record<string, unknown>;
    return {
      locked: false,
      listingKey: String(hit.listing_key),
      kind,
      propertySubType: subType,
      address: (hit.unparsed_address as string | null) ?? null,
      unit: (hit.unit_number as string | null) ?? null,
      listPrice: hit.list_price != null ? Number(hit.list_price) : null,
      mlsStatus: (hit.mls_status as string | null) ?? null,
      // TRREB §6.3(c): the brokerage rides on every listing display.
      brokerage: (payload.ListOfficeName as string | null) ?? null,
      photos: media,
      listedOn: (hit.original_entry_timestamp as string | null) ?? null,
    };
  } catch (err) {
    console.error("[vow/activeByAddress] lookup failed:", err);
    return null;
  }
}
