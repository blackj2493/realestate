import { LayoutDashboard, Map, TrendingUp, Hammer, type LucideIcon } from "lucide-react";

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
  // Public renovation-upside tool ("What's my home hiding?"). A launch growth /
  // lead-gen surface (works signed-out) — the one non-core entry we keep here so
  // it's reachable from the menu on desktop + mobile instead of being an orphan.
  { label: "Reno Upside", href: "/whats-my-home-hiding", icon: Hammer },
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
