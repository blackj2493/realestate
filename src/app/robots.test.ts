import { describe, it, expect } from "vitest";
import robots, { SLOWED_CRAWLERS } from "./robots";
import { ADDRESS_SITEMAP_SHARDS } from "@/lib/sold/addressSitemapShards";
import { LISTING_SITEMAP_SHARDS } from "@/lib/listings/listingSitemapShards";

describe("robots.txt", () => {
  it("names EVERY address sitemap shard", () => {
    const { sitemap } = robots();
    const declared = (sitemap as string[]).filter((u) => u.includes("/addresses/sitemap/"));
    // A shard the route renders but robots.txt omits is a file Google never fetches.
    expect(declared).toHaveLength(ADDRESS_SITEMAP_SHARDS);
    for (let i = 0; i < ADDRESS_SITEMAP_SHARDS; i++) {
      expect(declared).toContain(`https://www.pureproperty.ca/addresses/sitemap/${i}.xml`);
    }
  });

  it("names EVERY listing sitemap shard", () => {
    const { sitemap } = robots();
    const declared = (sitemap as string[]).filter((u) => u.includes("/listings/sitemap/"));
    // Same invariant as the address shards, and the same one module feeds both sides.
    // A shard robots.txt omits is a file Google never fetches; one it names that the
    // route does not render is a 404 in Search Console.
    expect(declared).toHaveLength(LISTING_SITEMAP_SHARDS);
    for (let i = 0; i < LISTING_SITEMAP_SHARDS; i++) {
      expect(declared).toContain(`https://www.pureproperty.ca/listings/sitemap/${i}.xml`);
    }
  });

  it("declares the /data desk sitemap, which Search Console reports on separately", () => {
    const { sitemap } = robots();
    expect(sitemap as string[]).toContain("https://www.pureproperty.ca/data/sitemap.xml");
  });

  it("no longer points at the single unsharded file that no longer exists", () => {
    const { sitemap } = robots();
    expect(sitemap as string[]).not.toContain("https://www.pureproperty.ca/addresses/sitemap.xml");
    expect(sitemap as string[]).toContain("https://www.pureproperty.ca/sitemap.xml");
  });

  it("slows the bulk AI-training crawlers but keeps the same disallow list", () => {
    const rules = robots().rules as { userAgent: string | string[]; disallow?: string[]; crawlDelay?: number }[];
    const star = rules.find((r) => r.userAgent === "*")!;
    const slowed = rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes("ClaudeBot"))!;
    expect(slowed.crawlDelay).toBeGreaterThan(0);
    // A named group replaces "*" for that bot: a missing entry would open /api/ to it.
    expect(slowed.disallow).toEqual(star.disallow);
    expect(star.crawlDelay).toBeUndefined();
  });

  it("leaves the AI search/assistant agents at full speed (they drive citations)", () => {
    for (const ua of ["Claude-SearchBot", "Claude-User", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Googlebot"]) {
      expect(SLOWED_CRAWLERS).not.toContain(ua);
    }
  });
});
