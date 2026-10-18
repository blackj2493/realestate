import { describe, it, expect, vi } from "vitest";

// ingester.ts builds Supabase and Typesense clients at import time; CI has neither. Nothing
// here queries — these are pure predicate checks.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      throw new Error("closedStatuses tests must not query");
    },
  }),
}));

import { CLOSED_STATUSES, isSoldListing } from "./ingester";

// reconcile-sold-from-vault.ts pre-filters the vault on `listings.standard_status IN
// CLOSED_STATUSES`. That is only safe while the list is exactly what isSoldListing accepts:
// a status it accepts that the filter lacks would be skipped by the full sweep silently.
describe("CLOSED_STATUSES is isSoldListing's own list", () => {
  it("every listed status is sold, on either field", () => {
    for (const s of CLOSED_STATUSES) {
      expect(isSoldListing({ StandardStatus: s })).toBe(true);
      expect(isSoldListing({ MlsStatus: s })).toBe(true);
    }
  });

  it("every status the feed actually carries and is NOT listed is not sold", () => {
    // The 15 values listings.standard_status held on 2026-10-18.
    const seen = [
      "new", "sold", "leased", "price change", "extension", "sold conditional", "deal fell through",
      "sold conditional escape", "leased conditional", "terminated", "deleted", "expired",
      "leased conditional escape", "active", "suspended",
    ];
    for (const s of seen.filter((x) => !CLOSED_STATUSES.includes(x))) {
      expect(isSoldListing({ StandardStatus: s, MlsStatus: s })).toBe(false);
    }
  });
});
