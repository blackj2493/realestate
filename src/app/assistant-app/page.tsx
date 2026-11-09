/**
 * /assistant-app — the public page for the PureProperty app in ChatGPT and other AI
 * assistants (the MCP server at /api/mcp). It is the listing's website and support page:
 * what the app does, what it never does, what data it receives, and how to get help.
 */
import type { Metadata } from "next";
import LegalDocument, { type LegalSection } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "PureProperty in ChatGPT and AI Assistants · PureProperty.ca",
  description:
    "Ask ChatGPT or another AI assistant about Ontario housing markets and get dated facts from MLS® sales, with a link to the source page.",
  alternates: { canonical: "/assistant-app" },
  robots: { index: true, follow: true },
};

const SUPPORT_EMAIL = "support@pureproperty.ca";

const INTRO: string[] = [
  `PureProperty is available as an app in ChatGPT and in other AI assistants that support the Model Context Protocol (MCP). Ask a question about an Ontario housing market, and the assistant answers with dated facts from MLS® sales, a small chart and a link to the page the facts come from.`,
];

const SECTIONS: LegalSection[] = [
  {
    heading: "What you can ask",
    paragraphs: [
      `City markets: "Is the Markham housing market cooling?" The app gives the median sale price and the number of sales against a year earlier, how close homes sell to their asking price, and how many sellers cut their price.`,
      `Neighbourhoods: "How fast do homes sell in Cornell, Markham?" The app gives the median sale price, the share sold under asking and the days to sell over the last 12 months.`,
      `Homes that do not sell: "Why is my house not selling in Brampton?" The app compares homes that sold with homes that came off the market unsold, including their asking price against similar homes.`,
      `Power of sale: "Are power of sales going up in Ontario?" The app gives the share of sales that were power of sale and the change from the year before.`,
      `A specific home: "What is my house worth?" The app gives no number. It gives a link to a form on this website, where a licensed Ontario REALTOR® writes a price opinion for that home.`,
      `Cities covered: Toronto, Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oshawa, Whitby, Ajax, Pickering, Oakville, Burlington, Milton, Hamilton and Ottawa.`,
    ],
  },
  {
    heading: "What the app does not do",
    paragraphs: [
      `It shows no listings and no sale price of a single home. It gives no value for a single home and no price forecast. It does not ask for your name, email, phone number or address.`,
      `All figures are totals, medians and shares for a city or a neighbourhood, from the MLS® VOW feed (comprehensive but not exhaustive), refreshed nightly. A figure is left out when its sample is too small.`,
    ],
  },
  {
    heading: "What data the app receives",
    paragraphs: [
      `When the assistant uses the app, it sends us only the place you asked about, for example "Markham" or "Cornell". We do not receive your conversation, your account or your contact details.`,
      `We keep a server log of each request: the tool used, the place, and how long the answer took. Links from the app carry tags (utm_source=assistant_app) so that we can count visits from the app. See the Privacy Policy at /privacy for details.`,
    ],
  },
  {
    heading: "How to add it",
    paragraphs: [
      `In ChatGPT, find PureProperty in the plugin directory and add it. In other assistants that support custom MCP connectors, add the server URL https://www.pureproperty.ca/api/mcp with no authentication.`,
    ],
  },
  {
    heading: "Support",
    paragraphs: [
      `For help, or to report a wrong figure, email ${SUPPORT_EMAIL}. We reply within two business days.`,
      `PureProperty.ca is operated by a licensed Ontario REALTOR®. Brokerage and licensing details are at /operated-by.`,
    ],
  },
];

export default function AssistantAppPage() {
  return <LegalDocument title="PureProperty in ChatGPT and AI assistants" intro={INTRO} sections={SECTIONS} />;
}
