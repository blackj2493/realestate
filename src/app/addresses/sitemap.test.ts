import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sold/soldByKey", () => ({
  getSoldSitemapShard: vi.fn(),
}));

import { getSoldSitemapShard } from "@/lib/sold/soldByKey";
import { buildAddressPath } from "@/lib/listings/listingPath";
import { ADDRESS_SITEMAP_SHARDS, SHARD_URLS } from "@/lib/sold/addressSitemapShards";
import sitemap, { generateSitemaps } from "./sitemap";

const entry = (over: Partial<{ id: string; address: string; city: string }> = {}) => ({
  id: "E12801884",
  address: "2545 Simcoe Street PH20, Oshawa, ON L1H 7K4",
  city: "Oshawa",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("/addresses/sitemap/{n}.xml", () => {
  it("emits the SAME path the in-page links build", async () => {
    const e = entry();
    vi.mocked(getSoldSitemapShard).mockResolvedValue([e]);

    const [row] = await sitemap({ id: 0 });
    // The whole point of the shared builder: a sitemap URL no link can reproduce is what
    // left the address tree reachable only from this file.
    expect(row.url).toBe(`https://www.pureproperty.ca${buildAddressPath(e)}`);
    expect(row.url).toBe("https://www.pureproperty.ca/address/on/oshawa/2545-simcoe-street-ph20-E12801884");
  });

  it("collapses a Toronto district code to the hub slug", async () => {
    vi.mocked(getSoldSitemapShard).mockResolvedValue([
      entry({ id: "C12115995", address: "33 Mill Street 2303, Toronto C08, ON M5A 3R3", city: "Toronto C08" }),
    ]);

    const [row] = await sitemap({ id: 0 });
    expect(row.url).toBe("https://www.pureproperty.ca/address/on/toronto/33-mill-street-2303-C12115995");
  });

  it("drops a record with no usable city rather than emitting a 404 URL", async () => {
    vi.mocked(getSoldSitemapShard).mockResolvedValue([entry({ city: "" }), entry()]);

    const rows = await sitemap({ id: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toContain("/address/on/oshawa/");
  });

  it.each([
    ["a plain number", 3],
    ["a numeric string", "3"],
    ["the raw URL segment", "3.xml"],
    ["a PROMISE of the segment (Next 16 async params)", Promise.resolve("3.xml")],
    ["a promise of a number", Promise.resolve(3)],
    ["an object carrying it", { id: "3.xml" }],
  ])("resolves the shard index from %s", async (_label, id) => {
    vi.mocked(getSoldSitemapShard).mockResolvedValue([]);

    // Next TYPES this `number` and production handed it, in turn, a Promise (logged as
    // `{}`) and then "3.xml". Both multiplied to NaN and shipped seven EMPTY shards
    // while the build reported success. Accept every shape rather than trust the type.
    await sitemap({ id: id as unknown as number });
    expect(vi.mocked(getSoldSitemapShard).mock.calls[0][0]).toBe(3 * SHARD_URLS);
  });

  it("reads the id from the RAW URL SEGMENT (\"3.xml\"), not as a number", async () => {
    vi.mocked(getSoldSitemapShard).mockResolvedValue([]);

    // Next types this param `number` and then hands it "3.xml". Multiplying that gives
    // NaN, and all seven shards shipped EMPTY to production because of it — while the
    // build reported success, because the resulting query error was swallowed.
    await sitemap({ id: "3.xml" as unknown as number });
    expect(vi.mocked(getSoldSitemapShard).mock.calls[0][0]).toBe(3 * SHARD_URLS);
  });

  it("serves empty and says so for an id that is not a shard index", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSoldSitemapShard).mockResolvedValue([]);

    const rows = await sitemap({ id: "nope" as unknown as number });
    expect(rows).toEqual([]);
    expect(getSoldSitemapShard).not.toHaveBeenCalled(); // never query on a bad offset
    expect(err).toHaveBeenCalledWith(expect.stringContaining("not a shard index"));
  });

  it("rejects a shard index past the last file rather than querying past the end", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSoldSitemapShard).mockResolvedValue([]);

    await sitemap({ id: `${ADDRESS_SITEMAP_SHARDS}.xml` as unknown as number });
    expect(getSoldSitemapShard).not.toHaveBeenCalled();
  });

  it("asks for its OWN slice — shard n starts at n * SHARD_URLS", async () => {
    vi.mocked(getSoldSitemapShard).mockResolvedValue([]);

    await sitemap({ id: 3 });
    // Overlapping shards would declare the same URL in several files; a wrong stride
    // would leave a gap no file covers.
    const [offset, limit] = vi.mocked(getSoldSitemapShard).mock.calls[0];
    expect(offset).toBe(3 * SHARD_URLS);
    expect(limit).toBe(SHARD_URLS);
  });

  it("passes a YYYY-MM-DD window start, not a timestamp", async () => {
    vi.mocked(getSoldSitemapShard).mockResolvedValue([]);

    await sitemap({ id: 0 });
    // purchase_contract_date is a `date` column — a timestamp drags a timezone into the
    // boundary (see close-date handling elsewhere).
    expect(vi.mocked(getSoldSitemapShard).mock.calls[0][2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("enumerates every shard robots.txt names", async () => {
    const shards = await generateSitemaps();
    expect(shards).toHaveLength(ADDRESS_SITEMAP_SHARDS);
    expect(shards.map((s) => s.id)).toEqual([...Array(ADDRESS_SITEMAP_SHARDS).keys()]);
    // A file cannot exceed the sitemap protocol's 50,000-URL limit.
    expect(SHARD_URLS).toBeLessThanOrEqual(50_000);
  });
});
