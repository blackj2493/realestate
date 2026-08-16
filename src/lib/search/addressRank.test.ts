import { describe, it, expect } from "vitest";
import { scoreAddressSuggestion, rankAddressSuggestions } from "./addressRank";

describe("scoreAddressSuggestion", () => {
  const query = "16 Elm Grove Ave";

  it("scores the typed address higher than a same-number, different-street lookalike", () => {
    expect(scoreAddressSuggestion(query, "16 Elm Grove Ave, Toronto")).toBeGreaterThan(
      scoreAddressSuggestion(query, "16 Steel Street, Barrie")
    );
  });

  it("scores the typed address higher than a shared-word, different-number lookalike", () => {
    expect(scoreAddressSuggestion(query, "16 Elm Grove Ave, Toronto")).toBeGreaterThan(
      scoreAddressSuggestion(query, "4861 Half Moon Grove, Mississauga")
    );
  });

  it("penalises a different civic number below one that shares only a street word", () => {
    // "16 Steel Street" keeps the typed house number; "4861 Half Moon Grove" only
    // shares the word "Grove" and has the wrong number — it should rank lowest.
    expect(scoreAddressSuggestion(query, "16 Steel Street, Barrie")).toBeGreaterThan(
      scoreAddressSuggestion(query, "4861 Half Moon Grove, Mississauga")
    );
  });

  it("rewards an exact whole-string prefix", () => {
    // Same tokens, but one label leads with the exact typed string.
    expect(scoreAddressSuggestion(query, "16 Elm Grove Ave, Toronto")).toBeGreaterThan(
      scoreAddressSuggestion(query, "Toronto — 16 Elm Grove Ave")
    );
  });

  it("is order-insensitive to punctuation/case", () => {
    expect(scoreAddressSuggestion("16 elm grove ave", "16 ELM GROVE AVE, Toronto")).toBe(
      scoreAddressSuggestion("16 Elm Grove Ave", "16 Elm Grove Ave, Toronto")
    );
  });

  it("returns 0 for empty input", () => {
    expect(scoreAddressSuggestion("", "16 Elm Grove Ave")).toBe(0);
    expect(scoreAddressSuggestion("16 Elm", "")).toBe(0);
  });
});

describe("rankAddressSuggestions", () => {
  it("floats the closest match to the front regardless of input order", () => {
    const input = [
      { label: "16 Steel Street, Barrie" },
      { label: "4861 Half Moon Grove, Mississauga" },
      { label: "16 Elm Grove Ave, Toronto" },
    ];
    const ranked = rankAddressSuggestions("16 Elm Grove Ave", input, (c) => c.label);
    expect(ranked[0].label).toBe("16 Elm Grove Ave, Toronto");
  });

  it("is a stable sort for equal scores (keeps Typesense order)", () => {
    // Two identical labels: original relative order must be preserved.
    const a = { id: 1, label: "10 Main St, Ottawa" };
    const b = { id: 2, label: "10 Main St, Ottawa" };
    const ranked = rankAddressSuggestions("10 Main St", [a, b], (c) => c.label);
    expect(ranked.map((c) => c.id)).toEqual([1, 2]);
  });
});
