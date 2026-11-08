import { describe, expect, it } from "vitest";
import { buildBodies, INDEXNOW_KEY, listingPath, nightlyPaths } from "./indexNow";

describe("buildBodies", () => {
  it("makes absolute, de-duplicated URLs on one host with the key location", () => {
    const [b] = buildBodies("https://www.pureproperty.ca/", ["/data", "/data", "property/on/markham"]);
    expect(b.host).toBe("www.pureproperty.ca");
    expect(b.key).toBe(INDEXNOW_KEY);
    expect(b.keyLocation).toBe(`https://www.pureproperty.ca/${INDEXNOW_KEY}.txt`);
    expect(b.urlList).toEqual(["https://www.pureproperty.ca/data", "https://www.pureproperty.ca/property/on/markham"]);
  });

  it("splits at 10,000 URLs per POST", () => {
    const paths = Array.from({ length: 10_001 }, (_, i) => `/properties/X${i}`);
    const bodies = buildBodies("https://www.pureproperty.ca", paths);
    expect(bodies.map((b) => b.urlList.length)).toEqual([10_000, 1]);
  });

  it("returns no body when there is nothing to send", () => {
    expect(buildBodies("https://www.pureproperty.ca", [])).toEqual([]);
  });
});

describe("listingPath", () => {
  it("prefers the stored canonical, else the key path", () => {
    expect(listingPath({ listing_key: "N1", sitemap_path: "/property/on/markham/1-main-st-N1" })).toBe("/property/on/markham/1-main-st-N1");
    expect(listingPath({ listing_key: "N1", sitemap_path: null })).toBe("/properties/N1");
    expect(listingPath({ listing_key: null, sitemap_path: null })).toBeNull();
  });
});

describe("nightlyPaths", () => {
  it("names the board city hubs and the /data trackers", () => {
    const p = nightlyPaths();
    expect(p).toContain("/property/on/markham");
    expect(p).toContain("/property/on/toronto");
    expect(p).toContain("/data/over-asking");
    expect(new Set(p).size).toBe(p.length);
  });
});
