import { describe, it, expect } from "vitest";
import { classifyMlsStatus, isConditionalClass, titleCaseStatus } from "./mlsStatus";
import { statusBadge } from "./statusBadge";
import { resolveListingStatus } from "@/lib/property/listingStatus";
import { NON_ACTIVE_STATUSES } from "../../../scripts/worker/staleSearchDocs";

describe("classifyMlsStatus", () => {
  it("treats the four plain-active statuses (and blank) as ordinary inventory", () => {
    for (const s of ["New", "Active", "Price Change", "Extension", "", "  active  "]) {
      expect(classifyMlsStatus(s)).toBe("plain-active");
    }
    expect(classifyMlsStatus(null)).toBe("plain-active");
    expect(classifyMlsStatus(undefined)).toBe("plain-active");
  });

  it("matches conditionals by PREFIX so escape-clause variants cannot regress to 'other'", () => {
    for (const s of [
      "Sold Conditional",
      "Sold Conditional Escape Clause",
      "Sold Conditional Escape",
      "sold conditional",
    ]) {
      expect(classifyMlsStatus(s)).toBe("sale-conditional");
    }
    for (const s of ["Leased Conditional", "Leased Conditional Escape Clause"]) {
      expect(classifyMlsStatus(s)).toBe("lease-conditional");
    }
  });

  it("does NOT collapse a conditional into a firm close — the deal is not firm", () => {
    expect(classifyMlsStatus("Sold Conditional")).not.toBe("sold");
    expect(classifyMlsStatus("Leased Conditional")).not.toBe("leased");
    expect(classifyMlsStatus("Sold")).toBe("sold");
    expect(classifyMlsStatus("Leased")).toBe("leased");
  });

  it("classifies terminal statuses and back-on-market", () => {
    for (const s of ["Terminated", "Expired", "Suspended"]) {
      expect(classifyMlsStatus(s)).toBe("terminal");
    }
    expect(classifyMlsStatus("Deal Fell Through")).toBe("back-on-market");
  });

  it("never assumes an unrecognised status is active", () => {
    expect(classifyMlsStatus("Some New Board Status")).toBe("other");
  });

  it("isConditionalClass covers both transaction types and nothing else", () => {
    expect(isConditionalClass("sale-conditional")).toBe(true);
    expect(isConditionalClass("lease-conditional")).toBe(true);
    for (const c of ["plain-active", "sold", "leased", "terminal", "back-on-market", "other"] as const) {
      expect(isConditionalClass(c)).toBe(false);
    }
  });

  it("titleCaseStatus normalises board casing", () => {
    expect(titleCaseStatus("SOLD CONDITIONAL")).toBe("Sold Conditional");
    expect(titleCaseStatus("terminated")).toBe("Terminated");
  });
});

/**
 * The regression this whole module exists for: the browse card and the listing detail
 * page classified statuses independently, so the SAME listing read "Sold Cond." in
 * search and rendered a plain For Sale page one click later (N13642346).
 */
describe("card badge and detail page agree on every status", () => {
  const CONDITIONALS = [
    "Sold Conditional",
    "Sold Conditional Escape Clause",
    "Leased Conditional",
  ];

  it.each(CONDITIONALS)("%s: card badges it AND the page resolves it as conditional", (s) => {
    expect(statusBadge(s)).not.toBeNull();
    expect(resolveListingStatus({ StandardStatus: "Active", MlsStatus: s }, null).kind).toBe(
      "conditional"
    );
  });

  it.each(["New", "Active", "Price Change", "Extension"])(
    "%s: no card badge AND the page resolves it as plain active",
    (s) => {
      expect(statusBadge(s)).toBeNull();
      expect(resolveListingStatus({ StandardStatus: "Active", MlsStatus: s }, null)).toEqual({
        kind: "active",
      });
    }
  );

  it("no status classified plain-active is one the ingest contract would purge", () => {
    // staleSearchDocs owns what LEAVES the index. If a status the card renders as
    // ordinary inventory were also purge-worthy, the page would outlive its own doc.
    for (const s of ["New", "Active", "Price Change", "Extension"]) {
      expect(NON_ACTIVE_STATUSES.has(s.toLowerCase())).toBe(false);
    }
    // Conditionals stay indexed by product policy — the badge is how we tell the truth.
    for (const s of CONDITIONALS) {
      expect(NON_ACTIVE_STATUSES.has(s.toLowerCase())).toBe(false);
    }
  });
});
