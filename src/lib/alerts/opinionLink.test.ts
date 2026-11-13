import { describe, expect, it } from "vitest";
import { renderAlertsDigest, type DigestPayload } from "./digest";
import { renderListingAlertEmail } from "./listingAlertEmail";
import { OPINION_LINK_TEXT, opinionUrl } from "./opinionLink";

const drop = {
  listing_key: "N14113806",
  address: "725 Exceller Circle",
  city: "Newmarket",
  oldPrice: 2_099_000,
  newPrice: 1_999_000,
  thumb: null,
  brokerage: "SOME REALTY",
};
const digest = (over: Partial<DigestPayload>): DigestPayload => ({ drops: [], statusChanges: [], bubbles: [], ...over });

describe("opinionUrl", () => {
  it("opens the listing with the price-opinion form", () => {
    expect(opinionUrl("N14113806")).toMatch(/\/properties\/N14113806\?ask=price_opinion$/);
  });
});

describe("watchlist digest drop row", () => {
  it("offers the price opinion on a sale listing", () => {
    const { html, text } = renderAlertsDigest(digest({ drops: [{ ...drop, opinion: true }] }));
    expect(html).toContain(OPINION_LINK_TEXT);
    expect(html).toContain("?ask=price_opinion");
    expect(text).toContain("?ask=price_opinion");
  });
  it("does not offer it when the drop is not a sale listing", () => {
    const { html, text } = renderAlertsDigest(digest({ drops: [drop] }));
    expect(html).not.toContain(OPINION_LINK_TEXT);
    expect(text).not.toContain("ask=price_opinion");
  });
});

describe("listing alert email drop row", () => {
  const base = { address: drop.address, city: drop.city, brokerage: drop.brokerage, listing_key: drop.listing_key };
  it("offers the price opinion on a sale listing", () => {
    const { html, text } = renderListingAlertEmail({
      changes: [{ ...base, drop: { oldPrice: drop.oldPrice, newPrice: drop.newPrice, opinion: true } }],
      unsubscribeUrl: "https://example.test/u",
    });
    expect(html).toContain(OPINION_LINK_TEXT);
    expect(text).toContain("?ask=price_opinion");
  });
  it("does not offer it on a lease drop or a status change", () => {
    const { html } = renderListingAlertEmail({
      changes: [
        { ...base, drop: { oldPrice: 3_000, newPrice: 2_800 } },
        { ...base, listing_key: "W1", status: { kind: "sold" } },
      ],
      unsubscribeUrl: "https://example.test/u",
    });
    expect(html).not.toContain(OPINION_LINK_TEXT);
  });
});
