import { LayoutDashboard, Map, TrendingUp, Hammer, BarChart3, type LucideIcon } from "lucide-react";

/**
 * Single source of truth for the app's primary navigation.
 *
 * Consumed by PrimaryNav (inline tabs in AppHeader + the terminal's
 * TopCommandBar) and MobileNav (drawer). Keep this list minimal — these are
 * the top-level sections, not every contextual page (e.g. property detail,
 * compare, AVM are reached in-context, not from the primary nav).
 */
export interface NavItem {
  /** Label rendered uppercase via CSS. */
  label: string;
  href: string;
  /** Shown in the mobile drawer. */
  icon?: LucideIcon;
  /** When true, nested routes (href + "/...") also highlight this item. */
  matchPrefix?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  // The Command Center map terminal. EXACT match only: /properties/[id] and
  // /properties/compare share this prefix but are contextual sub-pages — they
  // should NOT light up "Map".
  { label: "Map", href: "/properties", icon: Map },
  { label: "Market Trends", href: "/analytics", icon: TrendingUp },
];

/**
 * Secondary destinations — growth/marketing surfaces, not core sections. Tucked
 * under a "More" dropdown on the desktop bar (keeps the primary tabs uncluttered)
 * and listed in the mobile drawer.
 */
export const MORE_NAV_ITEMS: NavItem[] = [
  { label: "Reno Upside", href: "/whats-my-home-hiding", icon: Hammer },
  // "Data Trackers", deliberately not "Data": "Market Trends" (/analytics) already sits in
  // the primary bar, and two adjacent entries that both read as "the numbers page" is a coin
  // flip for the user. /analytics is the signed-in analysis surface; /data is the free public
  // trackers. matchPrefix keeps the section lit on every /data/<tracker> page.
  //
  // This is a discoverability win ONLY. The More dropdown is a Popover rendering
  // `{open && ...}` into a portal, so these links never reach the served HTML and pass no
  // internal link equity. SiteFooter is what actually makes /data crawlable.
  { label: "Data Trackers", href: "/data", icon: BarChart3, matchPrefix: true },
];

/**
 * Whether a nav item is the active section for the current pathname.
 * Exact match by default; opt into nested-route matching via `matchPrefix`.
 * The trailing slash guards against false positives (e.g. /avm vs /avm-x).
 */
export function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (pathname === item.href) return true;
  if (item.matchPrefix && pathname.startsWith(item.href + "/")) return true;
  return false;
}
