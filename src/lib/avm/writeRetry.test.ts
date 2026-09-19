import { describe, expect, it } from "vitest";
import { isTransientWriteError, writeBackoffMs, MAX_WRITE_RETRIES } from "./writeRetry";

describe("isTransientWriteError", () => {
  it("retries the fault that actually lost the writes", () => {
    // The exact string from estimates-recompute shard 2, 2026-09-16.
    expect(isTransientWriteError("stream timeout")).toBe(true);
  });

  it("retries the rest of the transport family", () => {
    for (const m of [
      "canceling statement due to statement timeout",
      "57014",
      "fetch failed",
      "ECONNRESET",
      "ETIMEDOUT",
      "socket hang up",
      "network error",
      "503 Service Unavailable",
      "upstream returned 504",
    ]) {
      expect(isTransientWriteError(m), m).toBe(true);
    }
  });

  it("does NOT retry a fault in the data", () => {
    // These fail identically four more times; retrying only makes the run later.
    for (const m of [
      'duplicate key value violates unique constraint "property_estimates_pkey"',
      'column "estimated_valu" of relation "property_estimates" does not exist',
      "numeric field overflow",
      "new row violates row-level security policy",
      "invalid input syntax for type numeric",
    ]) {
      expect(isTransientWriteError(m), m).toBe(false);
    }
  });

  it("treats a missing message as non-retryable", () => {
    expect(isTransientWriteError(null)).toBe(false);
    expect(isTransientWriteError(undefined)).toBe(false);
    expect(isTransientWriteError("")).toBe(false);
  });

  it("does not match a status code embedded in a listing key or id", () => {
    // \b…\b on the 50x codes: an id containing 502 is not a gateway error.
    expect(isTransientWriteError("row W13502884 rejected: invalid numeric")).toBe(false);
  });
});

describe("writeBackoffMs", () => {
  it("climbs and then caps", () => {
    expect(writeBackoffMs(1)).toBe(3_000);
    expect(writeBackoffMs(2)).toBe(6_000);
    expect(writeBackoffMs(3)).toBe(12_000);
    expect(writeBackoffMs(4)).toBe(24_000);
    expect(writeBackoffMs(5)).toBe(30_000);
    expect(writeBackoffMs(99)).toBe(30_000);
  });

  it("never returns a negative or zero wait", () => {
    expect(writeBackoffMs(0)).toBe(3_000);
    expect(writeBackoffMs(-3)).toBe(3_000);
  });

  it("keeps the worst case inside a shard's budget", () => {
    // 4 retries worst case = 45s per chunk. A run must not be pushed past its timeout by
    // backoff alone, which is what caps MAX_WRITE_RETRIES rather than the read path's 5.
    let total = 0;
    for (let a = 1; a <= MAX_WRITE_RETRIES; a++) total += writeBackoffMs(a);
    expect(total).toBeLessThanOrEqual(60_000);
  });
});
