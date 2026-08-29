import { describe, expect, it } from "vitest";
import { renderStreetRecapEmail } from "./streetRecapEmail";
import { SITE } from "./emailShell";
import type { StreetRecapPayload } from "@/lib/streetRecap/payload";

const NOW = Date.parse("2026-09-15T12:00:00Z");
const UNSUB = `${SITE}/api/email/unsubscribe?e=a%40b.com&s=sig`;
const MANAGE = `${SITE}/account/emails`;

const payload = (over: Partial<StreetRecapPayload> = {}): StreetRecapPayload => ({
  scope: { kind: "region", label: "Patterson", city: "Vaughan" },
  address: "128 Maplecrest Ave",
  monthLabel: "August",
  local: {
    sales: 115,
    aboveAsking: 30,
    medianDom: 18,
    byType: [
      { type: "Detached", sales: 100, medianDom: 17 },
      { type: "Att/Row/Townhouse", sales: 38, medianDom: 14 },
      { type: "Condo Apartment", sales: 13, medianDom: 40 },
    ],
  },
  cityAgg: { sales: 686, aboveAsking: 116, medianDom: 21, byType: [] },
  actives: { active: 1482, cutPrice: 382, medianTrueDom: 63 },
  abovePct: 26,
  cityAbovePct: 16.9,
  cutPct: 25.8,
  dataAsOf: "2026-09-15T04:00:00Z",
  ...over,
});

const render = (p = payload(), lat: number | null = 43.86, lng: number | null = -79.51) =>
  renderStreetRecapEmail(
    { payload: p, lat, lng, unsubscribeUrl: UNSUB, manageUrl: MANAGE },
    NOW
  );

const hrefs = (html: string): string[] =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

/**
 * The invariant the whole design rests on. No price means one rendering serves a reader who
 * accepted VOW terms and one who never did — no gate, no second variant, nothing to leak.
 */
describe("the recap carries no price, ever", () => {
  it("has no dollar figure in either part", () => {
    for (const p of [payload(), payload({ cityAgg: null, cityAbovePct: null }), payload({ actives: null, cutPct: null })]) {
      const { html, text, subject } = render(p);
      expect(html).not.toContain("$");
      expect(text).not.toContain("$");
      expect(subject).not.toContain("$");
    }
  });

  it("says out loud that it is not a valuation", () => {
    const { html, text } = render();
    expect(html).toContain("No estimate of your home's value");
    expect(text).toContain("No estimate of your home's value");
  });
});

/**
 * MONO is a font STACK, not a declaration. Interpolating it bare swallows the property that
 * follows — the numbers stop being monospace and the next rule is silently corrupted. The
 * shell has already been bitten once by a MONO quoting bug (a double quote truncating the
 * style attribute), so this is worth pinning.
 */
describe("monospace numbers", () => {
  it("emits a valid font-family declaration everywhere it uses MONO", () => {
    const { html } = render();
    expect(html).toContain("font-family:ui-monospace");
    // A bare interpolation shows up as `…;ui-monospace…` with no property name.
    expect(html).not.toMatch(/;ui-monospace/);
  });
});

describe("subject and lead", () => {
  it("leads on the comparison when the neighbourhood differs from its city", () => {
    const { subject, preheader } = render();
    expect(subject).toBe("Homes in Patterson sold in 18 days last month");
    expect(preheader).toContain("Across Vaughan it took 21");
  });

  it("falls back to a count when there is no days-to-sell figure", () => {
    const { subject } = render(payload({ local: { ...payload().local, medianDom: null } }));
    expect(subject).toBe("115 homes sold in Patterson last month");
  });

  it("names the city when the ladder fell all the way through", () => {
    const { subject } = render(
      payload({ scope: { kind: "city", label: "Vaughan", city: "Vaughan" }, cityAgg: null })
    );
    expect(subject).toContain("Vaughan");
  });
});

describe("links", () => {
  it("points the CTA at a camera on the watched home, tagged", () => {
    const cta = hrefs(render().html).find((h) => h.includes("utm_content=cta"))!;
    expect(cta).toContain("lat=43.86000");
    expect(cta).toContain("lng=-79.51000");
    // A text filter would pin the map and empty it the moment they pan past the boundary.
    expect(cta).not.toContain("city=");
    expect(cta).toContain("utm_source=street_recap");
    expect(cta).toContain("utm_campaign=2026-august");
  });

  it("degrades to the plain map when the home has no coordinates", () => {
    const cta = hrefs(render(payload(), null, null).html).find((h) => h.includes("utm_content=cta"))!;
    expect(cta).toContain("/properties?");
    expect(cta).not.toContain("lat=");
  });

  it("never tags the unsubscribe link", () => {
    const unsub = hrefs(render().html).filter((h) => h.includes("/api/email/unsubscribe"));
    expect(unsub.length).toBeGreaterThan(0);
    for (const h of unsub) expect(h).not.toContain("utm_");
  });
});

describe("degrading gracefully", () => {
  it("drops the standing-inventory block rather than printing a dash", () => {
    const { html } = render(payload({ actives: null, cutPct: null }));
    expect(html).not.toContain("still for sale");
    expect(html).toContain("Homes sold");
  });

  it("names property types the way a person would, not the way the feed does", () => {
    const p = payload({
      local: {
        ...payload().local,
        byType: [
          { type: "Att/Row/Townhouse", sales: 40, medianDom: 14 },
          { type: "Condo Apartment", sales: 20, medianDom: 40 },
        ],
      },
    });
    const { html } = render(p);
    expect(html).toContain("A townhouse near you now sells in 14 days");
    expect(html).toContain("A condo takes 40");
    expect(html).not.toContain("Att/Row/Townhouse near you");
  });

  it("drops the contrast line when the two types are barely different", () => {
    // Real August data: Patterson detached 23 days, townhouse 21. Two numbers beside each
    // other is not an insight.
    const p = payload({
      local: {
        ...payload().local,
        byType: [
          { type: "Detached", sales: 28, medianDom: 23 },
          { type: "Att/Row/Townhouse", sales: 19, medianDom: 21 },
        ],
      },
    });
    expect(render(p).html).not.toContain("near you now sells in");
  });

  it("renders a thin type list without inventing rows", () => {
    const p = payload({
      local: { ...payload().local, byType: [{ type: "Detached", sales: 100, medianDom: 17 }] },
    });
    const { html } = render(p);
    expect(html).toContain("Detached");
    // The "a townhouse sells in X, a condo takes Y" line needs two cohorts; with one it goes.
    expect(html).not.toContain("takes");
  });
});
