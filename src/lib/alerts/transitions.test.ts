import { describe, expect, it } from "vitest";
import {
  classifyStatusChange,
  isRelistScanBaseline,
  isTerminalStatus,
  resolvedBaseline,
} from "./transitions";

describe("isTerminalStatus", () => {
  it("matches the feed's terminal spellings case/space-insensitively", () => {
    for (const s of ["Sold", "CLOSED", "closed sale", "Leased", "Terminated ", " Expired", "Suspended"]) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    expect(isTerminalStatus("Active")).toBe(false);
    expect(isTerminalStatus("New")).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });
});

describe("classifyStatusChange — doc still in the active index", () => {
  it("alerts when a listing goes Sold Conditional", () => {
    expect(
      classifyStatusChange({ prev: "New", current: "Sold Conditional", soldHit: false, fallbackStatus: null })
    ).toEqual({ kind: "sold-conditional" });
  });

  it("covers the Escape Clause variant", () => {
    expect(
      classifyStatusChange({
        prev: "New",
        current: "Sold Conditional Escape Clause",
        soldHit: false,
        fallbackStatus: null,
      })
    ).toEqual({ kind: "sold-conditional" });
  });

  it("does not re-fire when already Sold Conditional", () => {
    expect(
      classifyStatusChange({
        prev: "Sold Conditional",
        current: "Sold Conditional",
        soldHit: false,
        fallbackStatus: null,
      })
    ).toBeNull();
  });

  it("alerts back-on-market when a terminal baseline reappears active", () => {
    expect(
      classifyStatusChange({ prev: "Terminated", current: "New", soldHit: false, fallbackStatus: null })
    ).toEqual({ kind: "back-on-market" });
  });

  it("stays silent on routine churn (New → Price Change)", () => {
    expect(
      classifyStatusChange({ prev: "New", current: "Price Change", soldHit: false, fallbackStatus: null })
    ).toBeNull();
  });

  it("stays silent when there is no prior baseline", () => {
    expect(
      classifyStatusChange({ prev: null, current: "Sold Conditional", soldHit: false, fallbackStatus: null })
    ).toBeNull();
  });
});

describe("classifyStatusChange — doc vanished from the active index", () => {
  it("classifies SOLD via the sold_listings hit", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: true, fallbackStatus: null })
    ).toEqual({ kind: "sold" });
  });

  it("classifies off-market with the fallback reason", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: false, fallbackStatus: "Terminated" })
    ).toEqual({ kind: "off-market", detail: "Terminated" });
  });

  it("treats a sold-spelled fallback as sold", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: false, fallbackStatus: "Closed" })
    ).toEqual({ kind: "sold" });
  });

  it("falls back to gone when nothing explains the vanish", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: false, fallbackStatus: null })
    ).toEqual({ kind: "gone" });
  });

  it("never re-fires once the baseline is already resolved", () => {
    expect(classifyStatusChange({ prev: "Sold", current: null, soldHit: true, fallbackStatus: null })).toBeNull();
    expect(
      classifyStatusChange({ prev: "Unavailable", current: null, soldHit: false, fallbackStatus: null })
    ).toBeNull();
  });

  it("treats the synthetic Relisted baseline as resolved (no off-market re-fire)", () => {
    expect(
      classifyStatusChange({ prev: "Relisted", current: null, soldHit: false, fallbackStatus: "Terminated" })
    ).toBeNull();
  });
});

describe("isRelistScanBaseline", () => {
  it("scans only campaigns that died without a transaction", () => {
    for (const s of ["Terminated", "expired", " Suspended", "Unavailable"]) {
      expect(isRelistScanBaseline(s)).toBe(true);
    }
  });

  it("never scans transactions, resolved relists, or live statuses", () => {
    for (const s of ["Sold", "Leased", "Closed", "Relisted", "New", "Active", null]) {
      expect(isRelistScanBaseline(s)).toBe(false);
    }
  });
});

describe("resolvedBaseline", () => {
  it("returns the status string to persist so an event never re-fires", () => {
    expect(resolvedBaseline({ kind: "sold" })).toBe("Sold");
    expect(resolvedBaseline({ kind: "off-market", detail: "Expired" })).toBe("Expired");
    expect(resolvedBaseline({ kind: "gone" })).toBe("Unavailable");
    expect(resolvedBaseline({ kind: "relisted" })).toBe("Relisted");
    // in-index events persist the live status, not a synthetic one
    expect(resolvedBaseline({ kind: "sold-conditional" })).toBeNull();
    expect(resolvedBaseline({ kind: "back-on-market" })).toBeNull();
  });
});
