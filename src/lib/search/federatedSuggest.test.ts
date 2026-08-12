import { describe, it, expect } from "vitest";
import { matchesTypedAddress } from "./federatedSuggest";

// The regression this guards: Typesense typo-tolerance returns "758 Coldstream Drive"
// for "758 cappamore drive", and those fuzzy hits used to suppress the geocode fallback
// entirely — a real off-market address never surfaced in the suggest dropdown.
describe("matchesTypedAddress", () => {
  it("accepts the same address in different formats", () => {
    expect(matchesTypedAddress("758 cappamore drive", "758 Cappamore Drive, Ottawa, ON K2J 6L4")).toBe(true);
    expect(matchesTypedAddress("40 rampart dr", "40 Rampart Drive, Brampton, ON")).toBe(true);
  });

  it("rejects a typo-tolerant fuzzy lookalike (different street)", () => {
    expect(matchesTypedAddress("758 cappamore drive", "758 Coldstream Drive, Oshawa, ON L1K 2K4")).toBe(false);
    expect(matchesTypedAddress("758 cappamore drive", "758 Dovercourt Road 1102, Toronto, ON")).toBe(false);
  });

  it("rejects a different civic number on the same street", () => {
    expect(matchesTypedAddress("758 cappamore drive", "760 Cappamore Drive, Ottawa, ON")).toBe(false);
  });

  it("requires a real street name in the typed query (no mid-typing matches)", () => {
    expect(matchesTypedAddress("758", "758 Coldstream Drive")).toBe(false);
    expect(matchesTypedAddress("758 ca", "758 Cappamore Drive")).toBe(false);
  });

  it("handles suffix variants (Dr vs Drive)", () => {
    expect(matchesTypedAddress("758 cappamore dr", "758 Cappamore Drive, Ottawa, ON")).toBe(true);
  });
});

// ── Campaign stacking ───────────────────────────────────────────────────────
// Real rows from the live index: 90 Osler Drive, Hamilton is listed at X13585448 and
// carries a terminated X12888728 at the same address; 90 OSLER Street in Kanata is an
// unrelated home that merely shares a street name.
import { stackByProperty } from "./federatedSuggest";
import type { SuggestItem } from "./types";

const row = (id: string, address: string, extra: Partial<SuggestItem> = {}): SuggestItem => ({
  id,
  category: "address",
  label: address,
  ...extra,
});

const withDoc = (id: string, address: string, doc: Record<string, unknown>): SuggestItem =>
  row(id, address, { listing: { id, UnparsedAddress: address, ...doc } as never });

describe("stackByProperty", () => {
  it("folds a terminated campaign under the live listing at the same address", () => {
    const out = stackByProperty([
      withDoc("X13585448", "90 Osler Drive, Hamilton, ON L9H 4B5", { TrueDom: 250, calculatedDOM: 20 }),
      row("X12888728", "90 Osler Drive, Hamilton, ON L9H 4B5", { category: "soldAddress" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("X13585448");
    expect(out[0].children?.map((c) => c.id)).toEqual(["X12888728"]);
    // The number every other portal hides behind the relist.
    expect(out[0].spanLabel).toBe("250d on market across 2 campaigns");
  });

  it("keeps a same-named street in another city as its own home", () => {
    const out = stackByProperty([
      withDoc("X13585448", "90 Osler Drive, Hamilton, ON L9H 4B5", {}),
      row("X12941486", "90 OSLER Street, Kanata, ON K2W 0K8", { category: "soldAddress" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => !r.children)).toBe(true);
  });

  it("keeps distinct homes on one street apart", () => {
    const out = stackByProperty([
      withDoc("X13491562", "784 Cappamore Drive, Barrhaven, ON K2J 6V6", {}),
      row("X13151222", "839 Cappamore Drive, Barrhaven, ON K2J 7C3", { category: "soldAddress" }),
      row("X13117328", "800 Cappamore Drive, Barrhaven, ON K2J 6V6", { category: "soldAddress" }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["X13491562", "X13151222", "X13117328"]);
  });

  it("leaves an ordinary listing unlabelled — nothing was hidden", () => {
    const out = stackByProperty([
      withDoc("X1", "1 Main St, Hamilton, ON L8P 1A1", { TrueDom: 20, calculatedDOM: 20 }),
    ]);
    expect(out[0].spanLabel).toBeUndefined();
    expect(out[0].children).toBeUndefined();
  });
});
