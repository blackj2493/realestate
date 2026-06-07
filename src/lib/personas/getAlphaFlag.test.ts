import { describe, it, expect } from "vitest";
import { getAlphaFlag } from "./getAlphaFlag";
import type { ListingDocument } from "@/lib/typesense/client";

const doc = (o: Partial<ListingDocument>): ListingDocument => o as ListingDocument;

describe("getAlphaFlag VOW anon-gating (§6.2(f))", () => {
  it("shows DISTRESSED to authed users", () => {
    expect(getAlphaFlag(doc({ isDistressed: true }), true).variant).toBe("distressed");
  });

  it("hides DISTRESSED from anon (no other signal → none)", () => {
    expect(getAlphaFlag(doc({ isDistressed: true }), false).variant).toBe("none");
  });

  it("gates relist/True-DOM-derived STALE and NEW from anon", () => {
    expect(getAlphaFlag(doc({ IsStale: true }), false).variant).toBe("none");
    expect(getAlphaFlag(doc({ TrueDom: 3 }), false).variant).toBe("none");
    // ...but shows them to authed users
    expect(getAlphaFlag(doc({ IsStale: true }), true).variant).toBe("stale");
    expect(getAlphaFlag(doc({ TrueDom: 3 }), true).variant).toBe("new");
  });

  it("keeps IDX-public flags (zoning / suite / density) for anon", () => {
    expect(getAlphaFlag(doc({ zoning_designation: "CMU" }), false).variant).toBe("zoning");
    expect(getAlphaFlag(doc({ SuiteStatus: "POTENTIAL_CANDIDATE" }), false).variant).toBe("suite");
    expect(getAlphaFlag(doc({ is_density_ready: true }), false).variant).toBe("density");
  });

  it("falls through gated → next public flag for anon (distressed+zoning → zoning)", () => {
    const d = doc({ isDistressed: true, zoning_designation: "CMU" });
    expect(getAlphaFlag(d, true).variant).toBe("distressed");
    expect(getAlphaFlag(d, false).variant).toBe("zoning");
  });

  it("defaults to authed behavior when isAuthed is omitted (back-compat)", () => {
    expect(getAlphaFlag(doc({ isDistressed: true })).variant).toBe("distressed");
  });
});
