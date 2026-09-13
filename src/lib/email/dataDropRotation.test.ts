import { describe, it, expect } from "vitest";
import { lastDataDropKind } from "@/lib/email/sendPolicy";

describe("lastDataDropKind", () => {
  it("reads the kind out of the newest data_drop stamp", () => {
    expect(
      lastDataDropKind({
        "data_drop:2026-W34:leverage": "2026-08-21T11:40:00Z",
        "data_drop:2026-W36:price": "2026-09-06T17:00:00Z",
        "data_drop:2026-W35:speed": "2026-08-28T11:40:00Z",
      })
    ).toBe("price");
  });

  it("orders by the stamp TIME, not by the week label", () => {
    // Week labels sort as strings; two stamps from one week would otherwise be unordered.
    expect(
      lastDataDropKind({
        "data_drop:2026-W36:price": "2026-09-06T17:00:00Z",
        "data_drop:2026-W36:bidding": "2026-09-06T19:00:00Z",
      })
    ).toBe("bidding");
  });

  it("ignores other streams and pre-rotation stamps that carry no kind", () => {
    expect(lastDataDropKind({ "alerts_digest": "2026-09-06T05:00:00Z" })).toBeNull();
    expect(lastDataDropKind({ "data_drop:2026-W36": "2026-09-06T17:00:00Z" })).toBeNull();
    expect(lastDataDropKind({})).toBeNull();
    expect(lastDataDropKind(null)).toBeNull();
    expect(lastDataDropKind(undefined)).toBeNull();
  });

  it("skips a stamp with an unparseable time rather than crashing", () => {
    expect(
      lastDataDropKind({ "data_drop:2026-W36:price": "not-a-date", "data_drop:2026-W35:speed": "2026-08-28T11:40:00Z" })
    ).toBe("speed");
  });
});

import { pickHeadline, type LadderInput } from "@/lib/dataDrop/payload";

/** Inputs that let several rungs fire, so demotion has somewhere to go. */
const input = (over: Partial<LadderInput> = {}): LadderInput =>
  ({
    region: "Oakville",
    row: { region: "Oakville", medianPrice: 1_200_000, yoyPct: -3, cutShare: null, trueDom: null, activeCount: null },
    competition: { pctOverAsk: 37, yoyOverAskPts: -12, sampleCount: 400, priorSample: 400 },
    snapshots: new Map(),
    now: Date.parse("2026-09-11T11:40:00Z"),
    ...over,
  }) as unknown as LadderInput;

describe("pickHeadline rotation", () => {
  it("leads with the best rung when there is no history", () => {
    const r = pickHeadline(input());
    expect(r?.headline.kind).toBe("bidding");
  });

  it("demotes the kind the reader had last time", () => {
    const r = pickHeadline(input(), "bidding");
    expect(r?.headline.kind).toBe("price");
    expect(r?.trace.find((t) => t.kind === "bidding")?.result).toBe("repeat");
  });

  it("repeats rather than sending nothing when it is the only rung that fires", () => {
    // The honest outcome on a quiet week: a repeat beats suppressing the edition.
    const onlyPrice = input({ competition: null });
    const r = pickHeadline(onlyPrice, "price");
    expect(r?.headline.kind).toBe("price");
    expect(r?.trace.filter((t) => t.result === "FIRED")).toHaveLength(1);
  });

  it("is unaffected by a kind the reader never had", () => {
    expect(pickHeadline(input(), "supply")?.headline.kind).toBe("bidding");
    expect(pickHeadline(input(), null)?.headline.kind).toBe("bidding");
  });

  it("returns null only when nothing fires at all", () => {
    const nothing = input({ competition: null, row: { region: "X" } as never });
    expect(pickHeadline(nothing, "price")).toBeNull();
  });
});
