/**
 * OpenAI plugin domain verification for the assistant app (/api/mcp).
 *
 * The OpenAI Platform shows a one-time challenge token when the MCP server is connected
 * for directory submission. Set it as OPENAI_APPS_CHALLENGE in Vercel and redeploy; this
 * route then returns exactly that token as plain text. 404 while it is unset.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const token = (process.env.OPENAI_APPS_CHALLENGE ?? "").trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
