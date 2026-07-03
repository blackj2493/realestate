import { describe, it, expect } from "vitest";
import {
  formFamily,
  familySubtypeVariants,
  optionKeyForSubType,
} from "./similarListings";

describe("formFamily", () => {
  it("maps ground-related sub-types to 'ground'", () => {
    expect(formFamily("Detached")).toBe("ground");
    expect(formFamily("Att/Row/Townhouse")).toBe("ground");
    expect(formFamily("Link")).toBe("ground");
    expect(formFamily("Duplex")).toBe("ground");
  });
  it("handles the trailing-space Semi-Detached quirk", () => {
    expect(formFamily("Semi-Detached ")).toBe("ground");
    expect(optionKeyForSubType("Semi-Detached ")).toBe("semi");
  });
  it("maps condo apartments to 'apartment' and vacant to 'land'", () => {
    expect(formFamily("Condo Apartment")).toBe("apartment");
    expect(formFamily("Vacant Land")).toBe("land");
  });
  it("maps unknown/null to 'other'", () => {
    expect(formFamily("Houseboat")).toBe("other");
    expect(formFamily(null)).toBe("other");
  });
});

describe("familySubtypeVariants", () => {
  it("returns all ground variants for a detached subject and never crosses into apartment", () => {
    const v = familySubtypeVariants("Detached");
    expect(v).toContain("Detached");
    expect(v).toContain("Semi-Detached "); // trailing space preserved
    expect(v).toContain("Condo Townhouse");
    expect(v).not.toContain("Condo Apartment");
  });
  it("returns only the apartment variants for a condo subject", () => {
    const v = familySubtypeVariants("Condo Apartment");
    expect(v).toContain("Condo Apartment");
    expect(v).not.toContain("Detached");
  });
  it("returns just the raw sub-type for an unmapped 'other' subject", () => {
    expect(familySubtypeVariants("Houseboat")).toEqual(["Houseboat"]);
  });
});

import {
  bedScore,
  combinedBedScore,
  garageScore,
  splitBeds,
  priceScore,
  sizeScore,
  regionScore,
  subtypeScore,
  recencyScore,
} from "./similarListings";

describe("bedScore (asymmetric — bigger preferred over smaller)", () => {
  it("peaks at an exact match", () => {
    expect(bedScore(3, 3)).toBe(1);
  });
  it("prefers +1 bed over -1 bed", () => {
    expect(bedScore(3, 4)).toBeGreaterThan(bedScore(3, 2));
  });
  it("decays toward a floor for big gaps", () => {
    expect(bedScore(3, 6)).toBeLessThanOrEqual(0.1);
  });
});

describe("combinedBedScore (above-grade dominates, below-grade refines)", () => {
  // Subject is 4+2 (4 above, 2 below).
  const s = (a: number, b: number) => (cA: number, cB: number) => combinedBedScore(a, b, cA, cB);
  const sub = s(4, 2);
  it("peaks for an identical above/below split", () => {
    expect(sub(4, 2)).toBe(1);
  });
  it("ranks a true above-grade match (4+X) far above a same-total 6+0", () => {
    // The bug being fixed: 4+2 (total 6) vs 6+0 (also total 6) used to be a perfect match.
    expect(sub(4, 1)).toBeGreaterThan(sub(6, 0));
    expect(sub(4, 0)).toBeGreaterThan(sub(6, 0));
  });
  it("within above-grade matches, prefers a closer below-grade count", () => {
    expect(sub(4, 1)).toBeGreaterThan(sub(4, 0)); // 4+1 closer to 4+2 than 4+0
    expect(sub(4, 2)).toBeGreaterThan(sub(4, 1));
  });
});

describe("garageScore (symmetric closeness; neutral when unknown)", () => {
  it("peaks at an exact match", () => {
    expect(garageScore(2, 2)).toBe(1);
  });
  it("penalizes a 1-car vs 2-car difference and more for a no-garage gap", () => {
    expect(garageScore(2, 1)).toBeGreaterThan(garageScore(2, 0));
    expect(garageScore(2, 1)).toBeLessThan(garageScore(2, 2));
  });
  it("is neutral (0.5) when either side is unknown (null), not penalized", () => {
    expect(garageScore(null, 2)).toBe(0.5);
    expect(garageScore(2, null)).toBe(0.5);
    // 0 is a REAL value (no garage), distinct from unknown.
    expect(garageScore(2, 0)).toBeLessThan(0.5);
  });
});

