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
});
