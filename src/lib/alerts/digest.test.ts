import { describe, expect, it } from "vitest";
import { renderAlertsDigest, type DigestPayload } from "./digest";

const baseDrop = {
  listing_key: "W100",
  address: "100 Drop Ave",
  city: "Brampton",
  oldPrice: 900_000,
  newPrice: 850_000,
  thumb: null,
  brokerage: "DROP REALTY",
};

const baseStatus = {
  listing_key: "W200",
  address: "200 Sold Cres",
  city: "Mississauga",
  kind: "sold" as const,
  detail: undefined as string | undefined,
  brokerage: "SOLD REALTY",
};

const baseSection = {
  bubbleId: "b1",
  bubbleName: "Pocket A",
  total: 2,
  collapsed: false,
  listings: [
    {
      listing_key: "W300",
      address: "300 New St",
      city: "Brampton",
      price: 799_000,
      beds: 3,
      baths: 2,
      brokerage: "NEW REALTY",
      entryMs: 1,
    },
  ],
};

function payload(over: Partial<DigestPayload> = {}): DigestPayload {
  return { drops: [], statusChanges: [], bubbles: [], ...over };
}

describe("renderAlertsDigest", () => {
  it("composes the subject from non-empty sections", () => {
    const { subject } = renderAlertsDigest(
      payload({ drops: [baseDrop], statusChanges: [baseStatus], bubbles: [baseSection] })
    );
    expect(subject).toBe("1 sold · 1 price drop · 2 new listings");
  });

  it("subject for status-only digests names the event", () => {
    const { subject } = renderAlertsDigest(payload({ statusChanges: [baseStatus] }));
    expect(subject).toBe("1 sold");
    const offMarket = { ...baseStatus, kind: "off-market" as const, detail: "Terminated" };
    expect(renderAlertsDigest(payload({ statusChanges: [offMarket] })).subject).toBe("1 status change");
  });

  it("sold rows are a tease — no price, sign-in CTA, link to the listing", () => {
    const { html, text } = renderAlertsDigest(payload({ statusChanges: [baseStatus] }));
    expect(html).toContain("200 Sold Cres");
    expect(html).toContain("SOLD");
    expect(html.toLowerCase()).toContain("sign in to see the closing price");
    expect(html).toContain("/properties/W200");
    expect(html).not.toContain("$"); // no prices anywhere in a status-only digest
    expect(text.toLowerCase()).toContain("sign in to see the closing price");
  });

  it("every listing row carries its brokerage (§4)", () => {
    const { html } = renderAlertsDigest(
      payload({ drops: [baseDrop], statusChanges: [baseStatus], bubbles: [baseSection] })
    );
    expect(html).toContain("DROP REALTY");
    expect(html).toContain("SOLD REALTY");
    expect(html).toContain("NEW REALTY");
  });

  it("renders overflow and collapsed bubble lines", () => {
    const overflowing = { ...baseSection, total: 9 }; // 1 row shown of 9
    const collapsed = {
      ...baseSection,
      bubbleId: "b2",
      bubbleName: "Huge Area",
      total: 42,
      collapsed: true,
      listings: [],
    };
    const { html } = renderAlertsDigest(payload({ bubbles: [overflowing, collapsed] }));
    expect(html).toContain("+8 more");
    expect(html).toContain("42 new listings");
    expect(html).toContain("Huge Area");
  });

  it("omits empty sections entirely", () => {
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(html).not.toContain("New in your areas");
    expect(html).not.toContain("Status changes");
  });

  it("footer has the manage-alerts link and PROPTX attribution", () => {
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(html).toContain("/dashboard");
    expect(html).toContain("PROPTX MLS®");
  });
});

// Edge cases ported from the retired scripts/worker/alerts.test.ts (renderDigest era).
describe("renderAlertsDigest — drop-row edge cases", () => {
  it("includes address, city, and both prices for a drop", () => {
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(html).toContain("100 Drop Ave");
    expect(html).toContain("Brampton");
    expect(html).toContain("$900,000");
    expect(html).toContain("$850,000");
    expect(html).toContain("−$50,000"); // U+2212 minus, en-CA formatting
  });

  it("URL-encodes the listing_key (defense against weird MLS keys)", () => {
    const { html } = renderAlertsDigest(
      payload({ drops: [{ ...baseDrop, listing_key: "odd key/with?chars" }] })
    );
    expect(html).toContain("odd%20key%2Fwith%3Fchars");
    expect(html).not.toContain("odd key/with?chars");
  });

  it("falls back to 'Saved property' when the address is empty", () => {
    const { html } = renderAlertsDigest(payload({ drops: [{ ...baseDrop, address: "" }] }));
    expect(html).toContain("Saved property");
  });

  it("rounds non-integer prices for display (no fractional dollars)", () => {
    const { html } = renderAlertsDigest(
      payload({ drops: [{ ...baseDrop, oldPrice: 800_123.4, newPrice: 750_000 }] })
    );
    expect(html).toContain("$800,123");
    expect(html).not.toContain("800,123.4");
  });

  it("text fallback ends with the dashboard link", () => {
    const { text } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(text).toContain("Open your dashboard: https://www.pureproperty.ca/dashboard");
  });
});
