import { describe, it, expect, vi, beforeEach } from "vitest";

const counts = vi.fn();
/** Outage switch handled OUTSIDE the spy: a `vi.fn()` that throws has its error recorded
 *  and re-surfaced by the runner even when the code under test catches it. */
let outage: "none" | "sync" | "async" = "none";
vi.mock("@/lib/typesense/client", () => ({
  searchClauseCounts: (args: { baseFilterBy: string; clauses: string[] }) => {
    if (outage === "sync") throw new Error("typesense down");
    if (outage === "async") return Promise.reject(new Error("typesense timeout"));
    return counts(args);
  },
}));

const { regionResolves } = await import("./regionResolves");

describe("regionResolves", () => {
  beforeEach(() => {
    counts.mockReset();
    outage = "none";
  });

  /**
   * The shapes real users have saved. Every one of these must survive — a regex guard
   * (leading digits, length, punctuation) would reject the Barrhaven CityRegion along
   * with the street address, and strip Toronto's district codes.
   */
  it.each([
    ["Toronto C01", "(City:=`Toronto C01` || CityRegion:=`Toronto C01`)"],
    ["7711 - Barrhaven - Half Moon Bay", "(City:=`7711 - Barrhaven - Half Moon Bay` || CityRegion:=`7711 - Barrhaven - Half Moon Bay`)"],
    ["High Park-Swansea", "(City:=`High Park-Swansea` || CityRegion:=`High Park-Swansea`)"],
    ["Burlington", "(City:=`Burlington` || CityRegion:=`Burlington`)"],
  ])("accepts %s and asks areaFilter's own expression", async (label, clause) => {
    counts.mockResolvedValue([138]);
    expect(await regionResolves(label)).toBe(true);
    expect(counts).toHaveBeenCalledWith({ baseFilterBy: "", clauses: [clause] });
  });

  it("accepts a CITY_GROUPS parent, which is not a feed value at all", async () => {
    counts.mockResolvedValue([2165]);
    expect(await regionResolves("London")).toBe(true);
    // Expanded to its members, not exact-matched — the parent name matches no City.
    expect(counts.mock.calls[0][0].clauses[0]).toBe(
      "City:=[`London`, `London North`, `London South`, `London East`, `London West`]"
    );
  });

  it("rejects a street address — the 2026-08-08 save that emptied a section", async () => {
    counts.mockResolvedValue([0]);
    expect(await regionResolves("7725 shagbark avenue niagara falls ON L2H 3R9")).toBe(false);
  });

  it("rejects blank input without a round-trip", async () => {
    expect(await regionResolves("   ")).toBe(false);
    expect(counts).not.toHaveBeenCalled();
  });

  // getTypesenseClient() throws SYNCHRONOUSLY when the search key is missing at build time;
  // a live cluster times out asynchronously. Both must fail OPEN.
  it("FAILS OPEN on a synchronous throw — an outage must not block a real market", async () => {
    outage = "sync";
    expect(await regionResolves("Burlington")).toBe(true);
  });

  it("FAILS OPEN on a rejected search too", async () => {
    outage = "async";
    expect(await regionResolves("Burlington")).toBe(true);
  });
});
