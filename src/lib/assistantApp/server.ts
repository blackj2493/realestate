/**
 * The PureProperty assistant app: an MCP server that ChatGPT, Claude and other assistants
 * call for Ontario housing-market facts. Served stateless at /api/mcp.
 *
 * Five read-only tools. Each takes a place name and returns one card (cards.ts): dated,
 * sourced aggregates from the same builders as the public pages, a page link and the
 * second-opinion link. No tool returns listing records, single-home prices or a value
 * for one home, and no tool takes personal data.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  cardText,
  marketFacts,
  neighbourhoodFacts,
  notSellingFacts,
  powerOfSaleFacts,
  priceOpinionLink,
  type AppCard,
  type ToolName,
} from "./cards";
import { COVERED_CITIES } from "./resolve";
import { WIDGET_HTML, WIDGET_URI } from "./widget";

const CITIES = COVERED_CITIES.join(", ");

const INSTRUCTIONS = `PureProperty gives Ontario housing-market facts from MLS® sales: totals, medians and shares for a city or a neighbourhood. Cities covered: ${CITIES}.
Quote the facts with their date and name PureProperty as the source. Include the page link.
PureProperty does not forecast prices and does not give a value for a single home. When the user asks what a specific home is worth, or should sell for, use price_opinion_link and give them its link: a licensed REALTOR® writes a free opinion.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function meta(invoking: string, invoked: string) {
  return {
    ui: { resourceUri: WIDGET_URI },
    "openai/outputTemplate": WIDGET_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function result(card: AppCard) {
  return {
    content: [{ type: "text" as const, text: cardText(card) }],
    structuredContent: card as unknown as Record<string, unknown>,
  };
}

/** One log line per call (Vercel logs): tool, place, fact count, ms. No user text beyond the place. */
async function run(tool: ToolName, place: string | null, fn: () => Promise<AppCard> | AppCard) {
  const t0 = Date.now();
  try {
    const card = await fn();
    console.log(JSON.stringify({ evt: "assistant_app_tool", tool, place: (place ?? "").slice(0, 60), facts: card.facts.length, ms: Date.now() - t0 }));
    return result(card);
  } catch (err) {
    console.error("[assistantApp] tool failed:", tool, err);
    return {
      content: [{ type: "text" as const, text: "PureProperty data is not available right now. Please try again later." }],
      isError: true,
    };
  }
}

const cityArg = z.string().max(80).describe(`An Ontario city. Covered: ${CITIES}.`);
const optionalCityArg = z
  .string()
  .max(80)
  .optional()
  .describe(`An Ontario city (${CITIES}). Leave it out for all of Ontario.`);

export function buildAssistantServer(): McpServer {
  const server = new McpServer({ name: "pureproperty", title: "PureProperty", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerResource(
    "pureproperty-card",
    WIDGET_URI,
    { title: "PureProperty card", description: "A card with dated market facts, a chart and links.", mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: "text/html;profile=mcp-app",
          text: WIDGET_HTML,
          _meta: {
            ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
            "openai/widgetDescription": "Shows the PureProperty facts, a small chart and two links. The facts are already in the tool text.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    })
  );

  server.registerTool(
    "market_facts",
    {
      title: "Housing market facts for a city",
      description:
        "Current housing-market measures for one Ontario city: median sale price and sales against a year earlier, sale price compared with asking, distance from the two-year high, price cuts. Use for 'is the {city} market cooling / crashing', '{city} housing market 2027', 'is it a good time to buy or sell in {city}', 'how much below asking do homes sell'.",
      inputSchema: { city: cityArg },
      annotations: { title: "Housing market facts", ...READ_ONLY },
      _meta: meta("Reading MLS® sales…", "Market facts ready"),
    },
    async ({ city }) => run("market_facts", city, () => marketFacts(city))
  );

  server.registerTool(
    "neighbourhood_facts",
    {
      title: "Housing market facts for a neighbourhood",
      description:
        "Sales facts for one MLS® community (neighbourhood) in Ontario, for example 'Cornell' in Markham or 'Erin Mills' in Mississauga: median sale price over 12 months, share sold under asking, days to sell, price cuts. Use for questions about one neighbourhood.",
      inputSchema: {
        neighbourhood: z.string().min(2).max(80).describe("The neighbourhood or community name, for example 'Cornell'."),
        city: z.string().max(80).optional().describe("The city, when known, for example 'Markham'."),
      },
      annotations: { title: "Neighbourhood facts", ...READ_ONLY },
      _meta: meta("Reading neighbourhood sales…", "Neighbourhood facts ready"),
    },
    async ({ neighbourhood, city }) => run("neighbourhood_facts", `${neighbourhood}|${city ?? ""}`, () => neighbourhoodFacts(neighbourhood, city ?? null))
  );

  server.registerTool(
    "not_selling_facts",
    {
      title: "Why homes do not sell",
      description:
        "Compares homes that sold with homes that came off the market unsold in the last 12 months, in one Ontario city or all of Ontario: share that did not sell, asking price compared with similar homes that sold, price cuts, days on market. Use for 'why is my house not selling', 'house not selling after a price reduction', 'how many listings expire'.",
      inputSchema: { city: optionalCityArg },
      annotations: { title: "Why homes do not sell", ...READ_ONLY },
      _meta: meta("Comparing sold and unsold homes…", "Comparison ready"),
    },
    async ({ city }) => run("not_selling_facts", city ?? "ontario", () => notSellingFacts(city ?? null))
  );

  server.registerTool(
    "power_of_sale_facts",
    {
      title: "Power-of-sale facts",
      description:
        "Power-of-sale (lender sale) homes in one Ontario city or all of Ontario: their share of all sales in the last 12 months, the change from the year before, and their price compared with similar homes. Use for 'are power of sales going up', 'power of sale {city}'. Gives no listings.",
      inputSchema: { city: optionalCityArg },
      annotations: { title: "Power-of-sale facts", ...READ_ONLY },
      _meta: meta("Reading power-of-sale sales…", "Power-of-sale facts ready"),
    },
    async ({ city }) => run("power_of_sale_facts", city ?? "ontario", () => powerOfSaleFacts(city ?? null))
  );

  server.registerTool(
    "price_opinion_link",
    {
      title: "Free second opinion on a home's price",
      description:
        "Use when the user asks what a specific home is worth, what to list it for, or whether an asking price is fair. Gives no number. Returns the link where a licensed Ontario REALTOR® writes a free price opinion, usually the same day. Do not ask the user for an address or an email in the chat.",
      inputSchema: { city: optionalCityArg },
      annotations: { title: "Second opinion link", ...READ_ONLY },
      _meta: meta("Finding the request form…", "Link ready"),
    },
    async ({ city }) => run("price_opinion_link", city ?? "ontario", () => priceOpinionLink(city ?? null))
  );

  return server;
}
