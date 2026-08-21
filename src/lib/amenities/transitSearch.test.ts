import { describe, it, expect } from "vitest";
import { rankStations, normalizeStationQuery, type TransitStation } from "./transitSearch";

// Real rows from data/gta-amenities.json.
const S = (name: string, lat = 43.8, lng = -79.0, address = ""): TransitStation => ({
  id: name, name, lat, lng, address,
});
const ALL = [
  S("Ajax GO Station", 43.8503, -79.0271, "Ajax"),
  S("Aurora GO Station"),
  S("Oakville GO Station", 43.4555, -79.6822, "Oakville"),
  S("Bramalea GO Station"),
  S("Union Station", 43.6454, -79.3807, "65 Front St W, Toronto, M5J 1E6"),
  S("Union Station Toronto", 43.6459, -79.3801),
  S("Union Station Train Terminal", 43.6461, -79.3799),
  S("Unionville GO Station", 43.8636, -79.3113, "7970 Kennedy Rd, Markham"),
  S("Kennedy GO"),
  S("Hamilton GO Centre"),
];

describe("transit station search", () => {
  it("answers the query Mapbox cannot — the exact phrase 'Ajax GO Station'", () => {
    // Search Box returns two short-term-rental listings for this and never the station.
    expect(rankStations(ALL, "Ajax GO Station")[0].name).toBe("Ajax GO Station");
  });

  it.each(["ajax go", "ajax station", "AJAX", "ajax go stn"])(
    "reaches the same station from %s",
    (q) => {
      expect(rankStations(ALL, q)[0].name).toBe("Ajax GO Station");
    }
  );

  it("prefers the plain record over a longer alias of the same station", () => {
    const out = rankStations(ALL, "union station");
    expect(out[0].name).toBe("Union Station");
  });

  it("collapses aliases that the build's 250m sweep could not reach", () => {
    // "Union Station", "Union Station Toronto" and "Union Station Train Terminal" are one
    // building filed three ways; Overture's coordinates are far enough apart to survive
    // the geographic dedupe, so the search layer folds them on the normalized name.
    const names = rankStations(ALL, "union").map((r) => r.name);
    expect(names).toContain("Union Station");
    expect(names).not.toContain("Union Station Toronto");
    // Unionville is a DIFFERENT station and must not be folded away.
    expect(names).toContain("Unionville GO Station");
  });

  it("folds an identical name even when Overture puts it 13km away", () => {
    // Live data: "Union Station Toronto" appears twice, 3.6km and 13.6km from the real
    // platform. Neither is within the alias radius, so only the exact-name rule catches it.
    const dupes = [
      S("Union Station", 43.6454, -79.3807),
      S("Union Station Toronto", 43.677, -79.39),
      S("Union Station Toronto", 43.76, -79.42),
    ];
    // One row, not two. "Union Station" itself is absent by design: the query carries
    // "toronto" and every query word must match, which is what keeps "union" off
    // "unionville" in the test above.
    expect(rankStations(dupes, "union station toronto").map((r) => r.name)).toEqual([
      "Union Station Toronto",
    ]);
  });

  it("matches on word prefixes, so a half-typed name still finds the station", () => {
    expect(rankStations(ALL, "bramal").map((r) => r.name)).toEqual(["Bramalea GO Station"]);
  });

  it("returns nothing for a query that is only filler", () => {
    // Without this, "go" or "station" alone would return every station in the GTA.
    expect(rankStations(ALL, "go")).toEqual([]);
    expect(rankStations(ALL, "station")).toEqual([]);
    expect(rankStations(ALL, "  ")).toEqual([]);
  });

  it("returns nothing for a place that is not a station", () => {
    expect(rankStations(ALL, "Yorkdale Mall")).toEqual([]);
    expect(rankStations(ALL, "123 Main Street")).toEqual([]);
  });

  it("requires EVERY query word, so one shared word cannot match", () => {
    // "go" and "station" are stripped, leaving "hamilton" — Kennedy GO must not match.
    expect(rankStations(ALL, "hamilton go station").map((r) => r.name)).toEqual(["Hamilton GO Centre"]);
  });

  it("strips the words riders drop or add without thinking", () => {
    expect(normalizeStationQuery("Ajax GO Station")).toEqual(["ajax"]);
    expect(normalizeStationQuery("the transit stn")).toEqual([]);
  });

  it("honours the limit", () => {
    expect(rankStations(ALL, "o", 2).length).toBeLessThanOrEqual(2);
  });
});
