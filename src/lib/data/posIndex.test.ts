import { describe, expect, it } from "vitest";
import { availableEditions, buildPosIndex, type PosMonthRow } from "./posIndex";

// 26 months, Sep 2024 .. Oct 2026, plus a partial Nov 2026.
function months(): string[] {
  return Array.from({ length: 27 }, (_, i) => {
    const t = 2024 * 12 + 8 + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
  });
}

function rows(): PosMonthRow[] {
  const out: PosMonthRow[] = [];
  for (const m of months()) {
    const recent = m >= "2025-11-01";
    const partial = m === "2026-11-01";
    out.push({ region: "ontario", month: m, sales: partial ? 900 : 10000, pos_sales: partial ? 3 : recent ? 45 : 30, pos_s2l: 95.3, other_s2l: 97.2 });
    out.push({ region: "brampton", month: m, sales: 400, pos_sales: recent ? 8 : 3, pos_s2l: null, other_s2l: null });
    out.push({ region: "toronto", month: m, sales: 2000, pos_sales: recent ? 6 : 5, pos_s2l: null, other_s2l: null });
    out.push({ region: "markham", month: m, sales: 300, pos_sales: 1, pos_s2l: null, other_s2l: null });
  }
  return out;
}

describe("availableEditions", () => {
  it("lists full months with enough Ontario sales, not the current month", () => {
    const e = availableEditions(rows(), "2026-11-10T12:00:00Z");
    expect(e[0]).toBe("2024-11"); // Sep and Oct 2024 have no 3-month window
    expect(e[e.length - 1]).toBe("2026-10");
    expect(e).not.toContain("2026-11");
  });
});

describe("buildPosIndex", () => {
  it("leads with the 3 months against the same months a year earlier", () => {
    const d = buildPosIndex(rows(), "2026-10")!;
    expect(d.title).toBe("Ontario Power of Sale Index: October 2026");
    expect(d.headline).toBe(
      "In the 3 months from August 2026 to October 2026, 135 of 30,000 home sales in Ontario (0.45%) were power of sale, up from 0.30% (90 of 30,000) in the same months a year earlier.",
    );
    const month = d.facts.find((f) => f.id === "month_share")!.text;
    expect(month).toContain("In October 2026 alone, 45 of 10,000 sales (0.45%) were power of sale, against 0.30% in October 2025.");
    expect(d.facts.find((f) => f.id === "s2l")!.text).toContain("95.3%");
  });

  it("ranks cities over 12 months and shows the change only with enough sales", () => {
    const d = buildPosIndex(rows(), "2026-10")!;
    // Brampton 96/4,800 = 2%; Markham 12/3,600 = 0.33%; Toronto 72/24,000 = 0.30%.
    expect(d.cities.map((c) => c.city)).toEqual(["Brampton", "Markham", "Toronto"]);
    expect(d.cities[1].prevSharePct).toBeCloseTo((12 / 3600) * 100, 5); // 12 in each year: shown
    // An edition whose earlier 12 months are not all in the data shows no change.
    expect(buildPosIndex(rows(), "2025-12")!.cities.every((c) => c.prevSharePct == null)).toBe(true);
    const b = d.cities[0];
    expect(b.pos).toBe(96);
    expect(b.sharePct).toBeCloseTo(2, 5);
    expect(b.prevSharePct).toBeCloseTo((3 * 12 / 4800) * 100, 5);
  });

  it("has no edition without the 3 months of data", () => {
    expect(buildPosIndex(rows(), "2024-09")).toBeNull();
  });
});

describe("coverage", () => {
  it("drops months with sales but no power-of-sale flags at the start", () => {
    const r = rows().map((x) => (x.month === "2024-09-01" ? { ...x, pos_sales: 0 } : x));
    const e = availableEditions(r, "2026-11-10T12:00:00Z");
    expect(e[0]).toBe("2024-12");
    const d = buildPosIndex(r, "2026-10")!;
    expect(d.series[0].edition).toBe("2024-10");
    expect(buildPosIndex(r, "2024-11")).toBeNull(); // its 3 months would include the unflagged September
  });
});
