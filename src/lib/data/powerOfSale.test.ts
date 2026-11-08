import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { buildPosFacts, type PosStatRow } from "./powerOfSale";

const r = (region: string, period: "12m" | "prev12m", sales: number, pos: number, over: Partial<PosStatRow> = {}): PosStatRow => ({
  region,
  period,
  sales,
  pos_sales: pos,
  pos_s2l: 96.2,
  other_s2l: 97.1,
  pos_below_share: 0.79,
  other_below_share: 0.79,
  pos_dom: 30,
  other_dom: 22,
  computed_at: "2026-11-08T08:00:00.000Z",
  ...over,
});

const rows: PosStatRow[] = [
  r("ontario", "12m", 126012, 510, { pos_s2l: 95.3, other_s2l: 97.2, pos_dom: 38, other_dom: 25 }),
  r("ontario", "prev12m", 116211, 330),
  r("brampton", "12m", 4330, 66),
  r("brampton", "prev12m", 3779, 36),
  r("markham", "12m", 2705, 9),
  r("markham", "prev12m", 2332, 2),
];

describe("buildPosFacts", () => {
  it("states the count, the share and the change, with the city's own comparison at 30+ sales", () => {
    const f = buildPosFacts("Brampton", "brampton", rows, 41);
    const t = Object.fromEntries(f.facts.map((x) => [x.id, x.text]));
    expect(t.active).toBe("41 homes for sale in Brampton are listed as power of sale (a sale by the lender) right now.");
    expect(t.share).toBe("In the last 12 months, 66 of 4,330 home sales in Brampton (1.52%) were power-of-sale sales, up from 36 (0.95%) in the 12 months before.");
    expect(t.price).toBe("In the last 12 months, power-of-sale homes in Brampton sold for a median of 96.2% of their final asking price, compared with 97.1% for other homes.");
    expect(t.dom).toBe("They took a median of 30 days to sell in Brampton, compared with 22 days for other homes.");
  });

  it("uses Ontario for the comparison and skips the change when a city's sample is small", () => {
    const f = buildPosFacts("Markham", "markham", rows, 3);
    const t = Object.fromEntries(f.facts.map((x) => [x.id, x.text]));
    expect(t.share).toBe("In the last 12 months, 9 of 2,705 home sales in Markham (0.33%) were power-of-sale sales.");
    expect(t.price).toContain("power-of-sale homes across Ontario sold for a median of 95.3%");
    expect(t.dom).toContain("38 days to sell across Ontario");
  });

  it("reads numeric strings and handles no homes for sale", () => {
    const strRows = rows.map((x) => ({ ...x, sales: String(x.sales) as unknown as number, pos_sales: String(x.pos_sales) as unknown as number }));
    const f = buildPosFacts("Brampton", "brampton", strRows, 0);
    expect(f.facts[0].text).toBe("No homes for sale in Brampton are listed as power of sale right now.");
    expect(f.share).toBeCloseTo(1.524, 2);
  });

  it("answers the FAQ without legal advice beyond the basics", () => {
    const f = buildPosFacts("Ontario", "ontario", rows, 400);
    expect(f.faqs.map((q) => q.q)).toContain("What is a power of sale in Ontario?");
    expect(f.faqs.find((q) => q.q.startsWith("Are power-of-sale homes cheaper"))!.a).toContain("in Ontario sold for a median of 95.3%");
  });

  it("still renders with no stats (stats read failed)", () => {
    const f = buildPosFacts("Brampton", "brampton", [], 5);
    expect(f.facts.map((x) => x.id)).toEqual(["active"]);
    expect(f.updatedLabel).toBeNull();
  });
});
