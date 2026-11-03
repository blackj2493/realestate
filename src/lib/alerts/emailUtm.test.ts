import { describe, expect, it } from "vitest";
import { linkContent, tagEmailLinks, tagUrl } from "./emailUtm";

const L = "https://www.pureproperty.ca/properties/W1234567";

describe("tagUrl", () => {
  it("tags our own links with source, medium and content", () => {
    const u = new URL(tagUrl(L, "watchlist-digest"));
    expect(u.searchParams.get("utm_source")).toBe("watchlist-digest");
    expect(u.searchParams.get("utm_medium")).toBe("email");
    expect(u.searchParams.get("utm_content")).toBe("listing");
  });

  it("keeps existing query parameters", () => {
    const u = new URL(tagUrl("https://www.pureproperty.ca/dashboard?bubble=abc", "watchlist-digest"));
    expect(u.searchParams.get("bubble")).toBe("abc");
    expect(u.searchParams.get("utm_content")).toBe("dashboard");
  });

  it("never touches signed /api/ links, foreign hosts, or hand-tagged links", () => {
    const signed = "https://www.pureproperty.ca/api/email/unsubscribe?e=abc&s=sig";
    expect(tagUrl(signed, "watchlist-digest")).toBe(signed);
    expect(tagUrl("https://www.google.com/maps", "watchlist-digest")).toBe("https://www.google.com/maps");
    const hand = "https://www.pureproperty.ca/data/price-cuts?utm_source=data_drop&utm_medium=email";
    expect(tagUrl(hand, "data_drop")).toBe(hand);
  });

  it("turns a namespaced kind into a clean source", () => {
    expect(new URL(tagUrl(L, "confirmation:listing-alerts")).searchParams.get("utm_source")).toBe(
      "confirmation-listing-alerts",
    );
  });

  it("leaves a malformed URL alone", () => {
    expect(tagUrl("not a url", "welcome")).toBe("not a url");
  });
});

describe("linkContent", () => {
  it("classifies the destinations that matter for retention", () => {
    expect(linkContent("/properties/W1234567")).toBe("listing");
    expect(linkContent("/property/on/toronto/12-main-st-W1234567")).toBe("listing");
    expect(linkContent("/address/on/toronto/12-main-st")).toBe("address");
    expect(linkContent("/dashboard")).toBe("dashboard");
    expect(linkContent("/properties")).toBe("map");
    expect(linkContent("/whats-my-home-hiding")).toBe("other");
  });
});

describe("tagEmailLinks", () => {
  it("tags hrefs in HTML, keeping &amp; encoding valid", () => {
    const html = `<a href="https://www.pureproperty.ca/dashboard?bubble=1&amp;keep=1">x</a>`;
    const out = tagEmailLinks("watchlist-digest", html, undefined).html!;
    expect(out).toContain("bubble=1&amp;keep=1&amp;utm_source=watchlist-digest&amp;utm_medium=email&amp;utm_content=dashboard");
    expect(out).not.toMatch(/&(?!amp;)/);
  });

  it("tags bare URLs in the text part, but not the unsubscribe link", () => {
    const text = `See it: ${L}\nStop these: https://www.pureproperty.ca/api/email/unsubscribe?e=a&s=b`;
    const out = tagEmailLinks("listing-alert", undefined, text).text!;
    expect(out).toContain(`${L}?utm_source=listing-alert&utm_medium=email&utm_content=listing`);
    expect(out).toContain("https://www.pureproperty.ca/api/email/unsubscribe?e=a&s=b");
  });

  it("does not tag owner/internal mail", () => {
    const html = `<a href="${L}">x</a>`;
    expect(tagEmailLinks("notification:viewing-request", html, L)).toEqual({ html, text: L });
    expect(tagEmailLinks("daily-metrics", html, L)).toEqual({ html, text: L });
  });
});
