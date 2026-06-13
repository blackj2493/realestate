import { describe, it, expect } from "vitest";
import {
  TERMS,
  GLOSSARY_GROUPS,
  term,
  termsByGroup,
  buildTipContent,
  glossaryHref,
  NOT_MLS_LINE,
  type TermId,
} from "./terms";

const ALL_IDS = Object.keys(TERMS) as TermId[];

describe("term registry integrity", () => {
  it("every entry has non-empty name, subtitle, definition", () => {
    for (const id of ALL_IDS) {
      const t = TERMS[id];
      expect(t.id, `id key matches entry for ${id}`).toBe(id);
      expect(t.name.trim().length, `name for ${id}`).toBeGreaterThan(0);
      expect(t.subtitle.trim().length, `subtitle for ${id}`).toBeGreaterThan(0);
      expect(t.definition.trim().length, `definition for ${id}`).toBeGreaterThan(0);
    }
  });

  it("subtitles stay short (<= 40 chars) so they fit tight surfaces", () => {
    for (const id of ALL_IDS) {
      expect(TERMS[id].subtitle.length, `subtitle length for ${id}`).toBeLessThanOrEqual(40);
    }
  });

  it("every term's group is a declared glossary group", () => {
    const groupIds = new Set(GLOSSARY_GROUPS.map((g) => g.id));
    for (const id of ALL_IDS) {
      expect(groupIds.has(TERMS[id].group), `group for ${id}`).toBe(true);
    }
  });

  it("no duplicate names within a group", () => {
    for (const g of GLOSSARY_GROUPS) {
      const names = Object.values(TERMS)
        .filter((t) => t.group === g.id)
        .map((t) => t.name.toLowerCase());
      expect(new Set(names).size, `unique names in ${g.id}`).toBe(names.length);
    }
  });

  it("term() throws on unknown id", () => {
    // @ts-expect-error intentional bad id
    expect(() => term("nope")).toThrow();
  });

  it("termsByGroup partitions all terms with no loss", () => {
    const grouped = termsByGroup();
    const flat = GLOSSARY_GROUPS.flatMap((g) => grouped[g.id]);
    expect(flat.length).toBe(ALL_IDS.length);
  });
});

describe("buildTipContent", () => {
  it("includes the compliance line only for notMls terms", () => {
    expect(buildTipContent("trueValue").notMlsLine).toBe(NOT_MLS_LINE);
    expect(buildTipContent("monthsOfSupply").notMlsLine).toBeNull();
  });

  it("links to the term's glossary anchor", () => {
    expect(buildTipContent("trueDom").href).toBe(glossaryHref("trueDom"));
    expect(glossaryHref("trueDom")).toBe("/glossary#trueDom");
  });

  it("pins canonical copy for the renamed terms", () => {
    expect(term("capRate").name).toBe("Cap Rate");
    expect(term("carryCost").name).toBe("Carry Cost");
    expect(term("suitePotential").name).toBe("Suite Potential");
    expect(term("densityReady").name).toBe("Density Ready");
    expect(term("listingDensity").name).toBe("Listing Density");
  });
});
