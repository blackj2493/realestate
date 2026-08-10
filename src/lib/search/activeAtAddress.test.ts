import { describe, it, expect, vi } from "vitest";

// The join under test drives NAVIGATION, so the risk it guards against is landing a
// visitor on a different house. Stub Typesense and assert only the matching rules.
const search = vi.fn();
vi.mock("@/lib/typesense/client", () => ({
  getTypesenseClient: () => ({
    collections: () => ({ documents: () => ({ search }) }),
  }),
}));

import { findActiveAtAddress } from "./activeAtAddress";

/** Each test states its own Typesense answer. Implementations rather than
 *  `mockResolvedValue`, and no shared beforeEach hook: both leave mock state behind in
 *  Vitest 4 that surfaces as a spurious failure in the error-path test below. */
const answers = (...docs: Array<Record<string, unknown>>) =>
  search.mockImplementation(() => Promise.resolve({ hits: docs.map((document) => ({ document })) }));

const LIVE = {
  id: "X13585448",
  UnparsedAddress: "90 Osler Drive, Hamilton, ON L9H 4B5",
  City: "Hamilton",
  ListPrice: 599_900,
  TransactionType: "For Sale",
};

describe("findActiveAtAddress", () => {
  it("finds the relist standing at a dead campaign's address", async () => {
    answers(LIVE);
    // The record's OWN address is what gets passed in — fully qualified, with a postal.
    const live = await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5", "X12888728");
    expect(live).toEqual({
      key: "X13585448",
      address: "90 Osler Drive, Hamilton, ON L9H 4B5",
      listPrice: 599_900,
      transactionType: "For Sale",
    });
  });

  it("matches on city + street when neither address carries a postal", async () => {
    answers({ ...LIVE, UnparsedAddress: "90 Osler Dr, Hamilton" });
    const live = await findActiveAtAddress("90 Osler Drive, Hamilton");
    expect(live?.key).toBe("X13585448");
  });

  it("rejects a same-number lookalike on another street", async () => {
    answers({ ...LIVE, UnparsedAddress: "90 Coldstream Drive, Hamilton, ON L8P 1A1" });
    expect(await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5")).toBeNull();
  });

  // The street name is checked even when the postals agree. `addressesMatch` treats an
  // equal postal as proof on its own; one dirty postal in the feed would then forward a
  // visitor onto a different house, so this join must not accept that shortcut.
  it("rejects another street even when the postal codes collide", async () => {
    answers({ ...LIVE, UnparsedAddress: "90 Coldstream Drive, Hamilton, ON L9H 4B5" });
    expect(await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5")).toBeNull();
  });

  it("rejects the same street name in a different city (90 Osler Street, Kanata)", async () => {
    answers({ ...LIVE, id: "X12941486", UnparsedAddress: "90 OSLER Street, Kanata, ON K2W 0K8" });
    expect(await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5")).toBeNull();
  });

  it("rejects a different civic number", async () => {
    answers({ ...LIVE, UnparsedAddress: "92 Osler Drive, Hamilton, ON L9H 4B5" });
    expect(await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5")).toBeNull();
  });

  it("never resolves a record to itself", async () => {
    answers({ ...LIVE, id: "X12888728" });
    expect(await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5", "X12888728")).toBeNull();
  });

  it("skips the lookup entirely for an unusable address", async () => {
    search.mockClear();
    expect(await findActiveAtAddress("Hamilton")).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("degrades to null when Typesense fails — the record keeps its own destination", async () => {
    // Thrown synchronously rather than returned as a rejected promise: an awaited
    // rejection here gets reported as an unhandled one by Vitest 4 even though the
    // code under test catches it. `await` funnels both into the same catch, and the
    // two assertions below keep this from passing vacuously.
    search.mockClear();
    search.mockImplementation(() => {
      throw new Error("typesense down");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await findActiveAtAddress("90 Osler Drive, Hamilton, ON L9H 4B5")).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
