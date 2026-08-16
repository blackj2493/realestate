import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * These tests exist to prove the GATE, not the happy path. The failure this guards
 * against is not "no listing renders" — it is "a price renders for someone who is not
 * entitled to it", which is invisible in a screenshot and costs the data feed.
 */

const ROW = {
  property_hash: "a".repeat(64),
  listing_key: "W13584216",
  transaction_type: "For Sale",
  property_sub_type: "Condo Townhouse",
  media_urls: ["https://trreb-image.ampre.ca/abc/wm:.5:so:0:5"],
  unparsed_address: "2945 Thomas Street 86, Mississauga, ON L5M 6C1",
  unit_number: "86",
  city: "Mississauga",
  postal_code: "L5M 6C1",
  list_price: 599000,
  mls_status: "Price Change",
  full_payload: { ListOfficeName: "KW Living Realty" },
  original_entry_timestamp: "2026-07-20T16:08:54Z",
};

/** Records the column list each call asked for, so we can assert on it. */
const selects: string[] = [];

vi.mock("@/lib/supabase/client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        const rows = cols.includes("list_price")
          ? [ROW]
          : [Object.fromEntries(Object.entries(ROW).filter(([k]) => cols.includes(k)))];
        const builder = {
          ilike: () => builder,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return builder;
      },
    }),
  }),
}));

import { getVowActiveByAddress } from "./activeByAddress";

const ADDR = ["2945 Thomas Street", "Mississauga", "L5M6C1"] as const;

beforeEach(() => {
  selects.length = 0;
  process.env.VOW_ACTIVES_ENABLED = "true";
});
afterEach(() => {
  delete process.env.VOW_ACTIVES_ENABLED;
});

describe("getVowActiveByAddress — the flag", () => {
  it("resolves nothing at all when the feature is off", async () => {
    delete process.env.VOW_ACTIVES_ENABLED;
    expect(await getVowActiveByAddress(...ADDR, "86", true)).toBeNull();
    // Not even a query is issued — the flag is checked before any I/O.
    expect(selects).toHaveLength(0);
  });

  it("treats any value other than \"true\" as off", async () => {
    process.env.VOW_ACTIVES_ENABLED = "1";
    expect(await getVowActiveByAddress(...ADDR, "86", true)).toBeNull();
  });
});

describe("getVowActiveByAddress — anonymous visitors", () => {
  it("NEVER SELECTS the gated columns", async () => {
    await getVowActiveByAddress(...ADDR, "86", false);
    const cols = selects.join(" ");
    // The gate is that these are never fetched — not fetched-then-hidden.
    expect(cols).not.toContain("list_price");
    expect(cols).not.toContain("mls_status");
    expect(cols).not.toContain("full_payload");
    expect(cols).not.toContain("listing_key");
  });

  it("returns only the existence bits", async () => {
    const r = await getVowActiveByAddress(...ADDR, "86", false);
    expect(r).not.toBeNull();
    expect(r!.locked).toBe(true);

    const keys = Object.keys(r!);
    expect(keys.sort()).toEqual(["blurHash", "hasPhoto", "kind", "locked", "propertySubType"]);
    // The MLS number and the real photo URL are the two things that must not escape.
    expect(JSON.stringify(r)).not.toContain("W13584216");
    expect(JSON.stringify(r)).not.toContain("trreb-image");
    expect(JSON.stringify(r)).not.toContain("599000");
    expect(JSON.stringify(r)).not.toContain("KW Living Realty");
  });

  it("hands out an opaque blur key, not the listing key", async () => {
    const r = (await getVowActiveByAddress(...ADDR, "86", false)) as { blurHash: string | null };
    expect(r.blurHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getVowActiveByAddress — signed-in consumers", () => {
  it("returns the listing, brokerage included (TRREB §6.3(c))", async () => {
    const r = await getVowActiveByAddress(...ADDR, "86", true);
    expect(r!.locked).toBe(false);
    const full = r as Extract<typeof r, { locked: false }>;
    expect(full.listPrice).toBe(599000);
    expect(full.brokerage).toBe("KW Living Realty");
    expect(full.photos).toHaveLength(1);
  });
});

describe("getVowActiveByAddress — unit identity", () => {
  it("does not hand unit 86's listing to a query for unit 62", async () => {
    // The defect this whole workstream started from, now on the newest surface.
    expect(await getVowActiveByAddress(...ADDR, "62", true)).toBeNull();
  });

  it("does not answer a building-level query with one unit's listing", async () => {
    expect(await getVowActiveByAddress(...ADDR, null, true)).toBeNull();
  });

  it("matches the right unit", async () => {
    expect(await getVowActiveByAddress(...ADDR, "86", true)).not.toBeNull();
  });
});
