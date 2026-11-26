import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ getServiceRoleClient: vi.fn() }));

const { editionFor, signedPct, usdK } = await import("./monthlyReport");
const { editionLabel, reportPath, reportTitle } = await import("./reportPaths");
const { EDITIONS, editionBySlug, latestEdition } = await import("./reportEditions");

describe("monthly report helpers", () => {
  it("names the edition by the Toronto month it is published in", () => {
    // 03:00Z on Dec 1 is still Nov 30 in Toronto.
    expect(editionFor("2026-12-01T03:00:00Z")).toBe("2026-11");
    expect(editionLabel("2026-11")).toBe("November 2026");
    expect(reportTitle("2026-11")).toBe("Ontario Housing Market Report: November 2026");
    expect(reportPath()).toBe("/data/reports");
    expect(reportPath("2026-11")).toBe("/data/reports/2026-11");
  });

  it("formats signs and rounded prices", () => {
    expect(signedPct(-6.8)).toBe("−6.8%");
    expect(signedPct(1.74)).toBe("+1.7%");
    expect(signedPct(14.2, 0)).toBe("+14%");
    expect(usdK(634576)).toBe("$635,000");
  });
});

describe("published editions", () => {
  it("are in order, each frozen with its own month and enough content", () => {
    const keys = EDITIONS.map((e) => e.edition);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of EDITIONS) {
      expect(e.edition).toBe(editionFor(e.publishedAt));
      expect(e.title).toBe(reportTitle(e.edition));
      expect(e.findings.length).toBeGreaterThanOrEqual(3);
      expect(e.cities.length).toBeGreaterThanOrEqual(3);
      // Every finding states a number.
      for (const f of e.findings) expect(f.text).toMatch(/\d/);
    }
    expect(latestEdition()).toBe(EDITIONS[EDITIONS.length - 1]);
    expect(editionBySlug("2026-11")?.label).toBe("November 2026");
    expect(editionBySlug("2020-01")).toBeNull();
  });
});
