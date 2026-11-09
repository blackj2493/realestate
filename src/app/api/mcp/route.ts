/**
 * /api/mcp — the PureProperty assistant app (MCP, Streamable HTTP, stateless).
 *
 * A new server + transport per request: no sessions, no state, JSON responses. Read-only
 * aggregates (see src/lib/assistantApp/server.ts). No auth: the data is the same as the
 * public /data, /house-not-selling and /power-of-sale pages.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildAssistantServer } from "@/lib/assistantApp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handle(req: Request): Promise<Response> {
  const server = buildAssistantServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: nothing outlives the request.
    void server.close().catch(() => {});
  }
}

export { handle as GET, handle as POST, handle as DELETE };
