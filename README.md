# Aryeo MCP Server

A **Model Context Protocol** server bridging Claude to the [Aryeo](https://www.aryeo.com) real-estate media platform — listings, orders, customers, products, scheduling, and appointments — deployed on **Cloudflare Workers**.

Fork this repo, deploy to your own Cloudflare account, point Claude.ai at your worker, and Claude can read and write your Aryeo data through 15 typed tools.

Built on [`@bashco/mcp-toolkit`](https://github.com/doublebash/mcp-toolkit) — OAuth, per-client bearer tokens, rate limiting, structured logging, and typed tool dispatch are all handled by the shared library.

## Tools (15)

**Read** — `list_listings`, `get_listing`, `list_orders`, `get_order`, `list_customers`, `get_customer`, `list_products`, `list_product_categories`, `list_order_items`, `get_order_item`, `list_appointments`, `get_available_timeslots`

**Write** — `create_appointment`, `reschedule_appointment`, `cancel_appointment`

Full live catalogue at the `tools/list` MCP endpoint after deploy.

## Setup — deploy your own copy

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free plan works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and logged in (`wrangler login`)
- Node.js 22+
- An Aryeo account with API access (you'll need a REST API token — used as a Bearer token by this server)

### 1. Fork and clone

```bash
git clone https://github.com/<your-username>/aryeo-mcp
cd aryeo-mcp
npm install
```

### 2. Create a KV namespace

This stores per-client OAuth state (auth codes + hashed bearer tokens). Run:

```bash
wrangler kv:namespace create OAUTH_KV
```

Wrangler prints something like:

```
🌀 Creating namespace with title "aryeo-mcp-OAUTH_KV"
✨ Success! Add the following to your configuration file:
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "abc123def456..."
```

Edit `wrangler.toml` and replace the `id = "..."` value under `[[kv_namespaces]]` with the id wrangler just printed. The repo ships with the upstream maintainer's id committed — useless to anyone else (Cloudflare scopes KV access to your account credentials), but you still need your own to deploy under your own account.

### 3. Set secrets

Generate a fresh approval code (this is what *you* paste at `/authorize` to mint a Claude bearer — never returned to clients):

```bash
openssl rand -base64 32
```

Store it in a password manager, then push the secrets to Cloudflare:

```bash
wrangler secret put MCP_APPROVAL_CODE      # paste the value from above
wrangler secret put ARYEO_API_KEY          # your Aryeo REST API token
```

| Secret               | Purpose |
|---|---|
| `MCP_APPROVAL_CODE`  | One-time code you paste at `/authorize` to mint a Claude bearer. Never returned to clients, never used as a bearer token. |
| `ARYEO_API_KEY`      | Your Aryeo REST API token, used as `Authorization: Bearer …` against `api.aryeo.com`. |

### 4. Deploy

```bash
npm run deploy
```

Wrangler prints your worker URL — something like `https://aryeo-mcp.<your-account>.workers.dev`. Save it.

### 5. Connect Claude.ai

1. In Claude.ai, go to **Settings → Integrations → Add MCP server**
2. Server URL: `https://aryeo-mcp.<your-account>.workers.dev/mcp`
3. Claude.ai redirects you to your worker's `/authorize` page
4. Paste your `MCP_APPROVAL_CODE` and confirm
5. You're connected — Claude now has the 15 Aryeo tools available

The approval-code step happens **once per Claude.ai client**. Subsequent requests use the per-client bearer issued during this flow.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in ARYEO_API_KEY + MCP_APPROVAL_CODE; .dev.vars is gitignored
npm test                          # vitest with workers pool
npm run typecheck                 # tsc --noEmit
npm run dev                       # wrangler dev — local at http://localhost:8787/mcp
```

## Endpoints

- `GET /.well-known/oauth-authorization-server` — OAuth metadata (public)
- `GET /.well-known/oauth-protected-resource` — Resource metadata (public)
- `GET /authorize` — Approval-code paste page (public)
- `POST /approve` — Approval-code submission (rate-limited)
- `POST /token` — OAuth token exchange (rate-limited)
- `POST /register` — Dynamic client registration per RFC 7591 (rate-limited)
- `POST /mcp` — JSON-RPC tool dispatch (bearer-protected, rate-limited)

## Stack

- Cloudflare Workers (compatibility_date `2024-11-01`, `nodejs_compat`)
- TypeScript (strict)
- [Hono](https://hono.dev) v4
- [Zod](https://zod.dev) v4 (single source of truth for tool argument shapes)
- Vitest with `@cloudflare/vitest-pool-workers`
- [`@bashco/mcp-toolkit`](https://github.com/doublebash/mcp-toolkit) — shared OAuth/crypto/rate-limit/dispatch plumbing

## Notes on Aryeo's API

The published OpenAPI spec at `docs.aryeo.com` is **not** a faithful description of the live API. Differences verified against the live API (see `aryeo_mcp_gap_audit.md` for the full coverage report):

- `GET /products/{id}` is not implemented (returns `404 - Uh oh that path isn't found`)
- `GET /products` accepts flat query params (`?type=MAIN`), not bracketed (`?filter[type]=MAIN`)
- The valid `include` allowlist for `/products` is enforced server-side and returned in the 400 body when an unknown value is sent — `variants` is **not** a valid include
- Status enums are **uppercase** across listings (`DRAFT`, `FOR_SALE`, ...), orders (`CONFIRMED`, `PAID`, `FULFILLED`, ...), and appointments (`SCHEDULED`, `UNSCHEDULED`, `CANCELED` — American spelling)
- `GET /customers/{id}` works despite being absent from the spec
- `GET /appointments` does **not** support any server-side date filter (neither `start_date`, `end_date`, `start_at_gte`, nor `start_at_lte` filter the result set)

If you're extending the tool surface, **verify against the live API first** with a curl probe — the spec misses or misdescribes a real chunk of endpoints.

## Continuous deployment

`.github/workflows/deploy.yml` runs `typecheck` + `test` on every push to `main`, then deploys to Cloudflare. To enable on your fork, set two repository secrets:

- `CLOUDFLARE_API_TOKEN` — create at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) (use the "Edit Cloudflare Workers" template)
- `CLOUDFLARE_ACCOUNT_ID` — find at the bottom-right of your Cloudflare dashboard

## Contributing

Issues and PRs welcome at [github.com/doublebash/aryeo-mcp](https://github.com/doublebash/aryeo-mcp).

For changes to the underlying OAuth/crypto/rate-limit code, the toolkit lives at [github.com/doublebash/mcp-toolkit](https://github.com/doublebash/mcp-toolkit) — file issues there.

## Security

Found a vulnerability? Please **don't** open a public issue. Open a [private security advisory](https://github.com/doublebash/aryeo-mcp/security/advisories/new) on GitHub.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Bashar Basheer.
