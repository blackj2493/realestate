import { describe, expect, it } from "vitest";
import { renderStreetRecapEmail } from "./streetRecapEmail";
import { SITE } from "./emailShell";
import type { StreetRecapPayload } from "@/lib/streetRecap/payload";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const UNSUB = `${SITE}/api/email/unsubscribe?e=a%40b.com&s=sig`;
const MANAGE = `${SITE}/account/emails`;

const payload = (over: Partial<StreetRecapPayload> = {}): StreetRecapPayload => ({
  scope: { kind: "region", label: "Patterson", city: "Vaughan" },
  address: "128 Maplecrest Ave",
  monthLabel: "October",
  local: {
    sales: 115,
    aboveAsking: 30,
    medianDom: 18,
    byType: [
      { type: "Detached", sales: 100, medianDom: 17 },
      { type: "Att/Row/Townhouse", sales: 38, medianDom: 14 },
    ],
  },
  cityAgg: { sales: 686, aboveAsking: 116, medianDom: 21, byType: [] },
  actives: { active: 1482, cutPrice: 382, medianTrueDom: 63 },
  abovePct: 26,
  cityAbovePct: 16.9,
  cutPct: 25.8,
  dataAsOf: "2026-11-02T04:00:00Z",
  home: { type: "Detached", sales: 100, medianDom: 17, cityMedianDom: 23 },
  prevAbovePct: 41,
  school: { name: "Johnny Lombardi PS", score: 8.7 },
  source: "reno",
  ...over,
});

const render = (p = payload(), lat: number | null = 43.86, lng: number | null = -79.51) =>
  renderStreetRecapEmail({ payload: p, lat, lng, unsubscribeUrl: UNSUB, manageUrl: MANAGE }, NOW);

const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

/**
 * VOW Agreement §(f): analytics built from sold data stay on the signed-in site. No price,
 * and no True DOM — the 63 days the homes still for sale have been listed is VOW, so it must
 * not print even though the payload carries it.
 */
describe("VOW: nothing sold-derived beyond counts and shares", () => {
  it("has no dollar figure in any part", () => {
    for (const p of [payload(), payload({ home: null }), payload({ actives: null, cutPct: null })]) {
      const { html, text, subject, preheader } = render(p);
      for (const s of [html, text, subject, preheader]) expect(s).not.toContain("$");
    }
  });

  it("never prints the True DOM of the homes still for sale", () => {
    const { html, text, preheader } = render();
    for (const s of [html, text, preheader]) {
      expect(s).not.toContain("63");
      expect(s).not.toMatch(/listed so far/i);
    }
  });

  it("says out loud that it is not a valuation", () => {
    const { html, text } = render();
    expect(html).toContain("No estimate of your home's value");
    expect(text).toContain("No estimate of your home's value");
  });

  it("has exactly one sign-in link, to analytics for the area and type", () => {
    const sold = hrefs(render().html).filter((h) => h.includes("utm_content=sold"));
    expect(sold).toHaveLength(1);
    expect(sold[0]).toContain("/analytics?");
    expect(sold[0]).toContain("region=Patterson");
    expect(sold[0]).toContain("types=detached");
  });
});

describe("monospace numbers", () => {
  it("emits a valid font-family declaration everywhere it uses MONO", () => {
    const { html } = render();
    expect(html).toContain("font-family:ui-monospace");
    expect(html).not.toMatch(/;ui-monospace/);
  });
});

describe("homes like yours", () => {
  it("leads on the reader's own type and compares it with the same type in the city", () => {
    const { subject, html } = render();
    expect(subject).toBe("100 detached homes sold in Patterson in October, faster than Vaughan");
    expect(html).toContain("Homes like yours");
    expect(html).toContain("Across Vaughan it was 23 days");
  });

  it("falls back to every home when the type is unknown or too thin", () => {
    const { subject, html } = render(payload({ home: null }));
    expect(subject).toBe("115 homes sold in Patterson in October, faster than Vaughan");
    expect(html).toContain("Homes near you");
  });

  it("makes no pace claim when the gap is under three days", () => {
    const { subject } = render(payload({ home: { type: "Detached", sales: 100, medianDom: 17, cityMedianDom: 18 } }));
    expect(subject).not.toMatch(/faster|slower/);
  });
});

