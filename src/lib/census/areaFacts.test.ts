import { describe, expect, it } from "vitest";
import { areaStats, buildAreaFacts, groupedMedian, rentCheck, type ProfileValues } from "./areaFacts";
import { C, INCOME_GROUPS } from "./characteristics";

function da(rows: Record<number, number | null>): ProfileValues {
  const v: ProfileValues = {};
  for (const [k, n] of Object.entries(rows)) v[Number(k)] = [n, null];
  return v;
}

describe("areaStats", () => {
  it("pools counts across DAs", () => {
    const s = areaStats([
      da({ [C.tenureTotal]: 100, [C.tenureRenter]: 60, [C.tenureOwner]: 40 }),
      da({ [C.tenureTotal]: 100, [C.tenureRenter]: 20, [C.tenureOwner]: 80 }),
    ]);
    expect(s.rentPct).toBe(40);
    expect(s.ownPct).toBe(60);
    expect(s.households).toBe(200);
  });

  it("skips a DA whose numerator was suppressed instead of counting it as zero", () => {
    const s = areaStats([
      da({ [C.tenureTotal]: 100, [C.tenureRenter]: 50 }),
      da({ [C.tenureTotal]: 100, [C.tenureRenter]: null }),
    ]);
    expect(s.rentPct).toBe(50);
  });

  it("hides a share whose base is too small", () => {
    expect(areaStats([da({ [C.tenureTotal]: 20, [C.tenureRenter]: 10 })]).rentPct).toBeNull();
  });

  it("pools a published percentage by its base count", () => {
    const a: ProfileValues = { [C.tenantTotal]: [100, null], [C.tenantPct30Plus]: [50, 50] };
    const b: ProfileValues = { [C.tenantTotal]: [300, null], [C.tenantPct30Plus]: [30, 30] };
    expect(areaStats([a, b]).tenantCostBurdenPct).toBe(35);
  });

  it("interpolates the median commute", () => {
    const s = areaStats([
      da({ [C.durUnder15]: 20, [C.dur15to29]: 30, [C.dur30to44]: 30, [C.dur45to59]: 10, [C.dur60Plus]: 10 }),
    ]);
    expect(s.medianCommuteMin).toBe(30);
  });
});

describe("groupedMedian", () => {
  it("lands inside the median bin", () => {
    expect(groupedMedian([50, 50], [{ lo: 0, hi: 10 }, { lo: 10, hi: 20 }])).toBe(10);
    expect(groupedMedian([25, 50, 25], [{ lo: 0, hi: 10 }, { lo: 10, hi: 20 }, { lo: 20, hi: null }])).toBe(15);
  });
});

describe("rentCheck", () => {
  const groups = INCOME_GROUPS.map(() => 0);
  const at = (lo: number) => INCOME_GROUPS.findIndex((g) => g.lo === lo);

  it("needs 40x the monthly rent at 30% of income", () => {
    const g = [...groups];
    g[at(100_000)] = 50;
    g[at(150_000)] = 50;
    const r = rentCheck(3_400, g)!;
    expect(r.incomeNeeded).toBe(136_000);
    // 100-125k: none above; 125-150k bin empty; 150-200k: all 50 → 50%
    expect(r.sharePct).toBe(50);
    expect(r.atTop).toBe(false);
  });

  it("splits the bin that holds the threshold", () => {
    const g = [...groups];
    g[at(100_000)] = 100; // 100-125k, rent 2,800 → needs 112k → 13/25 above
    expect(rentCheck(2_800, g)!.sharePct).toBe(52);
  });

  it("flags an upper bound when the income needed is in the open top group", () => {
    const g = [...groups];
    g[at(200_000)] = 100;
    const r = rentCheck(6_000, g)!;
    expect(r.atTop).toBe(true);
    expect(r.sharePct).toBe(100);
  });

  it("returns null without a distribution or a rent", () => {
    expect(rentCheck(3_000, [])).toBeNull();
    expect(rentCheck(0, groups)).toBeNull();
  });
});

describe("buildAreaFacts", () => {
  it("compares the pooled block with its city", () => {
    const f = buildAreaFacts(
      [da({ [C.pop2021]: 500, [C.tenureTotal]: 200, [C.tenureRenter]: 100 })],
      da({ [C.pop2021]: 1000, [C.tenureTotal]: 400, [C.tenureRenter]: 100 }),
      "Toronto",
    );
    expect(f.here.rentPct).toBe(50);
    expect(f.city.rentPct).toBe(25);
    expect(f.pop).toBe(500);
    expect(f.das).toBe(1);
    expect(f.incomeGroups).toEqual([]);
  });
});
