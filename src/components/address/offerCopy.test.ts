import { describe, expect, it } from "vitest";
import { HOME_REPORT_COPY } from "./HomeReportCard";
import { SELLING_PLAN_COPY } from "./SellingPlanCard";

describe("address offer copy (owner wording rules, 2026-11-03)", () => {
  const all = (c: typeof HOME_REPORT_COPY) => [c.title, c.intro, ...c.points, c.footnote, c.openLabel].join(" ");

  it("home report offers more than the history and names neither REALTOR nor MLS", () => {
    const t = all(HOME_REPORT_COPY);
    expect(HOME_REPORT_COPY.points).toHaveLength(4);
    expect(t).not.toMatch(/realtor/i);
    expect(t).not.toMatch(/\bMLS\b/);
    expect(t).toMatch(/what changed between sales/);
  });

  it("neither card names a person or a brokerage", () => {
    for (const c of [HOME_REPORT_COPY, SELLING_PLAN_COPY]) {
      expect(all(c)).not.toMatch(/Tanmay|eXp|Brokerage/);
    }
  });
});
