/**
 * Term Registry — single source of truth for PureProperty's branded metric
 * names + plain-language explainers. Pure data/logic (no React, no Node APIs)
 * so it is unit-testable in vitest's node env and importable from both server
 * (glossary page) and client (TermTip, persona/compare configs).
 *
 * Definitions are generic concept explanations authored by hand — they are
 * NEVER raw IDX/VOW listing data passed through an LLM, and never a specific
 * listing's gated figure, so they are safe to render to anonymous users
 * (CLAUDE.md §4 / VOW). `notMls: true` surfaces the standard disclosure.
 */

export type GlossaryGroupId =
  | "valuation"
  | "cashflowCarry"
  | "timingDistress"
  | "suiteDensity"
  | "market"
  | "personas";

export type TermId =
  // valuation
  | "trueValue" | "expectedSalePrice" | "ourCall" | "dealScore" | "priceDrop"
  // cashflow & carry
  | "capRate" | "grossYield" | "carryCost" | "capitalBurn" | "monthlyCashflow"
  // timing & distress
  | "trueDom" | "stale" | "fresh" | "alphaFlag"
  // suite & density
  | "suitePotential" | "incomeSuite" | "multiUnit" | "surplusParking"
  | "densityReady" | "listingDensity"
  // market
  | "marketPulse" | "monthsOfSupply" | "soldToList" | "renovationUpside"
  | "condoFeeStability"
  // personas
  | "personaSmart" | "personaCashflow" | "personaFlippers" | "personaBuilders";

export interface TermDef {
  id: TermId;
  /** Canonical display name. THE source of truth — surfaces import this. */
  name: string;
  /** <= 40 chars. Bolded lead in the tip; inline hint where space allows. */
  subtitle: string;
  /** 1–2 sentences. Tip body + glossary entry. */
  definition: string;
  /** Optional deeper note; glossary-only. */
  methodology?: string;
  /** When true, TermTip + glossary append NOT_MLS_LINE. */
  notMls?: boolean;
  group: GlossaryGroupId;
  /** Prior/alternate names — glossary "also known as" + searchability. */
  aka?: string[];
}

export const NOT_MLS_LINE = "Our metric — not an MLS or TRREB figure.";

export const glossaryHref = (id: TermId): string => `/glossary#${id}`;

export const GLOSSARY_GROUPS: { id: GlossaryGroupId; title: string }[] = [
  { id: "valuation", title: "Valuation & Deal" },
  { id: "cashflowCarry", title: "Cashflow & Carry" },
  { id: "timingDistress", title: "Timing & Distress" },
  { id: "suiteDensity", title: "Suite & Density" },
  { id: "market", title: "Market & Value-Add" },
  { id: "personas", title: "Investor Lenses" },
];

