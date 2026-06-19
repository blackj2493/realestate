import { describe, it, expect } from "vitest";
import { columnSortValue, fitLedgerColumns } from "./columnSort";
import { PERSONA_CONFIG, type ColumnType } from "@/lib/personas/personaConfig";
import type { ListingDocument } from "@/lib/typesense/client";

const doc = (over: Partial<ListingDocument> = {}): ListingDocument => ({ ...over } as ListingDocument);

describe("columnSortValue cap/yield", () => {
  it("uses the real cap_rate_est, band-guarded", () => {
    expect(columnSortValue(doc({ cap_rate_est: 6.2 }), "capRate")).toBe(6.2);
    expect(columnSortValue(doc({ cap_rate_est: 99 }), "capRate")).toBeNull();
    expect(columnSortValue(doc({}), "capRate")).toBeNull();
  });
  it("uses the real gross_yield_est (percent), band-guarded — NOT the fraction", () => {
    expect(columnSortValue(doc({ gross_yield_est: 5.1 }), "yield")).toBe(5.1);
    expect(columnSortValue(doc({ gross_yield_est: 99 }), "yield")).toBeNull();
  });
  it("ignores the fake ExtrapolatedCapRate", () => {
    expect(columnSortValue(doc({ ExtrapolatedCapRate: 8 } as Partial<ListingDocument>), "capRate")).toBeNull();
  });
});

describe("fitLedgerColumns", () => {
  const cols = PERSONA_CONFIG.smart.columns; // address, trueDom, capRate, carryCost, alphaFlag
  const types = (c: { type: ColumnType }[]) => c.map((x) => x.type);

  it("shows every column when the panel is wide", () => {
    expect(types(fitLedgerColumns(cols, 800))).toEqual(["address", "trueDom", "capRate", "carryCost", "alphaFlag"]);
  });

  it("drops the wide non-sortable alphaFlag first at the default 620px so the metric columns survive", () => {
    expect(types(fitLedgerColumns(cols, 620))).toEqual(["address", "trueDom", "capRate", "carryCost"]);
  });

  it("keeps dropping from the right as the panel narrows, address always last to go", () => {
    const got = types(fitLedgerColumns(cols, 420));
    expect(got[0]).toBe("address");
    expect(got).not.toContain("alphaFlag");
    expect(got).not.toContain("carryCost");
  });

  it("never drops the address card, even at zero/unknown width", () => {
    expect(types(fitLedgerColumns(cols, 0))).toEqual(["address"]);
  });

  it("preserves config order of the kept columns", () => {
    const got = types(fitLedgerColumns(PERSONA_CONFIG.builders.columns, 760));
    expect(got).toEqual(["address", "lotDims", "zoning", "density", "alphaFlag"]);
  });
});
