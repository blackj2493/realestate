import { describe, expect, it } from "vitest";
import { appLink, coverageSentence, isProvince, resolveCity } from "./resolve";
import { cardText, priceOpinionLink } from "./cards";

describe("resolveCity", () => {
  it("matches a board city written in different ways", () => {
    expect(resolveCity("Markham")?.slug).toBe("markham");
    expect(resolveCity("markham, ON")?.slug).toBe("markham");
    expect(resolveCity("Markham Ontario")?.slug).toBe("markham");
    expect(resolveCity("  toronto ")?.city).toBe("Toronto");
  });
  it("keeps 'on' inside a word", () => {
    expect(resolveCity("Toronto, ON")?.slug).toBe("toronto");
  });
  it("returns null for a place outside the 15 cities", () => {
    expect(resolveCity("Sudbury")).toBeNull();
    expect(resolveCity("")).toBeNull();
    expect(resolveCity(null)).toBeNull();
  });
});

describe("isProvince", () => {
  it("treats empty and Ontario as the province", () => {
    expect(isProvince(undefined)).toBe(true);
    expect(isProvince("Ontario")).toBe(true);
    expect(isProvince("all of Ontario")).toBe(true);
    expect(isProvince("Markham")).toBe(false);
  });
});

describe("appLink", () => {
  it("tags the link for analytics", () => {
    const u = new URL(appLink("/home-value/markham", "price_opinion_link"));
    expect(u.pathname).toBe("/home-value/markham");
    expect(u.searchParams.get("utm_source")).toBe("assistant_app");
    expect(u.searchParams.get("utm_campaign")).toBe("price_opinion_link");
  });
});

describe("priceOpinionLink", () => {
  it("never carries a number and links to the city form", () => {
    const c = priceOpinionLink("Oakville");
    expect(c.cta.url).toContain("/home-value/oakville");
    expect(c.facts.join(" ")).not.toMatch(/\$\d/);
    expect(cardText(c)).toContain(c.cta.url);
  });
  it("falls back to the Ontario form", () => {
    expect(new URL(priceOpinionLink(null).cta.url).pathname).toBe("/home-value");
  });
});

describe("coverageSentence", () => {
  it("names the cities", () => {
    expect(coverageSentence()).toMatch(/Toronto/);
  });
});