describe("splitBeds (above/below normalization with the TRREB fallback)", () => {
  it("passes through a fully-populated split", () => {
    expect(splitBeds({ total: 6, above: 4, below: 2 })).toEqual({ above: 4, below: 2 });
  });
  it("derives above = total − below when above is missing/0 (TRREB quirk)", () => {
    expect(splitBeds({ total: 6, above: 0, below: 2 })).toEqual({ above: 4, below: 2 });
  });
  it("falls back to total when only the total is known", () => {
    expect(splitBeds({ total: 5 })).toEqual({ above: 5, below: 0 });
  });
});

describe("priceScore / sizeScore", () => {
  it("priceScore peaks when equal, 0 at >=50% off", () => {
    expect(priceScore(1_000_000, 1_000_000)).toBe(1);
    expect(priceScore(1_000_000, 1_500_000)).toBe(0);
  });
  it("sizeScore is neutral (0.5) when either area is missing", () => {
    expect(sizeScore(0, 1500)).toBe(0.5);
    expect(sizeScore(1500, 0)).toBe(0.5);
  });
  it("sizeScore peaks when equal", () => {
    expect(sizeScore(1500, 1500)).toBe(1);
  });
});

describe("regionScore / subtypeScore", () => {
  it("rewards same CityRegion over same-city-only", () => {
    expect(regionScore("Bram East", "Bram East")).toBe(1);
    expect(regionScore("Bram East", "Bram West")).toBe(0.4);
  });
  it("treats same option key as an exact sub-type match (trailing space)", () => {
    expect(subtypeScore("Semi-Detached", "Semi-Detached ")).toBe(1);
    expect(subtypeScore("Detached", "Condo Townhouse")).toBe(0.5);
  });
});

describe("recencyScore", () => {
  it("ranks fresher sales higher", () => {
    expect(recencyScore(10)).toBeGreaterThan(recencyScore(60));
    expect(recencyScore(60)).toBeGreaterThan(recencyScore(150));
  });
});

import {
  scoreForSale,
  scoreSold,
  rankSimilar,
  classifyMatchQuality,
  buildWhyLabel,
  type SubjectAttrs,
  type CandidateAttrs,
} from "./similarListings";

const SUBJECT: SubjectAttrs = {
  id: "SUBJ",
  cityRegion: "Bram East",
  city: "Brampton",
  subType: "Detached",
  beds: 3,
  bedsAbove: 3,
  bedsBelow: 0,
  garage: 2,
  listPrice: 1_000_000,
  area: 1800,
};

const cand = (over: Partial<CandidateAttrs>): CandidateAttrs => ({
  cityRegion: "Bram East",
  subType: "Detached",
  beds: 3,
  bedsAbove: 3,
  bedsBelow: 0,
  garage: 2,
  price: 1_000_000,
  area: 1800,
  ...over,
});

describe("scoreForSale", () => {
  it("ranks a same-neighbourhood match above a same-city-only one", () => {
    expect(scoreForSale(SUBJECT, cand({}))).toBeGreaterThan(
      scoreForSale(SUBJECT, cand({ cityRegion: "Bram West" }))
    );
  });
});

describe("comparables regression — a 4+2 subject", () => {
  // Subject: 4 above + 2 below (total 6), 2-car garage.
  const subject: SubjectAttrs = { ...SUBJECT, beds: 6, bedsAbove: 4, bedsBelow: 2, garage: 2 };
  const fourPlusTwo = cand({ beds: 6, bedsAbove: 4, bedsBelow: 2, garage: 2 });
  const sixPlusZero = cand({ beds: 6, bedsAbove: 6, bedsBelow: 0, garage: 2 });

  it("ranks a true 4+2 comp above a same-total 6+0 comp (the original bug)", () => {
    expect(scoreForSale(subject, fourPlusTwo)).toBeGreaterThan(scoreForSale(subject, sixPlusZero));
    expect(scoreSold(subject, { ...sixPlusZero, daysAgo: 10 })).toBeLessThan(
      scoreSold(subject, { ...fourPlusTwo, daysAgo: 10 })
    );
  });

  it("ranks a matching-garage comp above a garage-mismatched one, all else equal", () => {
    const oneCar = cand({ beds: 6, bedsAbove: 4, bedsBelow: 2, garage: 0 });
    expect(scoreForSale(subject, fourPlusTwo)).toBeGreaterThan(scoreForSale(subject, oneCar));
  });
});

describe("scoreSold ignores price (it is the answer, not a filter)", () => {
  it("gives identical scores regardless of the comp's close price", () => {
    const a = scoreSold(SUBJECT, cand({ price: 500_000, daysAgo: 10 }));
    const b = scoreSold(SUBJECT, cand({ price: 2_000_000, daysAgo: 10 }));
    expect(a).toBe(b);
  });
});

