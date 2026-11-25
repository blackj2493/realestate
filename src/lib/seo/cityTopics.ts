/**
 * The city question pages (market facts, days on market, power of sale, homes not selling,
 * home value, price change, condo prices, good time to buy, rent vs buy, school catchment prices, sold prices, best time to sell, basement value)
 * and their paths, in one module so every page can link all of them. Search engines and AI
 * answer engines find and weigh pages through internal links: before this, a city hub linked
 * only the market page and a neighbourhood page linked none.
 *
 * The paths repeat the per-family helpers (outlookPath, powerOfSalePath, notSellingPath,
 * homeValuePath) as plain strings so that this module imports no page component (the views
 * render CityTopicLinks, so importing them back would be a cycle). cityTopics.test.ts pins
 * each string to its helper.
 */
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { STUDY_CITIES } from "@/lib/data/studyCities";

export type CityTopic = "market" | "days-on-market" | "power-of-sale" | "not-selling" | "home-value" | "basement-value" | "price-change" | "condo-prices" | "good-time-to-buy" | "rent-vs-buy" | "school-catchment-prices" | "sold-prices" | "best-time-to-sell";

export const daysOnMarketPath = (slug?: string) => (slug ? `/data/days-on-market/${slug}` : "/data/days-on-market");

export const CITY_TOPICS: { id: CityTopic; hub: string; path: (slug: string) => string; label: (city: string) => string }[] = [
  { id: "market", hub: "/data/housing-market", path: (s) => `/data/housing-market/${s}`, label: (c) => `${c} housing market, month by month` },
  { id: "days-on-market", hub: "/data/days-on-market", path: (s) => daysOnMarketPath(s), label: (c) => `How long homes take to sell in ${c}` },
  { id: "power-of-sale", hub: "/power-of-sale", path: (s) => `/power-of-sale/${s}`, label: (c) => `Power of sale homes in ${c}` },
  { id: "not-selling", hub: "/house-not-selling", path: (s) => `/house-not-selling/${s}`, label: (c) => `Why homes do not sell in ${c}` },
  { id: "home-value", hub: "/home-value", path: (s) => `/home-value/${s}`, label: (c) => `What is my home worth in ${c}?` },
  { id: "price-change", hub: "/data/price-change", path: (s) => `/data/price-change/${s}`, label: (c) => `Are home prices dropping in ${c}?` },
  { id: "condo-prices", hub: "/data/condo-prices", path: (s) => `/data/condo-prices/${s}`, label: (c) => `${c} condo prices and fees` },
  { id: "good-time-to-buy", hub: "/data/good-time-to-buy", path: (s) => `/data/good-time-to-buy/${s}`, label: (c) => `Is it a good time to buy in ${c}?` },
  { id: "rent-vs-buy", hub: "/data/rent-vs-buy", path: (s) => `/data/rent-vs-buy/${s}`, label: (c) => `Is it cheaper to rent or buy in ${c}?` },
  { id: "school-catchment-prices", hub: "/data/school-catchment-prices", path: (s) => `/data/school-catchment-prices/${s}`, label: (c) => `House prices by school catchment in ${c}` },
  { id: "sold-prices", hub: "/data/sold-prices", path: (s) => `/data/sold-prices/${s}`, label: (c) => `${c} sold prices by neighbourhood` },
  { id: "best-time-to-sell", hub: "/data/best-time-to-sell", path: (s) => `/data/best-time-to-sell/${s}`, label: (c) => `Best time to sell a house in ${c}` },
  { id: "basement-value", hub: "/data/basement-value", path: (s) => `/data/basement-value/${s}`, label: (c) => `Does a finished basement add value in ${c}?` },
];

export const TOPIC_HUBS: { href: string; label: string }[] = [
  { href: "/data/housing-market", label: "Housing market by city" },
  { href: "/data/days-on-market", label: "How long homes take to sell" },
  { href: "/power-of-sale", label: "Power of sale in Ontario" },
  { href: "/house-not-selling", label: "Why homes do not sell" },
  { href: "/home-value", label: "Free home value opinion" },
  { href: "/data/price-change", label: "Are home prices dropping? Same-home change" },
  { href: "/data/condo-prices", label: "Condo prices and fees by city" },
  { href: "/data/good-time-to-buy", label: "Is it a good time to buy?" },
  { href: "/data/rent-vs-buy", label: "Rent vs buy, by city" },
  { href: "/data/school-catchment-prices", label: "House prices by school catchment" },
  { href: "/data/sold-prices", label: "Sold prices by city and neighbourhood" },
  { href: "/data/best-time-to-sell", label: "Best time to sell, by month" },
  { href: "/data/basement-value", label: "What a finished basement adds" },
];

/** The topics with a page for every board market and no other city (live board data).
 *  "market", "days-on-market", "good-time-to-buy", "rent-vs-buy" and "home-value" are not: the extra cities have them
 *  from data/city-markets.json. */
export const BOARD_ONLY_TOPICS: ReadonlySet<CityTopic> = new Set(["power-of-sale", "not-selling"]);

/** The covered city for a hub slug (e.g. "markham" or "Markham"), else null. */
export function topicCity(slug: string | null | undefined): { city: string; slug: string; board: boolean } | null {
  if (!slug) return null;
  const s = slug.toLowerCase();
  const c = STUDY_CITIES.find((x) => x.slug === s);
  return c ? { ...c, board: OUTLOOK_CITIES.some((x) => x.slug === s) } : null;
}