describe("the market around you", () => {
  it("shows the above-asking change and what it means", () => {
    const { html } = render();
    expect(html).toContain("from 41% in September");
    expect(html).toContain("Buyers near you have more choice");
  });

  it("says nothing about the change when it is small", () => {
    const { html } = render(payload({ prevAbovePct: 28 }));
    expect(html).not.toContain("in September");
    expect(html).not.toContain("Buyers near you");
  });
});

describe("if you ever sell", () => {
  it("links to the price-cut panel as text, never with its figures", () => {
    const { html, text } = render();
    const cut = hrefs(html).filter((h) => h.includes("utm_content=price-cut"));
    expect(cut).toHaveLength(1);
    expect(cut[0]).toContain("/analytics?");
    expect(cut[0]).toContain("region=Patterson");
    expect(cut[0]).toContain("types=detached");
    expect(cut[0]).toContain("panel=price-cut-cost");
    expect(html).toContain("See what a price cut cost sellers here");
    expect(text).toContain("panel=price-cut-cost");
    // Still one button: the price-cut link is a text link, not a second call to action.
    expect(html.match(/See what they sold for/g)).toHaveLength(1);
    expect(html).not.toMatch(/of (their|the) first asking price/i);
  });

  it("has no price-cut link when the section is dropped", () => {
    expect(render(payload({ cutPct: null })).html).not.toContain("panel=price-cut-cost");
  });

  it("warns about starting high when many homes have cut", () => {
    expect(render().html).toContain("A home that starts too high waits longer");
  });

  it("says the opposite when few have cut", () => {
    const { html } = render(payload({ cutPct: 9 }));
    expect(html).toContain("Only 9% of the homes for sale near you have cut their price");
    expect(html).not.toContain("starts too high");
  });

  it("drops the section without a cut share", () => {
    expect(render(payload({ cutPct: null })).html).not.toContain("If you ever sell");
  });
});

describe("reno and school sections", () => {
  it("sends a reno user back to the tool, and not a watcher", () => {
    expect(render().html).toContain("Your renovation check");
    const watch = render(payload({ source: "watch" }));
    expect(watch.html).not.toContain("Your renovation check");
    expect(watch.html).toContain("you asked us to watch 128 Maplecrest Ave");
  });

  it("names the school zone with its score, and drops it when there is none", () => {
    expect(render().html).toContain("<b>Johnny Lombardi PS</b> (score 8.7/10");
    expect(render(payload({ school: null })).html).not.toContain("Your school zone");
  });

  it("points the school link at a camera on the home", () => {
    const s = hrefs(render().html).find((h) => h.includes("utm_content=schools"))!;
    expect(s).toContain("lat=43.86000");
    expect(s).not.toContain("city=");
  });
});

describe("links", () => {
  it("tags every site link but the unsubscribe", () => {
    const all = hrefs(render().html);
    const unsub = all.filter((h) => h.includes("/api/email/unsubscribe"));
    expect(unsub.length).toBeGreaterThan(0);
    for (const h of unsub) expect(h).not.toContain("utm_");
    for (const h of all.filter((x) => x.startsWith(SITE) && !x.includes("/api/email/unsubscribe"))) {
      expect(h).toContain("utm_source=street_recap");
    }
  });
});

describe("an FSA is never printed as a place", () => {
  const fsaPayload = () =>
    payload({
      scope: { kind: "fsa", label: "M5A", city: "Toronto" },
      address: "35 Parliament Street",
      cityAgg: null,
      cityAbovePct: null,
      home: null,
    });

  it("says 'near you' rather than the postal code", () => {
    const { subject, html, text } = render(fsaPayload());
    expect(subject).toBe("115 homes sold near you in October");
    for (const s of [subject, html, text]) expect(s).not.toContain("M5A");
  });

  it("sends the sign-in link to the city, never the FSA", () => {
    const sold = hrefs(render(fsaPayload()).html).find((h) => h.includes("utm_content=sold"))!;
    expect(sold).toContain("region=Toronto");
  });
});
