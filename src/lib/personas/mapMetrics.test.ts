import { describe, it, expect } from "vitest";
import { getMapMetric, bandFilterClause } from "./mapMetrics";

describe("Cap Rate map metric", () => {
  it("is backed by the real indexed field", () => {
    const m = getMapMetric("capRate")!;
    expect(m.field).toBe("cap_rate_est");
  });
  it("band-guards the metric accessor", () => {
    const m = getMapMetric("capRate")!;
    expect(m.metric({ cap_rate_est: 7 } as never)).toBe(7);
    expect(m.metric({ cap_rate_est: 99 } as never)).toBe(0); // out-of-band → 0 (excluded by v>0)
  });
  it("band-filters the legend clause on the real field", () => {
    const m = getMapMetric("capRate")!;
    expect(bandFilterClause(m, 0)).toContain("cap_rate_est");
  });
});
