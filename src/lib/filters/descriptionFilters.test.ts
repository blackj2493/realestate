import { describe, expect, it } from "vitest";
import {
  DESC_SIGNALS_FILTER,
  DESC_SIGNALS_KEY,
  DESC_WORDS_FILTER,
  DESC_WORDS_KEY,
  addTerm,
  descriptionRowFor,
  descTerms,
  descriptionTextQuery,
  hasOnlyExclusions,
  isDescriptionFilterActive,
  locationFilterClause,
  removeTerm,
  snippetParts,
  toggleTerm,
} from "./descriptionFilters";
import { buildUniversalFilterString, makeDefaultUniversalFilters } from "./filterRegistry";

describe("terms", () => {
  it("keeps a typed phrase as one term, lower-cased, quotes stripped", () => {
    expect(addTerm([], '"Separate  Entrance"')).toEqual(["separate entrance"]);
    expect(addTerm([], "-Tenanted")).toEqual(["-tenanted"]);
    expect(addTerm([], "   ")).toEqual([]);
  });

  it("replaces a duplicate instead of stacking it, and caps the list", () => {
    expect(addTerm(["walk-out", "-pool"], "pool")).toEqual(["walk-out", "pool"]);
    const many = ["a1", "b2", "c3", "d4", "e5", "f6"];
    expect(addTerm(many, "g7")).toEqual(["b2", "c3", "d4", "e5", "f6", "g7"]);
  });

  it("toggles and removes by text", () => {
    expect(toggleTerm(["walk-out", "-tenanted"], "tenanted")).toEqual(["walk-out", "tenanted"]);
    expect(removeTerm(["walk-out", "-tenanted"], "walk-out")).toEqual(["-tenanted"]);
    expect(descTerms(["", 7 as unknown as string, "pool"])).toEqual([{ text: "pool", exclude: false }]);
  });
});

describe("descriptionTextQuery", () => {
  const uf = (words: string[]) => ({ ...makeDefaultUniversalFilters(), [DESC_WORDS_KEY]: words });

  it("quotes phrases and prefixes exclusions", () => {
    expect(descriptionTextQuery(uf(["separate entrance", "walk-out", "-tenanted"]))).toBe(
      '"separate entrance" walk-out -tenanted'
    );
  });

  it("holds exclusions until there is something to look for", () => {
    expect(descriptionTextQuery(uf(["-tenanted"]))).toBeNull();
    expect(hasOnlyExclusions(uf(["-tenanted"]))).toBe(true);
    expect(descriptionTextQuery(uf([]))).toBeNull();
    expect(hasOnlyExclusions(uf([]))).toBe(false);
  });
});

describe("filter defs", () => {
  it("ANDs signals into filter_by", () => {
    expect(DESC_SIGNALS_FILTER.buildClause(["separate_entrance", "walkout_basement"])).toBe(
      "description_signals:=`separate_entrance` && description_signals:=`walkout_basement`"
    );
    expect(DESC_SIGNALS_FILTER.buildClause(["not_a_signal"])).toBeNull();
    expect(DESC_SIGNALS_FILTER.chipLabel(["separate_entrance"])).toBe("Separate entrance");
  });

  it("never puts words into filter_by", () => {
    const values = { ...makeDefaultUniversalFilters(), [DESC_WORDS_KEY]: ["walk-out"], [DESC_SIGNALS_KEY]: ["tenanted"] };
    expect(buildUniversalFilterString(values)).toBe("description_signals:=`tenanted`");
    expect(DESC_WORDS_FILTER.isActive(["-tenanted"])).toBe(false);
    expect(DESC_WORDS_FILTER.chipLabel(["walk-out", "-tenanted"])).toBe("Mentions “walk-out” · Not “tenanted”");
  });
});

describe("snippetParts", () => {
  it("splits marked runs without any HTML", () => {
    expect(snippetParts("with ⟦separate entrance⟧ and <b>")).toEqual([
      { text: "with ", hit: false },
      { text: "separate entrance", hit: true },
      { text: " and <b>", hit: false },
    ]);
  });
});


describe("locationFilterClause", () => {
  it("turns a place into a City / CityRegion match, dropping the province", () => {
    expect(locationFilterClause("Hamilton, ON")).toBe("(City:`Hamilton` || CityRegion:`Hamilton`)");
    expect(locationFilterClause("")).toBeNull();
    expect(locationFilterClause("*")).toBeNull();
    expect(locationFilterClause("Bad`Tick")).toBe("(City:`BadTick` || CityRegion:`BadTick`)");
  });
});

describe("isDescriptionFilterActive", () => {
  const base = makeDefaultUniversalFilters();
  it("is on for a signal or a word to look for, off for exclusions alone", () => {
    expect(isDescriptionFilterActive(base)).toBe(false);
    expect(isDescriptionFilterActive({ ...base, [DESC_SIGNALS_KEY]: ["tenanted"] })).toBe(true);
    expect(isDescriptionFilterActive({ ...base, [DESC_WORDS_KEY]: ["walk-out"] })).toBe(true);
    expect(isDescriptionFilterActive({ ...base, [DESC_WORDS_KEY]: ["-tenanted"] })).toBe(false);
  });
});

describe("descriptionRowFor", () => {
  const sig = (q: string) => (q.toLowerCase() === "sep entrance" ? { id: "separate_entrance", label: "Separate entrance" } : null);
  const sale = { structured: false, transactionMode: "sale" as const };

  it("offers nothing for addresses, MLS numbers, sentences or short input", () => {
    expect(descriptionRowFor("46 bosco", sale, sig)).toBeNull();
    expect(descriptionRowFor("W1234567", sale, sig)).toBeNull();
    expect(descriptionRowFor("3 bed under 800k in hamilton", { ...sale, structured: true }, sig)).toBeNull();
    expect(descriptionRowFor("a home with a big yard and a pool", sale, sig)).toBeNull();
    expect(descriptionRowFor("wa", sale, sig)).toBeNull();
  });

  it("prefers the signal, which carries every spelling", () => {
    expect(descriptionRowFor("sep entrance", sale, sig)).toEqual({
      kind: "signal",
      id: "separate_entrance",
      label: "Separate entrance",
    });
  });

  it("offers the words on a sale search, and the exclusion for a leading minus", () => {
    expect(descriptionRowFor("Walk-Out", sale, sig)).toEqual({ kind: "words", text: "walk-out", exclude: false });
    expect(descriptionRowFor("-tenanted", sale, sig)).toEqual({ kind: "words", text: "tenanted", exclude: true });
    expect(descriptionRowFor("walk-out", { ...sale, transactionMode: "rent" }, sig)).toBeNull();
  });
});