describe("rankSimilar", () => {
  it("sorts by score desc, caps at the limit, and tags exact flags + why", () => {
    const items = [
      cand({ cityRegion: "Bram West", beds: 1, bedsAbove: 1 }), // weak
      cand({}), // perfect
      cand({ cityRegion: "Bram East", beds: 4, bedsAbove: 4 }), // strong
    ];
    const ranked = rankSimilar(SUBJECT, items, (c) => c, "sale", 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[0].regionExact).toBe(true);
    expect(ranked[0].subtypeExact).toBe(true);
    expect(ranked[0].why).toContain("Same neighbourhood");
  });
});

describe("classifyMatchQuality", () => {
  it("returns none/sparse/partial/close by count and strength", () => {
    expect(classifyMatchQuality([])).toBe("none");
    expect(
      classifyMatchQuality([{ regionExact: true, subtypeExact: true }])
    ).toBe("sparse");
    const strong = Array.from({ length: 4 }, () => ({ regionExact: true, subtypeExact: true }));
    expect(classifyMatchQuality(strong)).toBe("close");
    const weak = Array.from({ length: 4 }, () => ({ regionExact: false, subtypeExact: false }));
    expect(classifyMatchQuality(weak)).toBe("partial");
  });
});

describe("buildWhyLabel", () => {
  it("labels a sold comp with neighbourhood, form, and recency", () => {
    const label = buildWhyLabel(SUBJECT, cand({ cityRegion: "Bram West", beds: 4, daysAgo: 22 }), "sold");
    expect(label).toBe("Nearby in Brampton · 4bd Detached · sold 22d ago");
  });
});

import { buildForSaleSimilarFilter, buildSoldSimilarFilter } from "./similarListings";

describe("buildForSaleSimilarFilter", () => {
  it("scopes to For Sale + city + the subject's family only (no cross-family)", () => {
    const f = buildForSaleSimilarFilter(SUBJECT);
    expect(f).toContain("TransactionType:=`For Sale`");
    expect(f).toContain("City:=`Brampton`");
    expect(f).toContain("PropertySubType:=`Detached`");
    expect(f).toContain("PropertySubType:=`Condo Townhouse`");
    expect(f).not.toContain("Condo Apartment"); // family wall
  });
});

describe("buildSoldSimilarFilter", () => {
  it("scopes to sold + price floor + window + city + family", () => {
    const NOW = 1_700_000_000_000;
    const f = buildSoldSimilarFilter(SUBJECT, 180, NOW);
    expect(f).toContain("DealType:=sold");
    expect(f).toContain("ClosePrice:>=1");
    expect(f).toContain(`PurchaseContractDate:<=${NOW}`);
    expect(f).toContain(`PurchaseContractDate:>=${NOW - 180 * 86_400_000}`);
    expect(f).toContain("PropertySubType:=`Detached`");
    expect(f).not.toContain("Condo Apartment");
  });
});

import { buildAttrDeltas, formatPriceDelta, type DeltaInput } from "./similarListings";

const subjDelta: DeltaInput = { beds: 3, baths: 2, price: 1_000_000, area: 1500 };

describe("formatPriceDelta", () => {
  it("renders compact signed money", () => {
    expect(formatPriceDelta(50_000)).toBe("+$50K");
    expect(formatPriceDelta(-240_000)).toBe("-$240K");
    expect(formatPriceDelta(1_200_000)).toBe("+$1.2M");
    expect(formatPriceDelta(2_000_000)).toBe("+$2M");
    expect(formatPriceDelta(900)).toBe("+$900");
  });
});

