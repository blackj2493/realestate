import { describe, expect, it } from "vitest";
import { buildNotSellingFacts, ratioWords, type OutcomeRow } from "./notSelling";

const at = "2026-11-08T08:00:00Z";
const r = (region: string, outcome: "sold" | "unsold", o: Partial<OutcomeRow>): OutcomeRow => ({
  region,
  outcome,
  homes: 0,
  cut_share: null,
  median_cut_pct: null,
  ratio_sample: 0,
  median_ratio: null,
  over10_share: null,
  median_dom: null,
  computed_at: at,
  ...o,
});

const rows: OutcomeRow[] = [
  r("ontario", "sold", { homes: 125616, cut_share: 0.199, median_cut_pct: 5.0, ratio_sample: 104757, median_ratio: 1.022, over10_share: 0.307, median_dom: 25 }),
  r("ontario", "unsold", { homes: 46950, cut_share: 0.22, median_cut_pct: 5.0, ratio_sample: 34200, median_ratio: 1.122, over10_share: 0.545, median_dom: 83 }),
  r("toronto", "sold", { homes: 21344, cut_share: 0.143, median_cut_pct: 5.2, ratio_sample: 19173, median_ratio: 1.018, over10_share: 0.315, median_dom: 21 }),
  r("toronto", "unsold", { homes: 13358, cut_share: 0.184, median_cut_pct: 4.8, ratio_sample: 11328, median_ratio: 1.113, over10_share: 0.528, median_dom: 67 }),
  r("smalltown", "sold", { homes: 300, cut_share: 0.2, median_cut_pct: 4, ratio_sample: 200, median_ratio: 1.01, over10_share: 0.2, median_dom: 30 }),
  r("smalltown", "unsold", { homes: 80, cut_share: 0.3, median_cut_pct: 5, ratio_sample: 40, median_ratio: 1.2, over10_share: 0.6, median_dom: 90 }),
];

describe("buildNotSellingFacts", () => {
  it("uses the city's own comparison when the sample is large", () => {
    const f = buildNotSellingFacts("Toronto", "toronto", rows);
    expect(f.unsoldShare).toBeCloseTo(38.5, 1);
    expect(f.facts.find((x) => x.id === "share")!.text).toContain("38% of the homes that came off the market in Toronto did not sell");
    expect(f.facts.find((x) => x.id === "price")!.text).toBe(
      "Homes in Toronto that did not sell asked a median of 11% above the median sale price of similar homes (same neighbourhood, home type and bedrooms). Homes that sold asked 2% above it.",
    );
    expect(f.facts.find((x) => x.id === "over10")!.text).toContain("53% of the homes that did not sell");
    expect(f.chart).toEqual({ unsoldGap: 11.3, soldGap: 1.8, unsoldOver10: 52.8, soldOver10: 31.5, basis: "Toronto" });
    expect(f.faqs).toHaveLength(5);
    expect(f.updatedLabel).toBe("November 8, 2026");
  });

  it("falls back to Ontario for the comparison in a small city, and says so", () => {
    const f = buildNotSellingFacts("Smalltown", "smalltown", rows);
    expect(f.facts.find((x) => x.id === "share")!.text).toContain("in Smalltown");
    expect(f.facts.find((x) => x.id === "price")!.text.startsWith("Homes across Ontario")).toBe(true);
    expect(f.chart!.basis).toBe("Ontario");
    // Days on market stay the city's own.
    expect(f.facts.find((x) => x.id === "dom")!.text).toContain("median of 30 days");
  });

  it("returns a usable shell with no data", () => {
    const f = buildNotSellingFacts("Nowhere", "nowhere", []);
    expect(f.facts).toEqual([]);
    expect(f.chart).toBeNull();
    expect(f.summary).toContain("Nowhere");
  });
});

describe("ratioWords", () => {
  it("words a ratio", () => {
    expect(ratioWords(1.122)).toBe("12% above");
    expect(ratioWords(0.988)).toBe("1% below");
    expect(ratioWords(1.002)).toBe("about the same as");
  });
});
