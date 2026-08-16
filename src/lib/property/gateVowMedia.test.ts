import { describe, it, expect } from "vitest";
import { gateVowDerived, type ListingDetail } from "./getListingDetail";
import { EMPTY_DEAL_SCORE } from "@/lib/dealScore/computeDealScore";
import type { ListingStatus } from "./listingStatus";

/**
 * Photo gating on sold/off-market records.
 *
 * This is the only automated guard on the rule, and the rule is invisible when it breaks:
 * nothing errors, the page just quietly serves VOW photos to anonymous visitors again.
 * /address has always treated a sold photo URL as a VOW field (soldByKey.ts); this page
 * did not, and the two public surfaces disagreed about the same photo of the same home.
 */
const PHOTOS = ["https://trreb-image.ampre.ca/a.jpg", "https://trreb-image.ampre.ca/b.jpg"];

function detailWith(status: ListingStatus, media: string[]): ListingDetail {
  return {
    listing_key: "X12345678",
    full_payload: { ClosePrice: 875_000, CloseDate: "2026-06-09", true_dom: 41 },
    media_urls: media,
    photoTeaser: status.kind === "active" ? null : { count: media.length },
    city: "Oshawa",
    property_sub_type: "Detached",
    synced_at: null,
    estimate: null,
    valueAdd: null,
    feeStability: { verdict: "unknown" },
    dealScore: EMPTY_DEAL_SCORE,
    expectedSale: null,
    saleHistory: { saleCount: 0, events: [], lastClosePrice: null, lastCloseDate: null },
    priceTimeline: { currentPrice: 1, originalPrice: null, totalPriceDrop: 0, trueDom: null },
    campaignHistory: { campaigns: [], trueDom: null, totalPriceDrop: 0 },
    status,
    soldAccuracy: null,
    capRatePct: null,
    geoFlags: [],
    geoChecked: false,
    geoCheckedAt: null,
    rooms: [],
  } as unknown as ListingDetail;
}

const SOLD: ListingStatus = { kind: "sold", label: "SOLD", closePrice: 875_000, soldDate: "2026-06-09" };
const LEASED: ListingStatus = { kind: "sold", label: "LEASED", closePrice: 3_000, soldDate: "2026-06-09" };
const DELISTED: ListingStatus = {
  kind: "delisted",
  mlsStatus: "Terminated",
  delistedDate: "2026-06-09",
  daysOnMarket: 41,
  lastListPrice: 900_000,
};
const ACTIVE: ListingStatus = { kind: "active" };

describe("gateVowDerived — photos on closed records", () => {
  it("withholds sold photo URLs from anonymous users", () => {
    const gated = gateVowDerived(detailWith(SOLD, PHOTOS), false);
    expect(gated.media_urls).toEqual([]);
  });

  it("withholds leased and off-market photo URLs too", () => {
    expect(gateVowDerived(detailWith(LEASED, PHOTOS), false).media_urls).toEqual([]);
    expect(gateVowDerived(detailWith(DELISTED, PHOTOS), false).media_urls).toEqual([]);
  });

  it("keeps the COUNT so the UI can offer a locked gallery instead of an empty box", () => {
    // Distinguishing "gated" from "genuinely has none" is the whole point — ~20,320 sold
    // records really have no photos and must not be advertised as having a gallery.
    const gated = gateVowDerived(detailWith(SOLD, PHOTOS), false);
    expect(gated.photoTeaser).toEqual({ count: 2 });
  });

  it("reports zero for a closed record that genuinely has no photos", () => {
    const gated = gateVowDerived(detailWith(SOLD, []), false);
    expect(gated.media_urls).toEqual([]);
    expect(gated.photoTeaser).toEqual({ count: 0 });
  });

  it("leaves ACTIVE listings alone — those photos are IDX and are the point of the site", () => {
    const gated = gateVowDerived(detailWith(ACTIVE, PHOTOS), false);
    expect(gated.media_urls).toEqual(PHOTOS);
    expect(gated.photoTeaser).toBeNull();
  });

  it("gives a signed-in consumer the real gallery on a sold record", () => {
    const authed = gateVowDerived(detailWith(SOLD, PHOTOS), true);
    expect(authed.media_urls).toEqual(PHOTOS);
  });

  it("still gates the sold price it always did — photos are an addition, not a swap", () => {
    const gated = gateVowDerived(detailWith(SOLD, PHOTOS), false);
    expect(gated.full_payload.ClosePrice).toBeUndefined();
    expect(gated.full_payload.CloseDate).toBeUndefined();
    expect(gated.full_payload.true_dom).toBeUndefined();
    expect((gated.status as { closePrice: number | null }).closePrice).toBeNull();
  });
});
