/**
 * /home-value content — the city list and the FAQ answers for "how much is my house worth
 * in {city}?" (Google autocomplete 2026-11-08: "how much is my house worth ontario /
 * toronto / calculator / today", "should i sell my house now or wait").
 *
 * THE PAGE RENDERS NO VALUATION. A per-home estimate is VOW-derived analytics and stays
 * behind the consumer gate (VOW_IDX_COMPLIANCE_AUDIT_2026-07-06, R12), and the owner rule
 * for offer cards (2026-11-03) is that "what it is worth" is a written opinion sent later
 * by a person. The page states city AGGREGATES (the public market board) and takes the
 * request. Pure and deterministic.
 */
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";
import { cityHubSlug } from "@/lib/listings/listingPath";
import type { CityFacts } from "@/lib/data/cityFacts";

/** The 15 board markets (same list as the market board), slugged like the city hubs. */
export const HOME_VALUE_CITIES: { city: string; slug: string }[] = citiesFromRegions(Object.keys(REGION_TO_CITIES)).map((city) => ({
  city,
  slug: cityHubSlug(city),
}));

export function homeValueCityBySlug(slug: string): string | null {
  return HOME_VALUE_CITIES.find((c) => c.slug === slug.toLowerCase())?.city ?? null;
}

export const homeValuePath = (slug?: string) => (slug ? `/home-value/${slug}` : "/home-value");

/**
 * Measured accuracy of the price-opinion engine, quoted on the page. Source: the
 * leakage-free seller backtest (PureProperty-Ops scripts/research/seller-backtest.mjs,
 * 2026-11-05): 614 past sales, blend of the repeat-sale index, similar sales and the AVM,
 * median absolute error 8.2%. Re-measure before changing the wording.
 */
export const ENGINE_BACKTEST = { sales: 614, medianErrorPct: 8 };

export function homeValueFaqs(place: string, facts: CityFacts | null): { q: string; a: string }[] {
  const t = (id: string) => facts?.facts.find((f) => f.id === id)?.text ?? null;
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" ");
  const price = t("price");
  const under = t("under_first_ask");
  const sell = t("days_to_sell");
  const cuts = t("price_cuts");
  return [
    {
      q: `How much is my house worth in ${place}?`,
      a: join(
        "It depends on the home: its size, lot, condition, upgrades and street, and on what similar homes nearby sold for recently.",
        price,
        `For a price opinion on your own home, enter its address on this page. A person checks every opinion and sends it to you by email, free.`
      ),
    },
    {
      q: "How accurate are online home value estimates?",
      a: `An online estimate cannot see inside the home, so it misses condition, renovations and layout. In a test on ${ENGINE_BACKTEST.sales} past sales, our model's typical error was about ${ENGINE_BACKTEST.medianErrorPct}%. That is why a person checks every price opinion we send, and why we give a range, not one number.`,
    },
    {
      q: `What affects home prices in ${place} right now?`,
      a: join(under, sell, cuts) || "Recent sales nearby, how many homes are for sale, and how fast they sell.",
    },
    {
      q: "Should I sell my house now or wait?",
      a: join(
        "No one can know future prices, and PureProperty does not forecast them. A price opinion tells you what your home is likely worth today and how long similar homes take to sell, so you can decide with real numbers.",
        sell
      ),
    },
    {
      q: "Is the price opinion really free?",
      a: "Yes. There is no cost and no obligation. We reply by email, and we do not call unless you ask us to.",
    },
  ];
}
