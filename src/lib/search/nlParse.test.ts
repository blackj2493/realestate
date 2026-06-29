import { describe, it, expect } from "vitest";
import { parseNlQuery } from "./nlParse";
import type { ChipKind } from "./types";

const byKind = (q: ReturnType<typeof parseNlQuery>, kind: ChipKind) =>
  q.chips.find((c) => c.kind === kind);

describe("parseNlQuery", () => {
  it("parses the canonical sentence into the right chips", () => {
    const q = parseNlQuery("3 bed under 800k near top schools in hamilton with a finished basement");
    expect(byKind(q, "beds")?.value).toBe(3);
    expect(byKind(q, "priceMax")?.value).toBe(800_000);
    expect(byKind(q, "school")?.value).toBe(8);
    expect(byKind(q, "basement")?.value).toEqual(["Finished"]);
    expect(byKind(q, "location")?.value).toBe("Hamilton");
    expect(q.isStructured).toBe(true);
  });

  it("handles bare thousands and explicit dollars", () => {
    expect(parseNlQuery("homes under 800").chips.find((c) => c.kind === "priceMax")?.value).toBe(800_000);
    expect(parseNlQuery("under $1.2m").chips.find((c) => c.kind === "priceMax")?.value).toBe(1_200_000);
    expect(parseNlQuery("over 500k").chips.find((c) => c.kind === "priceMin")?.value).toBe(500_000);
  });

  it("parses a between-range", () => {
    const q = parseNlQuery("between 700k and 900k");
    expect(byKind(q, "priceMin")?.value).toBe(700_000);
    expect(byKind(q, "priceMax")?.value).toBe(900_000);
  });

  it("maps property types to exact PropertySubType spellings", () => {
    expect(parseNlQuery("semi detached").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Semi-Detached "]);
    expect(parseNlQuery("townhouse").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Att/Row/Townhouse"]);
    expect(parseNlQuery("a condo").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Condo Apartment"]);
  });

  it("matches plural property types (the townhouses bug)", () => {
    // "townhouses with double car garage in richmond hill" must yield a Townhouse type.
    const q = parseNlQuery("townhouses with double car garage in richmond hill");
    expect(byKind(q, "homeType")?.value).toEqual(["Att/Row/Townhouse"]);
    expect(parseNlQuery("condos").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Condo Apartment"]);
    expect(parseNlQuery("duplexes").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Duplex"]);
  });

  it("resolves a compound type to one value, not three (consume on match)", () => {
    // "condo townhouse" is its own subtype — must NOT also fire Townhouse + Condo.
    expect(parseNlQuery("condo townhouse").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Condo Townhouse"]);
    // But two distinct types in one query are both kept.
    expect(parseNlQuery("condos and townhouses").chips.find((c) => c.kind === "homeType")?.value).toEqual([
      "Att/Row/Townhouse",
      "Condo Apartment",
    ]);
  });

  it("does not grab the bedroom digit as a price", () => {
    const q = parseNlQuery("4 bedroom detached");
    expect(byKind(q, "beds")?.value).toBe(4);
    expect(byKind(q, "priceMax")).toBeUndefined();
    expect(byKind(q, "priceMin")).toBeUndefined();
  });

  it("detects motivation signals", () => {
    expect(parseNlQuery("stale listings with a price drop").chips.map((c) => c.kind)).toEqual(
      expect.arrayContaining(["staleOnly", "priceDrop"])
    );
  });

  it("treats a lone place as non-structured (use normal place typeahead)", () => {
    const q = parseNlQuery("Hamilton");
    expect(q.isStructured).toBe(false);
  });

  it("parses a numeric school threshold", () => {
    expect(parseNlQuery("near 9 rated schools").chips.find((c) => c.kind === "school")?.value).toBe(9);
  });

  it("normalises number-words before a unit (double car garage → 2)", () => {
    expect(parseNlQuery("double car garage").chips.find((c) => c.kind === "parking")?.value).toBe(2);
    expect(parseNlQuery("three bedroom two washroom").chips.find((c) => c.kind === "beds")?.value).toBe(3);
    expect(parseNlQuery("three bedroom two washroom").chips.find((c) => c.kind === "baths")?.value).toBe(2);
    // …but not in a non-count context.
    expect(parseNlQuery("one of a kind home in milton").chips.find((c) => c.kind === "beds")).toBeUndefined();
  });

  it("parses number-THEN-keyword price without grabbing a bed digit", () => {
    expect(parseNlQuery("800k or less").chips.find((c) => c.kind === "priceMax")?.value).toBe(800_000);
    expect(parseNlQuery("over 1m").chips.find((c) => c.kind === "priceMin")?.value).toBe(1_000_000);
    // "3+ beds" must NOT be read as a $3k floor.
    const q = parseNlQuery("3+ beds in markham");
    expect(byKind(q, "beds")?.value).toBe(3);
    expect(byKind(q, "priceMin")).toBeUndefined();
  });

  it("maps the new basement + type synonyms to exact values", () => {
    expect(parseNlQuery("finished walkout basement").chips.find((c) => c.kind === "basement")?.value).toEqual([
      "Finished with Walk-Out",
    ]);
    expect(parseNlQuery("with a side entrance").chips.find((c) => c.kind === "basement")?.value).toEqual([
      "Separate Entrance",
    ]);
    expect(parseNlQuery("a loft").chips.find((c) => c.kind === "homeType")?.value).toEqual(["Condo Apartment"]);
  });

  it("reports unmatched words and stays empty when everything is read", () => {
    expect(parseNlQuery("townhouse with a pool in milton").unmatched).toContain("pool");
    expect(parseNlQuery("3 bed townhouse in milton").unmatched).toBe("");
  });
});
