/**
 * Feature registry — the single source of truth for the in-app discovery system.
 *
 * Just as `src/lib/glossary.ts` backs every <InfoDot/>, this file backs the whole
 * "show new users what the terminal can do" surface: the Feature Guide catalog,
 * the What's-New badge, the first-run tours, the spotlight "Show me" actions and
 * the mastery meter all read from this one list. Adding a feature = adding a row
 * here (and, if you want a spotlight to point at it, a `data-tour="<id>"` on the
 * element). No other file needs to change.
 *
 * Pure/SSR-safe: this module is plain data + selectors, no `window`, no state.
 */

import {
  Map as MapIcon,
  SlidersHorizontal,
  GraduationCap,
  Navigation,
  PencilRuler,
  Palette,
  History,
  GitCompare,
  Bookmark,
  Eye,
  Layers,
  Command,
  Gauge,
  Sparkles,
  Calculator,
  Ruler,
  TrendingUp,
  Building2,
  TriangleAlert,
  LayoutGrid,
  UserCog,
  Activity,
  BarChart3,
  Hammer,
  BookOpen,
  Bell,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import type { PersonaType } from "@/lib/personas/personaConfig";
import type { GlossaryKey } from "@/lib/glossary";

/**
 * The bump-this-to-reset-"new" marker. Features tagged with `addedIn` equal to a
 * value in NEW_VERSIONS show in the What's-New tab and count toward the badge
 * until the user has seen them. Bump the app version + move features out of
 * NEW_VERSIONS as they age.
 */
export const DISCOVERY_VERSION = "2026.06.1";
const NEW_VERSIONS = new Set([DISCOVERY_VERSION]);

/**
 * Surfaces map 1:1 to the routes a user can stand on. `surfaceForPath()` resolves
 * the current pathname to one of these; features list the surfaces they live on.
 * "global" features (palette, glossary, alerts, the guide itself) show everywhere.
 */
export type DiscoverySurface =
  | "global"
  | "home"
  | "terminal"
  | "listing"
  | "compare"
  | "dashboard"
  | "analytics"
  | "avm"
  | "hiddenEquity"
  | "renovation"
  | "glossary";

export interface FeatureDef {
  /** Stable id — also the spotlight anchor key (`data-tour="<id>"`). */
  id: string;
  title: string;
  /** One line: what it does + why a user would want it. Plain English. */
  blurb: string;
  icon: LucideIcon;
  /** Where this feature lives. Used for the "On this page" filter + first-run tours. */
  surfaces: DiscoverySurface[];
  /** Grouping label in the catalog. */
  category: string;
  /**
   * CSS selector for the element to spotlight (defaults to `[data-tour="<id>"]`).
   * If the element isn't on the page, the spotlight degrades to a centered card
   * + the `href` "Open" link, so an unwired feature still teaches.
   */
  anchor?: string;
  /** Deep link surfaced as an "Open" button when the feature lives elsewhere. */
  href?: string;
  /** Personas this is most relevant to — floats it to the top of the catalog. */
  personas?: PersonaType[];
  /** Links the catalog row to an existing glossary definition. */
  glossaryKey?: GlossaryKey;
  /** Keyboard hint shown as a <kbd>, e.g. "⌘K". */
  shortcut?: string;
  /** Label for the "Open" button when `href` is set (defaults to "Open"). */
  ctaLabel?: string;
  /** Release this shipped in (for What's-New). */
  addedIn?: string;
  /** Counts toward the "tools explored" mastery meter. Default true. */
  mastery?: boolean;
}

/**
 * The catalog. Order within a surface is the catalog/tour order; persona-matched
 * rows are floated above the rest at render time.
 */
export const FEATURES: FeatureDef[] = [
  // ── Global (everywhere) ────────────────────────────────────────────────────
  {
    id: "command-palette",
    title: "Command Palette",
    blurb: "Press ⌘K to jump to any city, switch persona or map mode, and open any tool — the fastest way around the terminal.",
    icon: Command,
    surfaces: ["global"],
    category: "Navigation",
    shortcut: "⌘K",
    anchor: '[data-tour="command-palette"]',
    addedIn: DISCOVERY_VERSION,
  },
  {
    id: "glossary",
    title: "Plain-English Glossary",
    blurb: "Every metric (cap rate, carry, True DOM…) has a ⓘ next to it — tap for a plain-language definition and the formula behind it.",
    icon: BookOpen,
    surfaces: ["global"],
    category: "Help",
    href: "/glossary",
    ctaLabel: "Open glossary",
  },
  {
    id: "watchlist-alerts",
    title: "Price-Drop Alerts",
    blurb: "Save a property and the bell lights up when it's later listed below the price you saved it at.",
    icon: Bell,
    surfaces: ["global"],
    category: "Tracking",
    glossaryKey: "priceDrop",
  },

  // ── Terminal / Command Center (/properties) ────────────────────────────────
  {
    id: "terminal-search",
    title: "Location Search",
    blurb: "Type a city or neighbourhood to seed the map and ledger — your whole analysis re-runs around it.",
    icon: MapIcon,
    surfaces: ["terminal"],
    category: "Command Center",
    anchor: '[data-tour="terminal-search"]',
  },
  {
    id: "terminal-filters",
    title: "Smart Filters",
    blurb: "Price, beds and type are just the start — hit “+ Add Filter” for 20+ more (lot frontage, year built, cap-rate band, and more).",
    icon: SlidersHorizontal,
    surfaces: ["terminal"],
    category: "Command Center",
    anchor: '[data-tour="terminal-filters"]',
  },
  {
    id: "terminal-rail",
    title: "Map Tool Rail",
    blurb: "The left-edge rail is where the power lives: Schools, Commute, Draw-area, Compare, Color-by and Timeline.",
    icon: Boxes,
    surfaces: ["terminal"],
    category: "Command Center",
    anchor: '[data-tour="terminal-rail"]',
    addedIn: DISCOVERY_VERSION,
  },
  {
    id: "rail-schools",
    title: "School Filter",
    blurb: "Filter listings by a target school and a minimum rating — ideal if catchment matters.",
    icon: GraduationCap,
    surfaces: ["terminal"],
    category: "Map tools",
    personas: ["smart"],
    anchor: '[data-tour="rail-schools"]',
  },
  {
    id: "rail-commute",
    title: "Commute Isochrone",
    blurb: "Enter an address, mode and minutes — the map draws the area you can actually reach in that time.",
    icon: Navigation,
    surfaces: ["terminal"],
    category: "Map tools",
    personas: ["smart"],
    anchor: '[data-tour="rail-commute"]',
  },
  {
    id: "rail-draw",
    title: "Draw a Custom Area",
    blurb: "Lasso any shape on the map to search only inside it — then save it as a reusable “bubble”.",
    icon: PencilRuler,
    surfaces: ["terminal"],
    category: "Map tools",
    anchor: '[data-tour="rail-draw"]',
  },
  {
    id: "rail-color",
    title: "Color the Map by Any Metric",
    blurb: "Switch the heatmap to shade by yield, cap rate, days-on-market, price and more.",
    icon: Palette,
    surfaces: ["terminal"],
    category: "Map tools",
    personas: ["cashflow", "builders"],
    anchor: '[data-tour="rail-color"]',
  },
  {
    id: "rail-timeline",
    title: "Days-on-Market Timeline",
    blurb: "Toggle the timeline to filter by how long listings have sat — surface stale, motivated sellers.",
    icon: History,
    surfaces: ["terminal"],
    category: "Map tools",
    personas: ["flippers"],
    anchor: '[data-tour="rail-timeline"]',
    glossaryKey: "dom",
  },
  {
    id: "rail-compare",
    title: "Compare Properties",
    blurb: "Multi-select listings into a basket, then open a side-by-side table of price, taxes, yield and more.",
    icon: GitCompare,
    surfaces: ["terminal"],
    category: "Map tools",
    anchor: '[data-tour="rail-compare"]',
    href: "/properties/compare",
  },
  {
    id: "rail-saved",
    title: "Saved Views & Bubbles",
    blurb: "Save a filter + area combo as a named view you can jump back to any time.",
    icon: Bookmark,
    surfaces: ["terminal"],
    category: "Map tools",
    anchor: '[data-tour="rail-saved"]',
  },
  {
    id: "terminal-map-modes",
    title: "Listings · Heatmap · 3D",
    blurb: "Flip the map between pins, an aggregated heatmap, and an extruded 3D view.",
    icon: Layers,
    surfaces: ["terminal"],
    category: "Command Center",
    anchor: '[data-tour="terminal-map-modes"]',
  },
  {
    id: "terminal-quicklook",
    title: "Quick Look",
    blurb: "Click a row or map pin for an instant preview — photos and key metrics — before opening the full page.",
    icon: Eye,
    surfaces: ["terminal"],
    category: "Command Center",
    anchor: '[data-tour="terminal-quicklook"]',
  },

  // ── Listing detail (/properties/[id]) ──────────────────────────────────────
  {
    id: "listing-deal-score",
    title: "Deal Score",
    blurb: "A single A–D grade for how the asking price stacks up against the comps and the fundamentals.",
    icon: Gauge,
    surfaces: ["listing"],
    category: "Listing analysis",
    anchor: '[data-tour="listing-deal-score"]',
    glossaryKey: "dealScore",
    addedIn: DISCOVERY_VERSION,
  },
  {
    id: "listing-the-read",
    title: "“The Read”",
    blurb: "A plain-language verdict synthesized from the diligence flags — what's good, what to watch, who it's for.",
    icon: Sparkles,
    surfaces: ["listing"],
    category: "Listing analysis",
    anchor: '[data-tour="listing-the-read"]',
  },
  {
    id: "listing-underwriting",
    title: "Underwriting Sandbox",
    blurb: "A live what-if calculator — drag the sliders to see cash flow and returns for a buy-and-hold under your assumptions.",
    icon: Calculator,
    surfaces: ["listing"],
    category: "Listing analysis",
    personas: ["cashflow"],
    anchor: '[data-tour="listing-underwriting"]',
    glossaryKey: "cashflow",
  },
  {
    id: "listing-room-map",
    title: "Drawn-to-Scale Room Map",
    blurb: "A proportional floor plan generated from the room dimensions — read the layout at a glance.",
    icon: Ruler,
    surfaces: ["listing"],
    category: "Listing analysis",
    anchor: '[data-tour="listing-room-map"]',
  },
  {
    id: "listing-force-appreciation",
    title: "Force-Appreciation Upside",
    blurb: "Renovation ROI from the Value-Add Engine — where the equity is hiding and what it costs to unlock.",
    icon: TrendingUp,
    surfaces: ["listing"],
    category: "Listing analysis",
    personas: ["flippers", "builders"],
    anchor: '[data-tour="listing-force-appreciation"]',
  },
  {
    id: "listing-condo-stability",
    title: "Condo-Fee Stability",
    blurb: "A read on whether the maintenance fees look sustainable — a cheap fee today can be a special assessment tomorrow.",
    icon: Building2,
    surfaces: ["listing"],
    category: "Listing analysis",
    anchor: '[data-tour="listing-condo-stability"]',
  },
  {
    id: "listing-things-to-know",
    title: "Things to Know",
    blurb: "Auto-detected diligence flags — secondary-suite potential, flood risk and more — surfaced up front.",
    icon: TriangleAlert,
    surfaces: ["listing"],
    category: "Listing analysis",
    anchor: '[data-tour="listing-things-to-know"]',
  },

  // ── Dashboard (/dashboard) ─────────────────────────────────────────────────
  {
    id: "dashboard-persona",
    title: "Persona Switcher",
    blurb: "Pick Cashflow, Flipper, Homebuyer or Developer — the dashboard reorders to lead with the metrics you care about.",
    icon: UserCog,
    surfaces: ["dashboard"],
    category: "Dashboard",
    anchor: '[data-tour="dashboard-persona"]',
    addedIn: DISCOVERY_VERSION,
  },
  {
    id: "dashboard-action-feed",
    title: "Action Feed",
    blurb: "Everything that moved in your markets since your last visit — price drops, new listings, sold comps.",
    icon: Activity,
    surfaces: ["dashboard"],
    category: "Dashboard",
    anchor: '[data-tour="dashboard-action-feed"]',
  },
  {
    id: "dashboard-config",
    title: "Add Your Markets",
    blurb: "Add the cities and neighbourhoods you're tracking — and toggle which metric boards lead — to build the cockpit you actually use.",
    icon: LayoutGrid,
    surfaces: ["dashboard"],
    category: "Dashboard",
    anchor: '[data-tour="dashboard-config"]',
  },

  // ── Standalone tools ───────────────────────────────────────────────────────
  {
    id: "avm",
    title: "AVM Valuation",
    blurb: "An anchor-and-adjust estimator that prices a home from the coefficient engine — answer a few questions, get a number.",
    icon: Calculator,
    surfaces: ["avm", "global"],
    category: "Tools",
    href: "/avm",
    ctaLabel: "Open the AVM",
    glossaryKey: "estSalePrice",
    addedIn: DISCOVERY_VERSION,
  },
  {
    id: "hidden-equity",
    title: "Hidden Equity",
    blurb: "Find the renovations that pay back — ranked by ROI for your home or any address.",
    icon: Hammer,
    surfaces: ["hiddenEquity", "renovation", "global"],
    category: "Tools",
    href: "/hidden-equity",
    ctaLabel: "Find hidden equity",
    personas: ["flippers"],
  },
  {
    id: "analytics",
    title: "Market Analytics",
    blurb: "Rank every GTA submarket by median price, $/sqft, sold-to-list and months of inventory — then drill into one.",
    icon: BarChart3,
    surfaces: ["analytics", "global"],
    category: "Tools",
    href: "/analytics",
    ctaLabel: "Open analytics",
    personas: ["cashflow", "builders"],
    addedIn: DISCOVERY_VERSION,
  },
];

// Some rows above carry an optional `ctaLabel` not declared on FeatureDef proper;
// widen the read side so the UI can use it without casting at every call site.
export type FeatureWithCta = FeatureDef & { ctaLabel?: string };

export const FEATURES_BY_ID: Record<string, FeatureWithCta> = Object.fromEntries(
  FEATURES.map((f) => [f.id, f as FeatureWithCta])
);

export function getFeature(id: string): FeatureWithCta | undefined {
  return FEATURES_BY_ID[id];
}

/** Resolve the current pathname to a single discovery surface. */
export function surfaceForPath(pathname: string): DiscoverySurface {
  if (pathname === "/" || pathname === "") return "home";
  if (pathname === "/properties") return "terminal";
  if (pathname.startsWith("/properties/compare")) return "compare";
  if (pathname.startsWith("/properties/")) return "listing";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/analytics")) return "analytics";
  if (pathname.startsWith("/avm")) return "avm";
  if (pathname.startsWith("/hidden-equity")) return "hiddenEquity";
  if (pathname.startsWith("/whats-my-home-hiding")) return "renovation";
  if (pathname.startsWith("/glossary")) return "glossary";
  return "global";
}

/** Features relevant to a surface (always includes global), persona-ordered. */
export function featuresForSurface(
  surface: DiscoverySurface,
  persona?: PersonaType
): FeatureWithCta[] {
  const onSurface = FEATURES.filter(
    (f) => f.surfaces.includes(surface) || f.surfaces.includes("global")
  ) as FeatureWithCta[];
  if (!persona) return onSurface;
  // Stable sort: persona-matched rows first, original order preserved otherwise.
  return onSurface
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const am = a.f.personas?.includes(persona) ? 0 : 1;
      const bm = b.f.personas?.includes(persona) ? 0 : 1;
      return am - bm || a.i - b.i;
    })
    .map((x) => x.f);
}

