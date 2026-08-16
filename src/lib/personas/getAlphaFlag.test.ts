import { describe, it, expect } from "vitest";
import { getAlphaFlag } from "./getAlphaFlag";
import type { ListingDocument } from "@/lib/typesense/client";

const doc = (o: Partial<ListingDocument>): ListingDocument => o as ListingDocument;

/** A listing whose remarks carry a forced-sale phrase. */
const forced = (o: Partial<ListingDocument> = {}) =>
  doc({ PublicRemarks: "Property being sold under power of sale.", ...o });

describe("getAlphaFlag VOW anon-gating (§6.2(f))", () => {
  it("shows the distress flag to authed users", () => {
    expect(getAlphaFlag(forced(), true).variant).toBe("forcedSale");
  });

  it("hides it from anon (no other signal → none)", () => {
    expect(getAlphaFlag(forced(), false).variant).toBe("none");
  });

  it("gates relist/True-DOM-derived STALE and NEW from anon", () => {
    expect(getAlphaFlag(doc({ IsStale: true }), false).variant).toBe("none");
    expect(getAlphaFlag(doc({ TrueDom: 3 }), false).variant).toBe("none");
    // ...but shows them to authed users
    expect(getAlphaFlag(doc({ IsStale: true }), true).variant).toBe("stale");
    expect(getAlphaFlag(doc({ TrueDom: 3 }), true).variant).toBe("new");
  });

  it("keeps IDX-public flags (zoning / suite / surplus-parking) for anon", () => {
    expect(getAlphaFlag(doc({ zoning_designation: "CMU" }), false).variant).toBe("zoning");
    expect(getAlphaFlag(doc({ SuiteStatus: "POTENTIAL_CANDIDATE" }), false).variant).toBe("suite");
    expect(getAlphaFlag(doc({ is_density_ready: true }), false).variant).toBe("lot");
  });

  it("falls through gated → next public flag for anon (forced sale + zoning → zoning)", () => {
    const d = forced({ zoning_designation: "CMU" });
    expect(getAlphaFlag(d, true).variant).toBe("forcedSale");
    expect(getAlphaFlag(d, false).variant).toBe("zoning");
  });

  it("defaults to authed behavior when isAuthed is omitted (back-compat)", () => {
    expect(getAlphaFlag(forced()).variant).toBe("forcedSale");
  });
});

describe("getAlphaFlag distress split", () => {
  it("names the evidence rather than the category", () => {
    expect(getAlphaFlag(forced())).toEqual({ label: "POWER OF SALE", variant: "forcedSale" });
  });

  it("distinguishes a property needing work from a seller under pressure", () => {
    const d = doc({ PublicRemarks: "Ready for a complete gut renovation." });
    expect(getAlphaFlag(d)).toEqual({ label: "GUT RENOVATION", variant: "needsWork" });
  });

  it("leads with the forced sale when a listing carries both", () => {
    const d = doc({ PublicRemarks: "Estate sale. Needs work throughout." });
    expect(getAlphaFlag(d)).toEqual({ label: "ESTATE SALE", variant: "forcedSale" });
  });

  it("does not flag a listing whose only match was the old rule's boilerplate", () => {
    // "real estate" + an as-is appliance disclaimer: the two phrases that produced the
    // 19%-of-market false-positive rate. Neither is a signal now.
    const d = doc({
      PublicRemarks: "Ask your real estate agent for details. Appliances sold as-is, where-is.",
    });
    expect(getAlphaFlag(d).variant).toBe("none");
  });

  it("ignores a stale indexed boolean and reads the remarks (self-healing)", () => {
    // The index can be frozen on an older rule between delta syncs; the badge must not be.
    const d = doc({ isDistressed: true, PublicRemarks: "Beautiful move-in-ready family home." });
    expect(getAlphaFlag(d).variant).toBe("none");
  });

  it("lets a stale listing read as STALE now that distress no longer outranks it", () => {
    // Pre-fix, any listing over 90 days was DISTRESSED, which suppressed STALE on 12,291
    // listings. Time on market is no longer distress.
    const d = doc({ IsStale: true, TrueDom: 299, PublicRemarks: "Lovely bungalow on a quiet street." });
    expect(getAlphaFlag(d).variant).toBe("stale");
  });

  it("handles a listing with no remarks at all", () => {
    expect(getAlphaFlag(doc({})).variant).toBe("none");
  });
});