export const TERMS: Record<TermId, TermDef> = {
  // ── Valuation & Deal ──
  trueValue: {
    id: "trueValue", group: "valuation", notMls: true,
    name: "True Value", subtitle: "What the asset is worth",
    definition:
      "Our estimate of the home's market value from comparable recent sales — independent of the asking price.",
  },
  expectedSalePrice: {
    id: "expectedSalePrice", group: "valuation", notMls: true,
    name: "Expected Sale Price", subtitle: "Likely closing price",
    definition:
      "A list-aware estimate of what this listing will likely sell for, blending its asking price with how local homes are closing versus ask. It shifts if the asking price changes.",
  },
  ourCall: {
    id: "ourCall", group: "valuation", notMls: true,
    name: "Our Call vs. The Sale", subtitle: "Our pre-sale estimate vs. result",
    definition:
      "The value our model published before the sale price was known, shown next to the actual result for transparency.",
  },
  dealScore: {
    id: "dealScore", group: "valuation", notMls: true,
    name: "Deal Score", subtitle: "0–100 deal strength",
    definition:
      "A deterministic 0–100 score that combines estimated value versus ask, cashflow, and timing signals into one comparable deal-strength grade.",
  },
  priceDrop: {
    id: "priceDrop", group: "valuation",
    name: "Price Drop", subtitle: "Total cut from peak ask",
    definition:
      "The total dollar reduction from the listing's highest ask to its current price — a seller-motivation signal.",
  },

  // ── Cashflow & Carry ──
  capRate: {
    id: "capRate", group: "cashflowCarry", notMls: true,
    name: "Cap Rate", subtitle: "Net yield on price",
    definition:
      "Estimated annual net operating income as a percentage of price — the standard income-property yield measure.",
    aka: ["Yield", "Target Gross Yield"],
  },
  grossYield: {
    id: "grossYield", group: "cashflowCarry", notMls: true,
    name: "Gross Yield", subtitle: "Gross rent ÷ price",
    definition: "Estimated annual gross rent as a percentage of price, before expenses.",
  },
  carryCost: {
    id: "carryCost", group: "cashflowCarry", notMls: true,
    name: "Carry Cost", subtitle: "Monthly cost to own",
    definition:
      "Estimated monthly cost to hold the property, itemized as mortgage, property tax, and fees.",
    aka: ["Monthly Carry"],
  },
  capitalBurn: {
    id: "capitalBurn", group: "cashflowCarry", notMls: true,
    name: "Capital Burn", subtitle: "Standardized monthly carry",
    definition:
      "A standardized estimate of the monthly cash needed to carry the property on a typical financed purchase (mortgage, taxes, fees, insurance). Use it to compare listings on equal financing terms; Carry Cost is the itemized figure for a specific deal.",
  },
  monthlyCashflow: {
    id: "monthlyCashflow", group: "cashflowCarry", notMls: true,
    name: "Monthly Cashflow", subtitle: "Rent minus carry",
    definition:
      "Estimated monthly rent minus carrying costs — positive means the property covers its own costs.",
  },

  // ── Timing & Distress ──
  trueDom: {
    id: "trueDom", group: "timingDistress", notMls: true,
    name: "True DOM", subtitle: "Real days on market",
    definition:
      "True days on market — stitched across relistings, so a property re-listed to reset its counter still shows the real elapsed time.",
    methodology:
      "We link a property's successive listing campaigns by address and stitch their durations, correcting the counter resets that consumer portals show as fresh listings.",
  },
  stale: {
    id: "stale", group: "timingDistress", notMls: true,
    name: "Stale", subtitle: "On market 90+ days",
    definition: "A listing on the market 90+ days (relist-adjusted) — often negotiable.",
  },
  fresh: {
    id: "fresh", group: "timingDistress", notMls: true,
    name: "Fresh", subtitle: "Newly listed",
    definition: "A recently listed property, by True DOM.",
  },
  alphaFlag: {
    id: "alphaFlag", group: "timingDistress", notMls: true,
    name: "Alpha Flag", subtitle: "Strongest signal on this listing",
    definition:
      "The single highest-priority investment signal we detect on a listing, surfaced in priority order: Distressed › Zoning upside › Income suite › Suite potential › Density-ready › Stale › New.",
  },

  // ── Suite & Density ──
  suitePotential: {
    id: "suitePotential", group: "suiteDensity", notMls: true,
    name: "Suite Potential", subtitle: "Possible second unit",
    definition:
      "Characteristics (e.g. a separate entrance or layout) suggest a legal secondary suite could be added. Not a guarantee — verify zoning.",
    aka: ["Duplex", "Suite / Duplex", "Duplex Candidate"],
  },
  incomeSuite: {
    id: "incomeSuite", group: "suiteDensity",
    name: "Income Suite", subtitle: "Existing second unit",
    definition: "The listing already has a second self-contained living unit.",
  },
  multiUnit: {
    id: "multiUnit", group: "suiteDensity", notMls: true,
    name: "Multi-Unit", subtitle: "Multiple dwelling units",
    definition:
      "The property contains, or strongly supports, multiple separate dwelling units.",
  },
  surplusParking: {
    id: "surplusParking", group: "suiteDensity", notMls: true,
    name: "Surplus Parking", subtitle: "Spare parking spaces",
    definition:
      "Parking spaces beyond what the unit count requires — a value and rentability signal.",
  },
  densityReady: {
    id: "densityReady", group: "suiteDensity", notMls: true,
    name: "Density Ready", subtitle: "Zoning may allow more units",
    definition:
      "Zoning and lot characteristics suggest the site may support added density (e.g. missing-middle housing). Verify with the municipality.",
    aka: ["Zoning Potential"],
  },
  listingDensity: {
    id: "listingDensity", group: "suiteDensity",
    name: "Listing Density", subtitle: "How many listings here",
    definition:
      "On the heatmap, intensity reflects the count of listings in an area. Distinct from Density Ready, which describes a single lot's zoning capacity.",
    aka: ["Density"],
  },

  // ── Market & Value-Add ──
  marketPulse: {
    id: "marketPulse", group: "market", notMls: true,
    name: "Market Pulse", subtitle: "Region price trend",
    definition:
      "Regional price and price-per-square-foot trend over time, with year-over-year movement.",
  },
  monthsOfSupply: {
    id: "monthsOfSupply", group: "market",
    name: "Months of Supply", subtitle: "How fast inventory clears",
    definition:
      "How many months it would take to sell all current listings at the recent sales pace. Low means a seller's market; high means a buyer's market.",
  },
  soldToList: {
    id: "soldToList", group: "market",
    name: "Sold / List", subtitle: "Sale price vs. ask",
    definition:
      "The ratio of sale price to asking price across recent sales. Above 100% means homes are selling over ask.",
  },
  renovationUpside: {
    id: "renovationUpside", group: "market", notMls: true,
    name: "Renovation Upside", subtitle: "Equity unlockable by renovating",
    definition:
      "An index of how much value a renovation could add relative to the home's current value, before cost.",
  },
  condoFeeStability: {
    id: "condoFeeStability", group: "market", notMls: true,
    name: "Condo Fee Stability", subtitle: "Fee-increase risk",
    definition:
      "A signal of how stable this building's condo fees have been, derived from sold condo data in the area.",
  },

  // ── Investor Lenses (personas) ──
  personaSmart: {
    id: "personaSmart", group: "personas",
    name: "Smart Homebuyer", subtitle: "Hidden value, no bidding wars",
    definition:
      "A lens tuned for buyers hunting undervalued homes, suite potential, and fair carrying costs.",
  },
  personaCashflow: {
    id: "personaCashflow", group: "personas",
    name: "Cashflow Investor", subtitle: "Maximize monthly yield",
    definition: "A lens tuned for rental income — cap rate, carry, and suite/parking upside.",
  },
  personaFlippers: {
    id: "personaFlippers", group: "personas",
    name: "Flippers & Deal Hunters", subtitle: "Buy under market, force value",
    definition: "A lens tuned for distress and timing — True DOM, price drops, and carry.",
  },
  personaBuilders: {
    id: "personaBuilders", group: "personas",
    name: "Builders & Developers", subtitle: "Land assembly & density",
    definition: "A lens tuned for lot size, frontage, and density-ready zoning.",
  },
};

export function term(id: TermId): TermDef {
  const t = TERMS[id];
  // Runtime guard for JS callers / type-bypass (the Record type alone won't catch them).
  if (!t) throw new Error(`Unknown term id: ${id}`);
  return t;
}

export function termsByGroup(): Record<GlossaryGroupId, TermDef[]> {
  const out = {} as Record<GlossaryGroupId, TermDef[]>;
  for (const g of GLOSSARY_GROUPS) out[g.id] = [];
  for (const t of Object.values(TERMS)) out[t.group].push(t);
  return out;
}

export interface TipContent {
  name: string;
  subtitle: string;
  definition: string;
  notMlsLine: string | null;
  href: string;
}

export function buildTipContent(id: TermId): TipContent {
  const t = term(id);
  return {
    name: t.name,
    subtitle: t.subtitle,
    definition: t.definition,
    notMlsLine: t.notMls ? NOT_MLS_LINE : null,
    href: glossaryHref(id),
  };
}
