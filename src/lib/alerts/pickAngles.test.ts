import { describe, expect, it } from "vitest";
import {
  PERSONA_ANGLES,
  angleReason,
  angleSubjectPhrase,
  pickAngles,
  type AngleCandidate,
  type ListingSignals,
} from "./pickAngles";

const NOW = Date.UTC(2026, 9, 6);
const DAY = 86_400_000;

function cand(key: string, over: Partial<AngleCandidate> = {}, signals: ListingSignals = {}): AngleCandidate {
  return { listing_key: key, entryMs: NOW - DAY, score: null, priceCut: null, signals, ...over };
}

describe("pickAngles", () => {
  it("orders sections by persona, homebuyer first-class", () => {
    const pool = [
      cand("cut", { priceCut: 80_000 }),
      cand("suite", {}, { suiteStatus: "POTENTIAL_CANDIDATE", suiteScore: 4 }),
      cand("cheap", {}, { burnMonthly: 2_600 }),
      cand("stale", {}, { trueDom: 140 }),
      cand("rent", {}, { capRate: 6.2 }),
      cand("lot", {}, { lotWidthFt: 60, lotDepthFt: 132 }),
    ];
    expect(pickAngles(pool, "smart", NOW).map((p) => p.angle)).toEqual([...PERSONA_ANGLES.smart]);
    expect(pickAngles(pool, "cashflow", NOW).map((p) => p.listing.listing_key)).toEqual([
      "rent",
      "cheap",
      "suite",
      "cut",
    ]);
    expect(pickAngles(pool, "builders", NOW)[0].listing.listing_key).toBe("lot");
  });

  it("uses each listing once, so four sections are four homes", () => {
    // One home wins every angle; the next-best qualifier must take the later ones.
    const star = cand("star", { priceCut: 90_000 }, { suiteStatus: "EXISTING_SUITE", burnMonthly: 2_000 });
    const pool = [star, cand("b", {}, { suiteStatus: "POTENTIAL_CANDIDATE" }), cand("c", {}, { burnMonthly: 3_000 })];
    const picks = pickAngles(pool, "smart", NOW);
    expect(picks.map((p) => p.listing.listing_key)).toEqual(["star", "b", "c"]);
  });

  it("skips an angle with no qualifier instead of padding", () => {
    const picks = pickAngles([cand("cut", { priceCut: 20_000 })], "smart", NOW);
    expect(picks).toHaveLength(1);
    expect(picks[0].angle).toBe("price_cut");
    expect(pickAngles([cand("plain")], "smart", NOW)).toEqual([]);
  });

  it("prefers an existing suite over a higher-scored candidate", () => {
    const pool = [
      cand("cand", {}, { suiteStatus: "POTENTIAL_CANDIDATE", suiteScore: 5 }),
      cand("exist", {}, { suiteStatus: "EXISTING_SUITE", suiteScore: 6 }),
      cand("none", {}, { suiteStatus: "NONE", suiteScore: 6 }),
    ];
    expect(pickAngles(pool, "smart", NOW)[0].listing.listing_key).toBe("exist");
  });

  it("drops burn figures outside the plausible band", () => {
    const pool = [cand("locker", {}, { burnMonthly: 120 }), cand("home", {}, { burnMonthly: 2_900 })];
    const low = pickAngles(pool, "smart", NOW).find((p) => p.angle === "low_cost");
    expect(low?.listing.listing_key).toBe("home");
  });

  it("negotiate needs True DOM well past the current listing's own age", () => {
    const pool = [
      // Old listing, honestly old: its True DOM is just its own age. Not hidden.
      cand("honest", { entryMs: NOW - 100 * DAY }, { trueDom: 100 }),
      // Listed yesterday, on the market 140 days across relists.
      cand("relist", { entryMs: NOW - DAY }, { trueDom: 140 }),
    ];
    const neg = pickAngles(pool, "flippers", NOW).find((p) => p.angle === "negotiate");
    expect(neg?.listing.listing_key).toBe("relist");
  });

  it("ignores out-of-band cap rates and acreage frontages", () => {
    const pool = [cand("junk", {}, { capRate: 42 }), cand("acre", {}, { lotWidthFt: 900 })];
    expect(pickAngles(pool, "cashflow", NOW)).toEqual([]);
    expect(pickAngles(pool, "builders", NOW)).toEqual([]);
  });

  it("breaks ties by the value ranking, then newest", () => {
    const pool = [
      cand("older", { priceCut: 50_000, entryMs: NOW - 2 * DAY }),
      cand("newer", { priceCut: 50_000, entryMs: NOW - DAY }),
      cand("scored", { priceCut: 50_000, entryMs: NOW - 3 * DAY, score: 0.1 }),
    ];
    expect(pickAngles(pool, "smart", NOW)[0].listing.listing_key).toBe("scored");
  });
});

describe("angleReason", () => {
  it("prints IDX figures in full", () => {
    expect(angleReason({ angle: "price_cut", listing: cand("a", { priceCut: 80_000 }) })).toEqual({
      text: "Cut $80,000 since it first listed",
      tone: "cut",
    });
    expect(angleReason({ angle: "low_cost", listing: cand("a", {}, { burnMonthly: 2_612.4 }) }).text).toBe(
      "About $2,612/mo to own"
    );
    expect(
      angleReason({ angle: "land", listing: cand("a", {}, { lotWidthFt: 60, lotDepthFt: 132, severance: true }) }).text
    ).toBe("60 × 132 ft lot · possible severance");
  });

  it("describes the basement from its feed tokens", () => {
    const r = angleReason({
      angle: "suite",
      listing: cand("a", {}, { suiteStatus: "POTENTIAL_CANDIDATE", basement: ["Finished", "Separate Entrance"] }),
    });
    expect(r.text).toBe("Separate entrance + finished basement");
    expect(
      angleReason({ angle: "suite", listing: cand("a", {}, { suiteStatus: "POTENTIAL_CANDIDATE", basement: [] }) }).text
    ).toBe("Layout suits a basement suite");
  });

  it("never prints the VOW-derived figures that order two of the angles", () => {
    const neg = angleReason({ angle: "negotiate", listing: cand("a", {}, { trueDom: 187 }) });
    const rent = angleReason({ angle: "rental", listing: cand("a", {}, { capRate: 6.4 }) });
    expect(neg.tone).toBe("lock");
    expect(rent.tone).toBe("lock");
    expect(neg.text).not.toMatch(/187/);
    expect(rent.text).not.toMatch(/6\.4/);
  });
});

describe("angleSubjectPhrase", () => {
  it("picks the article by how the figure is said", () => {
    const cut = (n: number) => angleSubjectPhrase({ angle: "price_cut", listing: cand("a", { priceCut: n }) });
    expect(cut(80_000)).toBe("an $80K price cut");
    expect(cut(11_000)).toBe("an $11K price cut");
    expect(cut(110_000)).toBe("a $110K price cut");
    expect(cut(25_000)).toBe("a $25K price cut");
  });
});