export function featuresForPath(
  pathname: string,
  persona?: PersonaType
): FeatureWithCta[] {
  return featuresForSurface(surfaceForPath(pathname), persona);
}

/** Features that are "new" in the current release batch. */
export function newFeatures(): FeatureWithCta[] {
  return FEATURES.filter((f) => f.addedIn && NEW_VERSIONS.has(f.addedIn)) as FeatureWithCta[];
}

/** The universe of features that count toward the "tools explored" meter. */
export function masteryUniverse(): FeatureWithCta[] {
  return FEATURES.filter((f) => f.mastery !== false) as FeatureWithCta[];
}

/**
 * The ordered feature ids for a surface's first-run tour. Persona-aware on the
 * terminal and dashboard: the relevant power tool is slotted in early so a
 * Cashflow user is shown cap-rate colouring, a Flipper the DOM timeline, etc.
 */
export function tourForSurface(
  surface: DiscoverySurface,
  persona?: PersonaType
): FeatureWithCta[] {
  let ids: string[] = [];
  switch (surface) {
    case "terminal": {
      const personaTool: Partial<Record<PersonaType, string>> = {
        smart: "rail-schools",
        cashflow: "rail-color",
        flippers: "rail-timeline",
        builders: "rail-color",
      };
      ids = [
        "terminal-search",
        "terminal-filters",
        "terminal-rail",
        persona ? personaTool[persona] ?? "rail-draw" : "rail-draw",
        "command-palette",
      ];
      break;
    }
    case "listing":
      ids = ["listing-deal-score", "listing-the-read", "listing-underwriting", "watchlist-alerts"];
      break;
    case "dashboard":
      ids = ["dashboard-persona", "dashboard-action-feed", "dashboard-config"];
      break;
    case "analytics":
      ids = ["analytics"];
      break;
    default:
      ids = [];
  }
  return ids
    .map((id) => FEATURES_BY_ID[id])
    .filter((f): f is FeatureWithCta => Boolean(f));
}

/** Surfaces that get an offered first-run tour. */
export const TOUR_SURFACES: DiscoverySurface[] = ["terminal", "listing", "dashboard"];
