/**
 * Public market-data trackers registry — the single source of truth for the /data
 * hub, each tracker page, the /embed widgets, and the sitemap.
 *
 * Flip a tracker's `status` to "live" when its page ships: the hub renders "soon"
 * cards until then, and the sitemap only emits live routes. Keeping the full slate
 * here (even before each page exists) lets the hub advertise the whole vision from
 * day one while pages light up incrementally.
 */
export type TrackerStatus = "live" | "soon";

export interface TrackerDef {
  /** URL segment under /data/<slug> and /embed/<slug>. */
  slug: string;
  /** Short label for compact nav/cards. */
  navLabel: string;
  /** Hub-card title (the page owns its own SEO <h1>/<title>). */
  title: string;
  /** One-line description shown on the hub card. */
  tagline: string;
  /** Eyebrow kicker (hub card + OG image). */
  eyebrow: string;
  status: TrackerStatus;
}

export const TRACKERS: TrackerDef[] = [
  {
    slug: "price-cuts",
    navLabel: "Price Cuts",
    title: "Price-Cut Tracker",
    tagline:
      "The share of active listings that have cut their asking price, ranked across Toronto, Ottawa and the GTA.",
    eyebrow: "Price-Cut Pressure",
    status: "live",
  },
  {
    slug: "condo-fees",
    navLabel: "Condo Fees",
    title: "Condo Fee Tracker",
    tagline:
      "Where condo maintenance fees are climbing fastest — the annualized trend in fee per square foot.",
    eyebrow: "Condo Fee Inflation",
    status: "soon",
  },
  {
    slug: "price-rankings",
    navLabel: "Price Rankings",
    title: "Market Price Rankings",
    tagline:
      "Median and average sold prices, year-over-year, ranked across every GTA and Ottawa market.",
    eyebrow: "Sold-Price Rankings",
    status: "live",
  },
  {
    slug: "days-on-market",
    navLabel: "Days on Market",
    title: "Days-on-Market Leaderboard",
    tagline:
      "How fast homes actually sell in each market — true, relist-adjusted days on market.",
    eyebrow: "Speed of Sale",
    status: "live",
  },
  {
    slug: "market-temperature",
    navLabel: "Temperature",
    title: "Market Temperature",
    tagline:
      "Buyer's, balanced or seller's market — every GTA and Ottawa city scored at a glance.",
    eyebrow: "Buyer vs Seller Market",
    status: "live",
  },
  {
    slug: "rent-vs-buy",
    navLabel: "Rent vs Buy",
    title: "Rent-vs-Buy Tracker",
    tagline: "Gross rental yield and the rent-or-own maths by market and bedroom count.",
    eyebrow: "Rent or Own",
    status: "live",
  },
];

export function trackerBySlug(slug: string): TrackerDef | undefined {
  return TRACKERS.find((t) => t.slug === slug);
}

export const LIVE_TRACKERS: TrackerDef[] = TRACKERS.filter((t) => t.status === "live");
