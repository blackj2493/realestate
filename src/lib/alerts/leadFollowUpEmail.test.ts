/**
 * Guards the lead auto-acknowledgement. The failure this file exists to stop is a
 * SILENT one: the email always rendered, and always rendered the residential-buyer
 * copy, so a tenant was told what the place costs to "own each month" and a commercial
 * enquiry got the same. Nothing errored, so nothing caught it.
 */
import { describe, expect, it, beforeAll } from "vitest";
import {
  classifyLeadLane,
  renderLeadFollowUpEmail,
  type LeadLane,
} from "./leadFollowUpEmail";

beforeAll(() => {
  // marketingUnsubscribeUrl signs with this; without it every render throws.
  process.env.ALERTS_UNSUBSCRIBE_SECRET ||= "test-secret";
});

const base = {
  name: "Priya Sharma",
  address: "12 Main St, Toronto",
  listingKey: "W1234567",
  email: "priya@example.com",
};

const render = (lane: LeadLane, intent?: "viewing" | "question" | "price_opinion") =>
  renderLeadFollowUpEmail({ ...base, lane, intent });

const ALL_LANES: LeadLane[] = [
  "residential-sale",
  "residential-lease",
  "commercial-sale",
  "commercial-lease",
];

describe("classifyLeadLane", () => {
  it("splits sale from lease on TransactionType", () => {
    expect(classifyLeadLane({ transactionType: "For Sale", propertyType: "Residential" })).toBe(
      "residential-sale"
    );
    expect(classifyLeadLane({ transactionType: "For Lease", propertyType: "Residential" })).toBe(
      "residential-lease"
    );
  });

  it("splits residential from commercial on the exact PropertyType spelling", () => {
    expect(classifyLeadLane({ transactionType: "For Sale", propertyType: "Commercial" })).toBe(
      "commercial-sale"
    );
    expect(classifyLeadLane({ transactionType: "For Lease", propertyType: "Commercial" })).toBe(
      "commercial-lease"
    );
    // "Residential Freehold" / "Residential Condo & Other" are NOT commercial.
    expect(
      classifyLeadLane({ transactionType: "For Sale", propertyType: "Residential Freehold" })
    ).toBe("residential-sale");
  });

  it("falls back to the residential sale lane when either fact is missing", () => {
    expect(classifyLeadLane({})).toBe("residential-sale");
    expect(classifyLeadLane({ transactionType: null, propertyType: null })).toBe(
      "residential-sale"
    );
  });
});

describe("lane copy applicability", () => {
  it("never tells a tenant what the place costs to own", () => {
    for (const lane of ["residential-lease", "commercial-lease"] as LeadLane[]) {
      const { text } = render(lane, "question");
      expect(text).not.toMatch(/costs to own/i);
      expect(text).not.toMatch(/mortgage/i);
      expect(text).not.toMatch(/asking-price change/i);
    }
  });

  it("gives a residential tenant rent figures, not sale figures", () => {
    const { text } = render("residential-lease", "question");
    expect(text).toMatch(/asking-rent change/i);
    expect(text).toMatch(/what the rent covers/i);
    expect(text).toMatch(/actually rented for/i);
  });

  it("gives a residential buyer the carrying cost and the price history", () => {
    const { text } = render("residential-sale", "question");
    expect(text).toMatch(/costs to own each month/i);
    expect(text).toMatch(/asking-price change/i);
  });

  it("explains TMI on both commercial lanes instead of assuming it is known", () => {
    for (const lane of ["commercial-sale", "commercial-lease"] as LeadLane[]) {
      const { text } = render(lane, "question");
      expect(text).toMatch(/TMI/);
      // The term must be defined in the same breath — never left bare.
      expect(text).toMatch(/TMI[^\n]*taxes, maintenance and insurance/i);
    }
  });

  it("leads a commercial tenant with the quoting basis, which is the real trap", () => {
    const { text } = render("commercial-lease", "question");
    expect(text).toMatch(/per square foot per year/i);
    expect(text).toMatch(/zoning/i);
  });

  it("never promises residential dwelling figures on a commercial listing", () => {
    for (const lane of ["commercial-sale", "commercial-lease"] as LeadLane[]) {
      const { text } = render(lane, "question");
      expect(text).not.toMatch(/condo fee/i);
      expect(text).not.toMatch(/locker/i);
    }
  });
});

