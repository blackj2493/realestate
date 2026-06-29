import { describe, it, expect } from "vitest";
import { parseNlQuery } from "./nlParse";
import { chipsToSearchParams, paramsToChips, hasStructuredParams } from "./chipUrl";
import type { ChipKind, ParsedChip } from "./types";

const byKind = (chips: ParsedChip[], kind: ChipKind) => chips.find((c) => c.kind === kind);

describe("chipUrl", () => {
  it("serializes parsed chips to the expected param schema", () => {
    const { chips } = parseNlQuery("4 bed townhouse under 900k in richmond hill");
    const p = chipsToSearchParams(chips);
    expect(p.get("city")).toBe("Richmond Hill");
    expect(p.get("beds")).toBe("4");
    expect(p.get("maxPrice")).toBe("900000");
    expect(p.get("type")).toBe("Att/Row/Townhouse");
  });

  it("round-trips a rich query through params back to equivalent chips", () => {
    const original = parseNlQuery(
      "3 bed 2 bath under 800k near top schools in hamilton with a finished basement"
    ).chips;
    const restored = paramsToChips(chipsToSearchParams(original));

    // Value-equality on every parser-owned field (labels are cosmetic, ignored by syncChips).
    expect(byKind(restored, "beds")?.value).toBe(3);
    expect(byKind(restored, "baths")?.value).toBe(2);
    expect(byKind(restored, "priceMax")?.value).toBe(800_000);
    expect(byKind(restored, "school")?.value).toBe(8);
    expect(byKind(restored, "basement")?.value).toEqual(["Finished"]);
    expect(byKind(restored, "location")?.value).toBe("Hamilton");
  });

  it("preserves multi-value home types through a comma-joined param", () => {
    const chips: ParsedChip[] = [
      { id: "homeType:x", kind: "homeType", label: "x", value: ["Detached", "Semi-Detached "] },
    ];
    const restored = paramsToChips(chipsToSearchParams(chips));
    expect(byKind(restored, "homeType")?.value).toEqual(["Detached", "Semi-Detached "]);
  });

  it("treats price-band, stale and drop motivation chips as structured", () => {
    const p = chipsToSearchParams(parseNlQuery("motivated sellers with price drops").chips);
    expect(p.get("stale")).toBe("1");
    expect(p.get("priceDrop")).toBeTruthy();
    expect(hasStructuredParams(p)).toBe(true);
  });

  it("does not treat a bare place link as structured", () => {
    const placeOnly = new URLSearchParams({ city: "Milton" });
    expect(hasStructuredParams(placeOnly)).toBe(false);
    // …but it still reconstructs the location chip so the terminal can fit to it.
    expect(byKind(paramsToChips(placeOnly), "location")?.value).toBe("Milton");
  });

  it("tolerates the legacy ?search= place param", () => {
    expect(byKind(paramsToChips(new URLSearchParams({ search: "Burlington" })), "location")?.value).toBe(
      "Burlington"
    );
  });
});