describe("buildAttrDeltas", () => {
  it("emits a signed, pluralised bed delta and tags direction", () => {
    const up = buildAttrDeltas(subjDelta, { beds: 4, baths: 2, price: 1_000_000, area: 1500 });
    expect(up).toContainEqual({ kind: "beds", delta: 1, label: "+1 bed", direction: "up" });
    const down = buildAttrDeltas(subjDelta, { beds: 1, baths: 2, price: 1_000_000, area: 1500 });
    expect(down).toContainEqual({ kind: "beds", delta: -2, label: "-2 beds", direction: "down" });
  });
  it("handles fractional baths", () => {
    const d = buildAttrDeltas(subjDelta, { beds: 3, baths: 2.5, price: 1_000_000, area: 1500 });
    expect(d.find((x) => x.kind === "baths")?.label).toBe("+0.5 baths");
  });
  it("omits chips for equal or unknown attributes", () => {
    const same = buildAttrDeltas(subjDelta, { beds: 3, baths: 2, price: 1_000_000, area: 1500 });
    expect(same.find((x) => x.kind === "beds")).toBeUndefined();
    const unknownBeds = buildAttrDeltas(subjDelta, { beds: 0, baths: 2, price: 1_000_000, area: 1500 });
    expect(unknownBeds.find((x) => x.kind === "beds")).toBeUndefined();
  });
  it("only shows a price chip when includePrice is set (off for sold)", () => {
    const cand: DeltaInput = { beds: 3, baths: 2, price: 1_250_000, area: 1500 };
    expect(buildAttrDeltas(subjDelta, cand).find((x) => x.kind === "price")).toBeUndefined();
    const withPrice = buildAttrDeltas(subjDelta, cand, { includePrice: true });
    expect(withPrice.find((x) => x.kind === "price")?.label).toBe("+$250K");
  });
  it("emits a size delta only when both areas are known", () => {
    const known = buildAttrDeltas(subjDelta, { beds: 3, baths: 2, price: 1_000_000, area: 1900 });
    expect(known.find((x) => x.kind === "size")?.label).toBe("+400 sqft");
    const missing = buildAttrDeltas(subjDelta, { beds: 3, baths: 2, price: 1_000_000, area: 0 });
    expect(missing.find((x) => x.kind === "size")).toBeUndefined();
  });
});

// ── Commercial comps (commercial-gap Phase 1) ──
// (buildForSaleSimilarFilter / buildWhyLabel / the attr types are already imported above)
import { scoreForSaleCommercial } from "./similarListings";

const COMMERCIAL_SUBJECT: SubjectAttrs = {
  id: "W1",
  cityRegion: "Islington-City Centre West",
  city: "Toronto W08",
  subType: "Industrial",
  beds: 0,
  bedsAbove: 0,
  bedsBelow: 0,
  garage: null,
  listPrice: 3_999_000,
  area: 3500,
};

const commercialCand = (over: Partial<CandidateAttrs>): CandidateAttrs => ({
  cityRegion: "Islington-City Centre West",
  subType: "Industrial",
  beds: 0,
  bedsAbove: 0,
  bedsBelow: 0,
  garage: null,
  price: 3_999_000,
  area: 3500,
  ...over,
});

describe("commercial comps", () => {
  it("family wall for commercial subtypes is exact-spelling (Office never comps Retail)", () => {
    expect(buildForSaleSimilarFilter(COMMERCIAL_SUBJECT)).toContain(
      "PropertySubType:=`Industrial`"
    );
    expect(buildForSaleSimilarFilter(COMMERCIAL_SUBJECT)).not.toContain("Detached");
  });

  it("lease subjects comp against For-Lease inventory", () => {
    expect(buildForSaleSimilarFilter(COMMERCIAL_SUBJECT, { lease: true })).toContain(
      "TransactionType:=`For Lease`"
    );
  });

  it("lease subjects query closed LEASES, not sales (DealType leased)", () => {
    const now = 1_750_000_000_000;
    expect(buildSoldSimilarFilter(COMMERCIAL_SUBJECT, 180, now, { lease: true })).toContain(
      "DealType:=leased"
    );
    // Default stays sold — residential sale pages unchanged
    expect(buildSoldSimilarFilter(COMMERCIAL_SUBJECT, 180, now)).toContain("DealType:=sold");
  });

  it("why-label says 'leased Nd ago' for lease comps", () => {
    const label = buildWhyLabel(
      COMMERCIAL_SUBJECT,
      commercialCand({ daysAgo: 12 }),
      "sold",
      { leased: true }
    );
    expect(label).toContain("leased 12d ago");
    expect(label).not.toContain("sold 12d ago");
  });

  it("commercial scorer ranks closer area above closer beds/garage", () => {
    const sameArea = scoreForSaleCommercial(COMMERCIAL_SUBJECT, commercialCand({}));
    const halfArea = scoreForSaleCommercial(COMMERCIAL_SUBJECT, commercialCand({ area: 1750 }));
    const noArea = scoreForSaleCommercial(COMMERCIAL_SUBJECT, commercialCand({ area: 0 }));
    expect(sameArea).toBeGreaterThan(noArea); // neutral 0.5 when unknown
    expect(noArea).toBeGreaterThan(halfArea - 40); // sanity: no crash weighting
    expect(sameArea).toBeGreaterThan(halfArea);
  });

  it("why-label uses the raw subtype for unmapped (commercial) types, no 0bd chip", () => {
    const label = buildWhyLabel(COMMERCIAL_SUBJECT, commercialCand({}), "sale");
    expect(label).toContain("Industrial");
    expect(label).not.toContain("0bd");
  });
});
