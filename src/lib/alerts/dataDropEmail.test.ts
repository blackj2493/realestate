import { describe, expect, it } from "vitest";
import { renderDataDropEmail } from "./dataDropEmail";
import { SITE } from "./emailShell";
import { marketMapUrl } from "@/lib/dataDrop/cameras";
import type { DataDropPayload } from "@/lib/dataDrop/payload";

/**
 * Campaign-tag invariants for the weekly Data Drop.
 *
 * The one that matters most is the unsubscribe link. It must stay untagged: mail scanners
 * fire it unattended, so a tagged unsubscribe reports those machine fetches as engagement
 * and inflates the exact number the tagging exists to measure. See src/lib/email/utm.ts.
 */

const UNSUB = `${SITE}/api/email/unsubscribe?e=a%40b.com&s=sig`;
const MANAGE = `${SITE}/account/emails`;

const base = {
  weekId: "2026-W36",
  rows: [{ label: "Days to sell", value: "41", context: "up from 32 a month ago" }],
  trackers: [
    { label: "Price cuts", slug: "price-cuts" },
    { label: "Days on market", slug: "days-on-market" },
  ],
  dataAsOf: "2026-08-27T10:00:00Z",
};

const market: DataDropPayload = {
  ...base,
  scope: "market",
  region: "Milton",
  headline: {
    kind: "leverage",
    figure: "34",
    unit: "%",
    lede: "of active Milton listings have <b>cut their asking price</b>.",
    because: "Four weeks ago it was <b>27%</b>.",
  },
  others: [],
  spread: null,
};

const province: DataDropPayload = {
  ...base,
  scope: "province",
  region: "Ontario",
  headline: {
    kind: "over_ask_flip",
    figure: "47",
    unit: "%",
    lede: "of Ontario homes sold <b>above asking</b> last month.",
    because: "A year ago it was 51%.",
  },
  others: [],
  spread: { low: { region: "Hamilton", pct: 10 }, high: { region: "Oshawa", pct: 37 }, mid: null },
};

const common = {
  chipMarkets: ["Toronto", "Richmond Hill"],
  unsubscribeUrl: UNSUB,
  manageUrl: MANAGE,
  ctaTarget: "terminal" as const,
  email: "a@b.com",
  signature: "sig",
};

const hrefs = (html: string): string[] =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

const stripUtm = (href: string): string => {
  const u = new URL(href);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
  return u.toString();
};

describe("Data Drop campaign tags", () => {
  it("never tags the unsubscribe link", () => {
    for (const p of [market, province]) {
      const { html, text } = renderDataDropEmail({ payload: p, ...common });
      const unsub = hrefs(html).filter((h) => h.includes("/api/email/unsubscribe"));
      expect(unsub.length).toBeGreaterThan(0);
      for (const h of unsub) expect(h).not.toContain("utm_");
      expect(text).toContain(UNSUB);
    }
  });

  it("tags the CTA without losing the camera it points at", () => {
    const { html } = renderDataDropEmail({ payload: market, ...common });
    const cta = hrefs(html).find((h) => h.includes("utm_content=cta"));
    expect(cta, "the primary button must carry utm_content=cta").toBeTruthy();
    expect(cta).toContain("utm_source=data_drop");
    expect(cta).toContain("utm_medium=email");
    expect(cta).toContain("utm_campaign=2026-w36");
    // Stripping the tags must give back exactly the untagged destination.
    expect(stripUtm(cta!)).toBe(new URL(marketMapUrl(SITE, "Milton")).toString());
  });

  it("tags each source link with the tracker it points at", () => {
    const { html, text } = renderDataDropEmail({ payload: market, ...common });
    const tracker = hrefs(html).filter((h) => h.includes("/data/price-cuts"));
    expect(tracker.length).toBeGreaterThan(0);
    expect(tracker[0]).toContain("utm_content=tracker-price-cuts");
    expect(text).toContain("utm_content=tracker-days-on-market");
  });

  it("carries the week on the chip, and leaves the signed hop untagged", () => {
    const { html, text } = renderDataDropEmail({ payload: province, ...common });
    const chips = hrefs(html).filter((h) => h.includes("/api/email/follow-market"));
    expect(chips.length).toBe(2);
    for (const c of chips) {
      // The route tags its own 302 target; tagging the hop would only re-encode the HMAC.
      expect(c).not.toContain("utm_");
      expect(c).toContain("w=2026-W36");
      expect(c).toContain("s=sig");
    }
    expect(text).toContain("w=2026-W36");
  });

  it("tags the preference-centre link", () => {
    const { html } = renderDataDropEmail({ payload: market, ...common });
    const manage = hrefs(html).find((h) => h.includes("/account/emails"));
    expect(manage).toContain("utm_content=manage");
  });
});
