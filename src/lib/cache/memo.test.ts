import { afterEach, describe, expect, it, vi } from "vitest";
import { ttlMemo } from "./memo";

afterEach(() => vi.useRealTimers());

describe("ttlMemo", () => {
  it("joins concurrent calls and reuses the result inside the TTL", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const m = ttlMemo(fn, (x) => String(x), { ttlMs: 1000, max: 10 });
    const [a, b] = await Promise.all([m(2), m(2)]);
    expect([a, b, await m(2)]).toEqual([4, 4, 4]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls again after the TTL", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => 1);
    const m = ttlMemo(fn, () => "k", { ttlMs: 1000, max: 10 });
    await m();
    vi.advanceTimersByTime(1001);
    await m();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not keep a rejected promise", async () => {
    let fail = true;
    const fn = vi.fn(async () => {
      if (fail) throw new Error("typesense down");
      return "ok";
    });
    const m = ttlMemo(fn, () => "k", { ttlMs: 60_000, max: 10 });
    await expect(m()).rejects.toThrow("typesense down");
    fail = false;
    expect(await m()).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not keep a value that fails `keep` (a fail-soft empty result)", async () => {
    const fn = vi.fn(async () => [] as number[]);
    const m = ttlMemo(fn, () => "k", { ttlMs: 60_000, max: 10, keep: (v) => (v as number[]).length > 0 });
    await m();
    await m();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("drops the oldest entry past max", async () => {
    const fn = vi.fn(async (x: number) => x);
    const m = ttlMemo(fn, (x) => String(x), { ttlMs: 60_000, max: 2 });
    await m(1);
    await m(2);
    await m(3);
    expect(m.size()).toBe(2);
    await m(1);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
