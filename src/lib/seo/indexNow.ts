/**
 * IndexNow — tell Bing (and the other IndexNow engines) which URLs changed tonight.
 *
 * WHY. ChatGPT search, Copilot and DuckDuckGo answer from the Bing index. Bing finds our
 * pages only by crawling the sitemaps on its own schedule, so a new listing or a changed
 * price can be days old in Bing. IndexNow is one POST per night that names the changed
 * URLs; Bing then fetches them first.
 *
 * THE KEY IS PUBLIC BY DESIGN. The protocol proves site ownership by serving the key at
 * /{key}.txt (public/6f0622a4….txt). It is not a secret and grants nothing beyond this
 * POST, so it lives in the repo, not in an env var.
 *
 * Pure helpers only; the nightly sender is scripts/worker/indexNow.ts.
 */
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";
import { cityHubSlug } from "@/lib/listings/listingPath";
import { HOME_VALUE_CITIES, homeValuePath } from "@/lib/homeValue/content";
import { OUTLOOK_CITIES, outlookPath } from "@/lib/data/outlookCities";
import { getCityMarkets } from "@/lib/data/cityMarkets";
import { getBasementData } from "@/lib/data/basementValue";
import { getPriceChangeData } from "@/lib/data/priceChange";
import { getCondoData } from "@/lib/data/condoPrices";
import { getTaxData } from "@/lib/data/propertyTax";
import { getSchoolData } from "@/lib/data/schoolPrices";
import { getSoldData } from "@/lib/data/soldPrices";
import { getBestTimeData } from "@/lib/data/bestTimeToSell";

export const INDEXNOW_KEY = "6f0622a42624d95dc2c200c194920550";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** The protocol caps one POST at 10,000 URLs. */
export const INDEXNOW_MAX_URLS = 10_000;

/** Pages whose numbers change every night: the board city hubs (market facts; the same list as BOARD_MARKETS, built here without marketBoard's next/cache import) and the /data trackers. */
export function nightlyPaths(): string[] {
  const hubs = citiesFromRegions(Object.keys(REGION_TO_CITIES)).map((c) => `/property/on/${cityHubSlug(c)}`);
  const data = [
    "/data",
    "/data/over-asking",
    "/data/days-on-market",
    "/data/price-cuts",
    "/data/condo-fees",
    "/data/rents",
    "/data/rent-vs-buy",
    "/data/market-temperature",
    "/data/price-rankings",
    "/data/power-of-sale-index",
  ];
  const outlook = ["/data/housing-market", ...OUTLOOK_CITIES.map((c) => outlookPath(c.slug)), ...getCityMarkets().cities.map((c) => outlookPath(c.slug))];
  const homeValue = [homeValuePath(), ...HOME_VALUE_CITIES.map((c) => homeValuePath(c.slug))];
  const pos = ["/power-of-sale", ...OUTLOOK_CITIES.map((c) => `/power-of-sale/${c.slug}`)];
  const notSelling = ["/house-not-selling", ...OUTLOOK_CITIES.map((c) => `/house-not-selling/${c.slug}`)];
  const dom = [...OUTLOOK_CITIES, ...getCityMarkets().cities].map((c) => `/data/days-on-market/${c.slug}`);
  const basement = ["/data/basement-value", ...getBasementData().cities.filter((c) => c.modelA).map((c) => `/data/basement-value/${c.slug}`)];
  const priceChange = ["/data/price-change", ...getPriceChangeData().cities.filter((c) => c.all).map((c) => `/data/price-change/${c.slug}`)];
  const condo = ["/data/condo-prices", ...getCondoData().cities.map((c) => `/data/condo-prices/${c.slug}`)];
  const tax = ["/data/property-tax", ...getTaxData().cities.map((c) => `/data/property-tax/${c.slug}`)];
  return [...new Set([...hubs, ...data, ...outlook, ...homeValue, ...pos, ...notSelling, ...dom, ...basement, ...priceChange, ...condo, ...tax, "/data/good-time-to-buy", ...[...OUTLOOK_CITIES, ...getCityMarkets().cities].map((c) => `/data/good-time-to-buy/${c.slug}`), ...[...OUTLOOK_CITIES, ...getCityMarkets().cities].map((c) => `/data/rent-vs-buy/${c.slug}`), "/data/school-catchment-prices", ...getSchoolData().cities.map((c) => `/data/school-catchment-prices/${c.slug}`), "/data/sold-prices", ...getSoldData().cities.map((c) => `/data/sold-prices/${c.slug}`), "/data/best-time-to-sell", ...getBestTimeData().cities.map((c) => `/data/best-time-to-sell/${c.slug}`)])];
}

/** The listing page path: the stored canonical, else the legacy key path (same fallback as the sitemap). */
export function listingPath(row: { listing_key: string | null; sitemap_path: string | null }): string | null {
  if (!row.listing_key) return null;
  return row.sitemap_path || `/properties/${row.listing_key}`;
}

export interface IndexNowBody {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** Absolute, de-duplicated URLs on ONE host, split into POST bodies of at most 10,000. */
export function buildBodies(siteUrl: string, paths: string[]): IndexNowBody[] {
  const base = siteUrl.replace(/\/$/, "");
  const host = new URL(base).host;
  const urls = [...new Set(paths.filter(Boolean).map((p) => `${base}${p.startsWith("/") ? p : `/${p}`}`))];
  const bodies: IndexNowBody[] = [];
  for (let i = 0; i < urls.length; i += INDEXNOW_MAX_URLS) {
    bodies.push({
      host,
      key: INDEXNOW_KEY,
      keyLocation: `${base}/${INDEXNOW_KEY}.txt`,
      urlList: urls.slice(i, i + INDEXNOW_MAX_URLS),
    });
  }
  return bodies;
}
