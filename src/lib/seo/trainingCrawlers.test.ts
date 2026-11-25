import { describe, expect, it } from "vitest";
import { isTrainingCrawler, shouldShedCrawler } from "./trainingCrawlers";

const CLAUDEBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const META = "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)";

describe("trainingCrawlers", () => {
  it("matches the bulk training crawlers only", () => {
    for (const ua of [CLAUDEBOT, GPTBOT, META, "meta-webindexer/1.0"]) expect(isTrainingCrawler(ua)).toBe(true);
    for (const ua of [
      "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +searchbot@anthropic.com)",
      "Mozilla/5.0 (compatible; Claude-User/1.0)",
      "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
      "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
      "Mozilla/5.0 (compatible; PerplexityBot/1.0)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
      "",
      null,
    ])
      expect(isTrainingCrawler(ua)).toBe(false);
  });

  it("sheds them only on the Typesense-heavy pages", () => {
    expect(shouldShedCrawler("/address/on/toronto/298-empress-avenue-C12393892", CLAUDEBOT)).toBe(true);
    expect(shouldShedCrawler("/properties/C12393892", GPTBOT)).toBe(true);
    expect(shouldShedCrawler("/property/on/toronto/12-main-st-C12393892", META)).toBe(true);
    // Data pages, city hubs and the rest stay open to them (AI knowledge of our data).
    for (const p of ["/data/housing-market/london", "/property/on/london", "/properties", "/power-of-sale/barrie", "/home-value/london", "/"])
      expect(shouldShedCrawler(p, CLAUDEBOT)).toBe(false);
  });

  it("never sheds a person or a search bot", () => {
    expect(shouldShedCrawler("/address/on/toronto/x-C1", "Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(false);
    expect(shouldShedCrawler("/address/on/toronto/x-C1", "Mozilla/5.0 (compatible; OAI-SearchBot/1.0)")).toBe(false);
    expect(shouldShedCrawler("/address/on/toronto/x-C1", null)).toBe(false);
  });
});
