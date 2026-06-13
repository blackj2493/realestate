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
  listPrice: 1_000_000,
  area: 1800,
};

const cand = (over: Partial<CandidateAttrs>): CandidateAttrs => ({
  cityRegion: "Bram East",
  subType: "Detached",
  beds: 3,
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
      cand({ cityRegion: "Bram West", beds: 1 }), // weak
      cand({}), // perfect
      cand({ cityRegion: "Bram East", beds: 4 }), // strong
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
