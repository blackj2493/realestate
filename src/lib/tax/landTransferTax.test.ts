import { describe, expect, it } from "vitest";
import { landTransferTax, ontarioLtt, torontoMltt } from "./landTransferTax";

describe("landTransferTax", () => {
  it("applies the Ontario brackets (worked by hand)", () => {
    expect(ontarioLtt(55_000)).toBe(275);
    expect(ontarioLtt(250_000)).toBe(2_225);
    expect(ontarioLtt(400_000)).toBe(4_475);
    // 275 + 1,950 + 2,250 + 600,000 x 2%
    expect(ontarioLtt(1_000_000)).toBe(16_475);
    // 36,475 at $2M + 500,000 x 2.5%
    expect(ontarioLtt(2_500_000)).toBe(48_975);
  });

  it("matches Ontario up to $3M in Toronto, then the April 2026 luxury rates", () => {
    expect(torontoMltt(1_000_000)).toBe(ontarioLtt(1_000_000));
    expect(torontoMltt(3_000_000)).toBe(ontarioLtt(3_000_000));
    // 61,475 at $3M + 1,000,000 x 4.40% + 500,000 x 5.45%
    expect(torontoMltt(4_500_000)).toBe(61_475 + 44_000 + 27_250);
  });

  it("caps the first-time buyer refund and rebate", () => {
    const r = landTransferTax(1_000_000, { toronto: true, firstTime: true });
    expect([r.ontario, r.toronto, r.ontarioRefund, r.torontoRebate, r.total]).toEqual([16_475, 16_475, 4_000, 4_475, 24_475]);
    // A first-time buyer pays no Ontario tax up to about $368,333.
    expect(landTransferTax(368_000, { toronto: false, firstTime: true }).total).toBe(0);
    expect(landTransferTax(600_000, { toronto: false, firstTime: false })).toMatchObject({ ontario: 8_475, toronto: 0, total: 8_475 });
  });
});