describe("tone and compliance, every lane", () => {
  it("drops the insider coinage", () => {
    for (const lane of ALL_LANES) {
      const { text, html } = render(lane);
      expect(text).not.toMatch(/shadow number/i);
      expect(html).not.toMatch(/shadow number/i);
    }
  });

  it("does not fake a reply in the subject", () => {
    for (const lane of ALL_LANES) {
      expect(render(lane).subject).not.toMatch(/^Re:/i);
    }
  });

  it("keeps the one-click unsubscribe in both parts (CASL)", () => {
    for (const lane of ALL_LANES) {
      const { text, html } = render(lane);
      expect(text).toMatch(/stop these: https?:\/\//);
      expect(html).toMatch(/Not interested/);
    }
  });

  it("addresses the lead by first name only", () => {
    expect(render("residential-sale").text).toMatch(/^Hi Priya,/);
    expect(
      renderLeadFollowUpEmail({ ...base, name: "", lane: "residential-sale" }).text
    ).toMatch(/^Hi there,/);
  });
});

describe("intent", () => {
  it("names what the lead actually asked for", () => {
    expect(render("residential-sale", "viewing").subject).toBe(
      "Your viewing request — 12 Main St, Toronto"
    );
    expect(render("residential-sale", "question").subject).toBe(
      "Your question about 12 Main St, Toronto"
    );
    expect(render("residential-sale", "price_opinion").subject).toBe(
      "Your price check on 12 Main St, Toronto"
    );
  });

  it("defaults to the viewing wording", () => {
    expect(render("residential-sale").text).toMatch(/Got your viewing request on/);
  });
});

describe("address handling", () => {
  it("falls back when the address is absent", () => {
    const { subject, text } = renderLeadFollowUpEmail({
      ...base,
      address: null,
      lane: "residential-sale",
    });
    expect(subject).toContain("the property you asked about");
    expect(text).toContain("the property you asked about");
  });

  it("escapes the address in the HTML", () => {
    const { html } = renderLeadFollowUpEmail({
      ...base,
      address: '12 "Main" <b>St</b>',
      lane: "residential-sale",
    });
    expect(html).toContain("&quot;Main&quot;");
    expect(html).toContain("&lt;b&gt;St&lt;/b&gt;");
  });
});

describe("viewing requests ask for a time (Oct 2026: a renter wanted to view within the hour)", () => {
  it("gives the direct line and asks for two times, on every lane", () => {
    for (const lane of ALL_LANES) {
      const { text, html } = render(lane, "viewing");
      expect(text).toMatch(/647-466-2109/);
      expect(html).toMatch(/647-466-2109/);
      expect(text).toMatch(/two times/i);
    }
  });

  it("does not promise a report the lead did not ask for", () => {
    for (const lane of ALL_LANES) {
      const { text } = render(lane, "viewing");
      expect(text).not.toMatch(/figures that matter/i);
      expect(text).not.toMatch(/^- /m);
    }
  });

  it("asks a tenant for what the landlord asks first", () => {
    expect(render("residential-lease", "viewing").text).toMatch(/move-in date/i);
    expect(render("commercial-lease", "viewing").text).toMatch(/what you plan to run there/i);
    expect(render("residential-sale", "viewing").text).not.toMatch(/landlord/i);
  });
});

describe("signature (RECO: registrant name + brokerage)", () => {
  it("names the registrant and the brokerage on every intent", () => {
    for (const intent of ["viewing", "question", "price_opinion"] as const) {
      const { text, html } = render("residential-sale", intent);
      expect(text).toMatch(/— Tanmay Rao/);
      expect(text).toMatch(/eXp Realty, Brokerage/);
      expect(html).toMatch(/eXp Realty, Brokerage/);
    }
  });

  it("gives the phone on question and price-check replies too", () => {
    expect(render("residential-sale", "price_opinion").text).toMatch(/call or text me at 647-466-2109/);
  });
});
