/**
 * StreetLedgerCard render tests — the card is the last hop before a VOW field reaches a
 * browser, and its rows became links, so both properties are asserted against real
 * emitted HTML rather than inferred from the source.
 *
 * Rendered with renderToStaticMarkup under the repo's `node` vitest environment: this
 * component is a Server Component, so static markup IS what a visitor receives.
 * `next/link` and SignInLink are stubbed — Link renders an <a href> anyway, and
 * SignInLink reads usePathname(), which has no router to read in a bare render.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LedgerSale, StreetLedgerGated } from "@/lib/address/streetLedger";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/auth/SignInLink", () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("a", { href: "/login" }, children),
}));

const { default: StreetLedgerCard } = await import("./StreetLedgerCard");

const sale = (over: Partial<LedgerSale> = {}): LedgerSale => ({
  listingKey: "X12639568",
  address: "761 Cappamore Drive",
  city: "Barrhaven",
  closePrice: 845_000,
  dateISO: "2024-05-13",
  subType: "Detached",
  ...over,
});

const gated = (sales: LedgerSale[]): StreetLedgerGated => ({
  streetLabel: "Cappamore Drive",
  count: sales.length,
  sales,
});

const render = (props: Parameters<typeof StreetLedgerCard>[0]) =>
  renderToStaticMarkup(React.createElement(StreetLedgerCard, props));

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("StreetLedgerCard — consumer rows", () => {
  it("links each row to that record's canonical keyed /address URL", () => {
    const html = render({
      isConsumer: true,
      gated: gated([sale(), sale({ listingKey: "N13485582", address: "755 Cappamore Drive" })]),
      publicLedger: null,
    });
    expect(hrefs(html)).toEqual([
      "/address/on/barrhaven/761-cappamore-drive-X12639568",
      "/address/on/barrhaven/755-cappamore-drive-N13485582",
    ]);
  });

  it("leaves the subject's own row unlinked, and only that row", () => {
    const html = render({
      isConsumer: true,
      gated: gated([sale(), sale({ listingKey: "N13485582", address: "755 Cappamore Drive" })]),
      publicLedger: null,
      subjectKey: "X12639568",
    });
    expect(hrefs(html)).toEqual(["/address/on/barrhaven/755-cappamore-drive-N13485582"]);
    // The row is still rendered in full — it loses the link, not the sale.
    expect(html).toContain("761 Cappamore Drive");
    expect(html).toContain("$845k");
  });

  it("renders a row whose key the route cannot parse, but does not link it", () => {
    const html = render({
      isConsumer: true,
      gated: gated([sale({ listingKey: "N/A", address: "749 Cappamore Drive" })]),
      publicLedger: null,
    });
    expect(hrefs(html)).toEqual([]);
    expect(html).toContain("749 Cappamore Drive");
  });

  it("keeps the chevron column's width on an unlinked row so prices stay aligned", () => {
    const linked = render({ isConsumer: true, gated: gated([sale()]), publicLedger: null });
    const unlinked = render({
      isConsumer: true,
      gated: gated([sale()]),
      publicLedger: null,
      subjectKey: "X12639568",
    });
    for (const html of [linked, unlinked]) {
      expect(html).toMatch(/h-3\.5 w-3\.5 shrink-0/);
    }
  });

  it("caps the rendered rows and reports the remainder", () => {
    // MAX_DOTS is 10; an 11th sale must not silently disappear.
    const sales = Array.from({ length: 13 }, (_, i) =>
      sale({ listingKey: `X1263950${i}`, address: `${700 + i} Cappamore Drive` })
    );
    const html = render({ isConsumer: true, gated: gated(sales), publicLedger: null });
    expect(hrefs(html)).toHaveLength(10);
    expect(html).toContain("+3 earlier sales on record");
  });

  it("labels each link with the address it opens", () => {
    const html = render({ isConsumer: true, gated: gated([sale()]), publicLedger: null });
    expect(html).toContain('aria-label="Sale record for 761 Cappamore Drive"');
  });
});

describe("StreetLedgerCard — the anonymous gate", () => {
  const anonHtml = () =>
    render({ isConsumer: false, gated: null, publicLedger: { streetLabel: "Cappamore Drive", count: 7 } });

  it("emits no link to any record, because it holds no key", () => {
    expect(hrefs(anonHtml())).toEqual(["/login"]);
  });

  it("emits no civic number, price, date or key anywhere in the DOM", () => {
    const html = anonHtml();
    // The street LABEL and the sale COUNT are the established anon teaser. Everything
    // that identifies or values a specific home is not.
    for (const leak of ["761", "845", "2024", "X12639568"]) expect(html).not.toContain(leak);
    expect(html).toContain("Cappamore Drive ledger");
    expect(html).toContain("7 recorded sales");
  });

  it("ignores a gated ledger handed to it by mistake", () => {
    // Defence in depth: the page decides who is a consumer, but a wiring slip must not
    // be what publishes VOW figures.
    const html = render({
      isConsumer: false,
      gated: gated([sale()]),
      publicLedger: { streetLabel: "Cappamore Drive", count: 7 },
    });
    expect(html).not.toContain("761 Cappamore Drive");
    expect(html).not.toContain("845");
    expect(hrefs(html)).toEqual(["/login"]);
  });

  it("renders nothing at all when the street has no recorded sale", () => {
    expect(render({ isConsumer: false, gated: null, publicLedger: { streetLabel: "Cappamore Drive", count: 0 } })).toBe("");
    expect(render({ isConsumer: true, gated: gated([]), publicLedger: null })).toBe("");
  });
});
