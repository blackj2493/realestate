import { describe, expect, it } from "vitest";
import {
  renderAlertsDigest,
  DROP_EMAIL_ROW_CAP,
  STATUS_EMAIL_ROW_CAP,
  type DigestPayload,
} from "./digest";

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
  highVolume: false,
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

  it("sold row shows the listing photo but still gates the price (photo public, price behind login)", () => {
    const soldWithPhoto = { ...baseStatus, thumb: "https://media.proptx.ca/sold-medium.jpg" };
    const { html } = renderAlertsDigest(payload({ statusChanges: [soldWithPhoto] }));
    expect(html).toContain('src="https://media.proptx.ca/sold-medium.jpg"'); // photo renders
    expect(html.toLowerCase()).toContain("sign in to see the closing price"); // price stays gated
    expect(html).not.toContain("$"); // still no price in the email body
  });

  it("every listing row carries its brokerage (§4)", () => {
    const { html } = renderAlertsDigest(
      payload({ drops: [baseDrop], statusChanges: [baseStatus], bubbles: [baseSection] })
    );
    expect(html).toContain("DROP REALTY");
    expect(html).toContain("SOLD REALTY");
    expect(html).toContain("NEW REALTY");
  });

  it("renders the overflow line for an ordinary area", () => {
    const overflowing = { ...baseSection, total: 9 }; // 1 row shown of 9
    const { html } = renderAlertsDigest(payload({ bubbles: [overflowing] }));
    expect(html).toContain("+8 more");
  });

  it("a high-volume area names its count AND still shows its homes", () => {
    const huge = {
      ...baseSection,
      bubbleId: "b2",
      bubbleName: "Huge Area",
      total: 143,
      highVolume: true,
    };
    const { html, text } = renderAlertsDigest(payload({ bubbles: [huge] }));
    expect(html).toContain("143 new homes came up in Huge Area");
    expect(html).toContain("300 New St"); // the row survives — never a bare count again
    expect(html).not.toContain("Tip: smaller areas make sharper alerts");
    expect(text).toContain("300 New St");
    expect(text).toContain("143 new homes in Huge Area");
  });

  it("renders a listing thumbnail for drops and bubbles when a photo URL is present", () => {
    const dropWithPhoto = { ...baseDrop, thumb: "https://media.proptx.ca/drop-medium.jpg" };
    const sectionWithPhoto = {
      ...baseSection,
      listings: [{ ...baseSection.listings[0], thumb: "https://media.proptx.ca/bubble-medium.jpg" }],
    };
    const { html } = renderAlertsDigest(
      payload({ drops: [dropWithPhoto], bubbles: [sectionWithPhoto] })
    );
    expect(html).toContain('src="https://media.proptx.ca/drop-medium.jpg"');
    expect(html).toContain('src="https://media.proptx.ca/bubble-medium.jpg"');
  });

  it("falls back to a placeholder box (no <img>) when a listing has no photo", () => {
    // baseDrop.thumb is null and baseSection listings carry no thumb.
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop], bubbles: [baseSection] }));
    expect(html).not.toContain("<img"); // status/drops/bubbles here have no photo → placeholder only
  });

  it("ignores a non-http thumb value rather than emitting a broken image", () => {
    const { html } = renderAlertsDigest(
      payload({ drops: [{ ...baseDrop, thumb: "javascript:alert(1)" }] })
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
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

describe("renderAlertsDigest — relisted rows", () => {
  const relisted = {
    listing_key: "N9NEW",
    address: "127 Via Toscana N/A",
    city: "Vaughan",
    kind: "relisted" as const,
    brokerage: "RELIST REALTY",
    newPrice: 1_679_900,
  };

  it("subject counts relists separately", () => {
    const { subject } = renderAlertsDigest(payload({ statusChanges: [relisted] }));
    expect(subject).toBe("1 relisted");
  });

  it("row links to the NEW key and shows the new (public IDX) ask", () => {
    const { html, text } = renderAlertsDigest(payload({ statusChanges: [relisted] }));
    expect(html).toContain("RELISTED");
    expect(html).toContain("/properties/N9NEW");
    expect(html).toContain("new MLS#");
    expect(html).toContain("$1,679,900");
    expect(text).toContain("$1,679,900");
  });

  it("omits the ask when the new campaign has no usable price", () => {
    const { html } = renderAlertsDigest(payload({ statusChanges: [{ ...relisted, newPrice: null }] }));
    expect(html).toContain("new MLS#");
    expect(html).not.toContain("now asking");
  });
});

describe("renderAlertsDigest — section row caps", () => {
  it("caps status and drop sections with an overflow line", () => {
    const drops = Array.from({ length: DROP_EMAIL_ROW_CAP + 5 }, (_, i) => ({
      ...baseDrop,
      listing_key: `D${i}`,
      address: `${i} Drop Ave`,
    }));
    const statuses = Array.from({ length: STATUS_EMAIL_ROW_CAP + 3 }, (_, i) => ({
      ...baseStatus,
      listing_key: `S${i}`,
      address: `${i} Sold Cres`,
    }));
    const { html, text, subject } = renderAlertsDigest(payload({ drops, statusChanges: statuses }));
    // subject still reflects true counts
    expect(subject).toContain(`${STATUS_EMAIL_ROW_CAP + 3} sold`);
    expect(subject).toContain(`${DROP_EMAIL_ROW_CAP + 5} price drops`);
    // rendered rows are capped; the surplus surfaces as a dashboard link
    expect(html).toContain("+5 more on your dashboard");
    expect(html).toContain("+3 more on your dashboard");
    expect(html).not.toContain(`${DROP_EMAIL_ROW_CAP} Drop Ave`); // first over-cap row not rendered
    expect(text).toContain("+5 more on your dashboard");
  });
});

describe("renderAlertsDigest — the filter nudge", () => {
  const filtered = { ...baseSection, filterLabel: "3+ bd · Detached" };

  it("offers filters when an area alerted on everything", () => {
    const { html, text } = renderAlertsDigest(payload({ bubbles: [baseSection] }));
    expect(html).toContain("You get every new home in Pocket A");
    expect(html).toContain("Set my filters");
    expect(text).toContain("You get every new home in Pocket A");
  });

  it("stays silent when every area already carries filters", () => {
    const { html, text } = renderAlertsDigest(payload({ bubbles: [filtered] }));
    expect(html).toContain("filtered to: 3+ bd · Detached");
    expect(html).not.toContain("You get every new home");
    expect(text).not.toContain("You get every new home");
  });

  it("names only the unfiltered areas, and says it once", () => {
    const open2 = { ...baseSection, bubbleId: "b3", bubbleName: "Pocket B" };
    const { html } = renderAlertsDigest(payload({ bubbles: [baseSection, filtered, open2] }));
    expect(html).toContain("You get every new home in Pocket A and Pocket B");
    expect(html.match(/You get every new home/g)).toHaveLength(1);
  });

  it("stops naming areas past three — the list is not the point by then", () => {
    const many = ["A", "B", "C", "D"].map((n, i) => ({
      ...baseSection,
      bubbleId: `b${i}`,
      bubbleName: `Pocket ${n}`,
    }));
    const { html } = renderAlertsDigest(payload({ bubbles: many }));
    expect(html).toContain("You get every new home in your areas");
  });

  it("treats a filter-less 'filtered' area as unfiltered — the query is identical", () => {
    // alert_scope 'filtered' over an empty lens builds no clause, so the worker hands us a
    // null label and the reader really did receive everything. Scope would lie here.
    const emptyLens = { ...baseSection, filterLabel: null };
    const { html } = renderAlertsDigest(payload({ bubbles: [emptyLens] }));
    expect(html).toContain("You get every new home in Pocket A");
  });

  it("never appears in a digest with no area section at all", () => {
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(html).not.toContain("You get every new home");
  });
});
