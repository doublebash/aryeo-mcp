import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authHandler, type Env } from "./auth.js";
import { registerTools } from "./tools.js";

// 1 MB cap on incoming bodies — generous for any legitimate JSON-RPC tool call,
// blocks slow-loris / oversized-body DoS regardless of platform defaults.
const MAX_MCP_BODY_BYTES = 1024 * 1024;

// Handles authenticated requests to /mcp
const mcpHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only POST is supported — Cloudflare Workers can't hold open SSE streams
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Reject requests with unexpected content types before they reach the MCP SDK
    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.includes("application/json")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }

    // Reject oversized bodies before parsing.
    const contentLengthHeader = request.headers.get("Content-Length");
    if (contentLengthHeader !== null) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_MCP_BODY_BYTES) {
        return new Response("Payload Too Large", { status: 413 });
      }
    }

    const server = new McpServer({ name: "Aryeo MCP", version: "1.0.0" });
    registerTools(server, env.ARYEO_API_KEY);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session persistence needed
    });

    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

// OAuthProvider wraps the whole worker:
//  - /mcp       → validated by OAuth, then forwarded to mcpHandler
//  - /authorize → password form in authHandler
//  - /token     → handled automatically by OAuthProvider
//  - /register  → enables Claude to self-register as a client on first connection
//  - all others → 404 via authHandler
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
