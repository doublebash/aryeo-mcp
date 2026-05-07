import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ARYEO_API_KEY: string;
  MCP_ACCESS_TOKEN: string;
}

// Security headers applied to every HTML response
const HTML_HEADERS: HeadersInit = {
  "Content-Type": "text/html; charset=UTF-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store, no-cache",
};

// Prevent XSS by escaping user-controlled strings before inserting into HTML
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

// Constant-time string comparison to prevent timing attacks on the password check
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  // If lengths differ, still compare to avoid short-circuit leaking length info
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function authorizeHtml(oauthQuery: string, error?: string): string {
  const errorBlock = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to Aryeo</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f4f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 380px;
    }
    h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 0.4rem; }
    .subtitle { color: #71717a; font-size: 0.875rem; margin: 0 0 1.75rem; line-height: 1.5; }
    label { display: block; font-size: 0.8rem; font-weight: 500; margin-bottom: 0.4rem; color: #3f3f46; }
    input[type="password"] {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      font-size: 0.95rem;
      margin-bottom: 1.25rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="password"]:focus { border-color: #a1a1aa; }
    button {
      width: 100%;
      padding: 0.65rem;
      background: #18181b;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #27272a; }
    .error { color: #dc2626; font-size: 0.85rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Claude to Aryeo</h1>
    <p class="subtitle">Enter your access password to allow Claude to view your listings, orders, and appointments.</p>
    ${errorBlock}
    <form method="POST" action="/authorize">
      <input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}">
      <label for="password">Access password</label>
      <input type="password" id="password" name="password" placeholder="••••••••••••" autofocus required>
      <button type="submit">Allow access</button>
    </form>
  </div>
</body>
</html>`;
}

export const authHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      // Show the password form
      if (request.method === "GET") {
        return new Response(authorizeHtml(url.search), { headers: HTML_HEADERS });
      }

      // Handle form submission
      if (request.method === "POST") {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        const attemptKey = `auth:attempts:${ip}`;

        // Rate limit: max 10 attempts per 15 minutes per IP
        const attempts = parseInt((await env.OAUTH_KV.get(attemptKey)) ?? "0");
        if (attempts >= 10) {
          return new Response(
            authorizeHtml("", "Too many attempts. Please wait 15 minutes and try again."),
            { status: 429, headers: HTML_HEADERS }
          );
        }

        const form = await request.formData();
        const password = (form.get("password") as string | null) ?? "";
        const oauthQuery = (form.get("oauth_query") as string | null) ?? "";

        if (!password || !timingSafeEqual(password, env.MCP_ACCESS_TOKEN)) {
          // Increment attempt counter on failure
          await env.OAUTH_KV.put(attemptKey, String(attempts + 1), { expirationTtl: 900 });
          return new Response(
            authorizeHtml(oauthQuery, "Incorrect password — please try again."),
            { status: 401, headers: HTML_HEADERS }
          );
        }

        // Success — clear the attempt counter
        await env.OAUTH_KV.delete(attemptKey);

        // Reconstruct the original OAuth GET request so we can parse its params
        const oauthUrl = new URL(request.url);
        oauthUrl.search = oauthQuery;
        const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(
          new Request(oauthUrl.toString())
        );

        if (!oauthReqInfo) {
          return new Response("Invalid OAuth request.", { status: 400 });
        }

        const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
          request: oauthReqInfo,
          userId: "owner",
          scope: oauthReqInfo.scope ?? [],
          props: {},
          metadata: {},
        });

        return Response.redirect(redirectTo, 302);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
