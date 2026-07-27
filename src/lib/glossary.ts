/**
 * Plain-language glossary for the finance / real-estate terms scattered across the
 * UI (cap rate, carry, yield, cashflow, NOI, DSCR, …). One source of truth so the
 * same wording is reused everywhere — surfaced via <InfoDot term="capRate" /> next
 * to a label, and (later) on a standalone /glossary page.
 *
 * Writing rule: lead with what it MEANS to the user in one sentence (`short`); put
 * the math in `formula` and any "what's a good number" colour in `context`. Avoid
 * jargon inside the definition itself.
 */

export interface GlossaryEntry {
  /** Display title — the canonical name of the term. */
  term: string;
  /** One-sentence plain-English definition. Required. */
  short: string;
  /** Optional formula, shown in mono. */
  formula?: string;
  /** Optional "what's a good number / why it matters" note. */
  context?: string;
}

export const GLOSSARY = {
  capRate: {
    term: "Cap rate",
    short:
      "A rental's yearly income as a share of its price — the return if you bought all-cash, with no mortgage.",
    formula: "Net operating income ÷ price",
    context: "Higher means more income per dollar. Most homes land around 3–6%.",
  },
  cashOnCash: {
    term: "Cash-on-cash return",
    short:
      "Your yearly cash profit measured against the actual cash you put in (down payment plus closing costs).",
    formula: "Annual pre-tax cash flow ÷ cash invested",
    context: "Unlike cap rate, this reflects your mortgage and how much you financed.",
  },
  carry: {
    term: "Carry cost",
    short:
      "The all-in monthly cost of owning the property — mortgage, property tax, insurance and condo/strata fees.",
    context: "What leaves your account each month, before any rent comes in.",
  },
  cashflow: {
    term: "Cash flow",
    short: "What's left each month once rent has covered every cost, including the mortgage.",
    formula: "Rent − all monthly costs",
    context: "Positive means the property pays you; negative means you top it up.",
  },
  cashflowGrade: {
    term: "Cashflow-grade",
    short:
      "The share of active listings whose estimated cap rate clears the cash-flow floor — homes whose rent would likely more than cover their monthly costs.",
    context:
      "The count beside it is how many active listings clear that floor (currently a 4.5% cap rate).",
  },
  noi: {
    term: "Net operating income (NOI)",
    short: "Rental income minus operating expenses — but before the mortgage payment.",
    context: "Measures the property's earnings on its own, separate from how you finance it.",
  },
  grossYield: {
    term: "Gross yield",
    short: "Annual rent as a percentage of the price, before any expenses.",
    formula: "Annual rent ÷ price",
    context: "A fast rent-to-price gauge. Net yield is the same idea after subtracting costs.",
  },
  dscr: {
    term: "Debt-service coverage ratio (DSCR)",
    short: "How comfortably the rent covers the mortgage payment.",
    formula: "Net operating income ÷ mortgage payment",
    context: "1.0 means rent exactly covers the loan; lenders often look for 1.2 or higher.",
  },
  ppsf: {
    term: "Price per square foot",
    short: "List price divided by interior floor area — lets you compare homes of different sizes.",
    formula: "Price ÷ square footage",
  },
  dom: {
    term: "Days on market (DOM)",
    short:
      'How long the listing has been for sale. "True DOM" stitches relistings together so a home can\'t reset the clock by re-listing.',
    context: "A long run on market can mean room to negotiate.",
  },
  priceDrop: {
    term: "Price drop",
    short: "How far the current asking price has fallen below the original list price.",
    context: "Repeated cuts can signal a motivated seller.",
  },
  vacancy: {
    term: "Vacancy",
    short: "The share of the year a rental sits empty between tenants, counted as lost rent.",
    context: "Even strong rentals budget for some vacancy — often 2–5%.",
  },
  opex: {
    term: "Operating expenses",
    short:
      "The ongoing cost of running a rental — management, maintenance and reserves — as a share of rent.",
    context: "Excludes the mortgage, which is counted separately.",
  },
  amortization: {
    term: "Amortization",
    short:
      "The number of years the mortgage is spread over. A longer term lowers the monthly payment but adds total interest.",
  },
  downPayment: {
    term: "Down payment",
    short: "The cash you pay upfront, shown as a percentage of the price. The rest is borrowed.",
  },
  dealScore: {
    term: "Deal Score",
    short:
      "PureProperty's 0–100 rating of how good a buy a listing is, scored for your chosen investor type.",
    context: "Our own deterministic metric — not an MLS/TRREB figure. Higher is better for the selected lens.",
  },
  estSalePrice: {
    term: "Estimated sale price",
    short: "Our independent estimate of what this home would realistically sell for.",
    context: "Generated from comparable sales — it is not the asking price.",
  },
  vsCompValue: {
    term: "vs comp value",
    short: "How the asking price compares to our independent comparable-sales valuation.",
    context: '"Under" means it\'s listed below what comparable sales suggest it\'s worth.',
  },
  suiteScore: {
    term: "Suite score",
    short: "Our 0–6 rating of a property's potential for a secondary (basement/rental) suite.",
  },
  loanAmount: {
    term: "Loan amount",
    short: "The size of the mortgage — the price minus your down payment.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Safe lookup — returns the entry or undefined for an unknown key. */
export function getGlossaryEntry(key: string): GlossaryEntry | undefined {
  return (GLOSSARY as Record<string, GlossaryEntry>)[key];
}
