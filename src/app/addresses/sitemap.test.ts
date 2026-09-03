import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sold/soldByKey", () => ({
  getSoldSitemapEntries: vi.fn(),
}));

import { getSoldSitemapEntries } from "@/lib/sold/soldByKey";
import { buildAddressPath } from "@/lib/listings/listingPath";
import sitemap from "./sitemap";

const entry = (over: Partial<{ id: string; address: string; city: string }> = {}) => ({
  id: "E12801884",
  address: "2545 Simcoe Street PH20, Oshawa, ON L1H 7K4",
  city: "Oshawa",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("/addresses/sitemap.xml", () => {
  it("emits the SAME path the in-page links build", async () => {
    const e = entry();
    vi.mocked(getSoldSitemapEntries).mockResolvedValue([e]);

    const [row] = await sitemap();
    // The whole point of the shared builder: a sitemap URL no link can reproduce is what
    // left the address tree reachable only from this file.
    expect(row.url).toBe(`https://www.pureproperty.ca${buildAddressPath(e)}`);
    expect(row.url).toBe("https://www.pureproperty.ca/address/on/oshawa/2545-simcoe-street-ph20-E12801884");
  });

  it("collapses a Toronto district code to the hub slug", async () => {
    vi.mocked(getSoldSitemapEntries).mockResolvedValue([
      entry({ id: "C12115995", address: "33 Mill Street 2303, Toronto C08, ON M5A 3R3", city: "Toronto C08" }),
    ]);

    const [row] = await sitemap();
    expect(row.url).toBe("https://www.pureproperty.ca/address/on/toronto/33-mill-street-2303-C12115995");
  });

  it("drops a record with no usable city rather than emitting a 404 URL", async () => {
    vi.mocked(getSoldSitemapEntries).mockResolvedValue([entry({ city: "" }), entry()]);

    const rows = await sitemap();
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toContain("/address/on/oshawa/");
  });
});
