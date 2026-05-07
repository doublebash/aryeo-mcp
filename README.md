# Aryeo MCP Server

A custom Model Context Protocol (MCP) server that gives Claude live access to an [Aryeo](https://www.aryeo.com) account — listings, orders, customers, products, scheduling, and appointments — through natural language in Claude Desktop, claude.ai, and Claude Mobile.

Hosted on Cloudflare Workers; OAuth 2.0 via `@cloudflare/workers-oauth-provider`.

## Tools (15)

**Read** — `list_listings`, `get_listing`, `list_orders`, `get_order`, `list_customers`, `get_customer`, `list_products`, `list_product_categories`, `list_order_items`, `get_order_item`, `list_appointments`, `get_available_timeslots`

**Write** — `create_appointment`, `reschedule_appointment`, `cancel_appointment`

## Local development

```sh
cp .dev.vars.example .dev.vars
# fill in ARYEO_API_KEY for local-only testing
npm install
npm run dev   # http://localhost:8787/mcp
```

## Deploy

```sh
npm run deploy
```

Secrets (`ARYEO_API_KEY`, `MCP_ACCESS_TOKEN`) are stored in Cloudflare via `wrangler secret put` — never in this repo.

## Live API verification

```sh
ARYEO_API_KEY="..." node scripts/test-new-tools.mjs
```

Prints HTTP status + response shape for each new tool against the real Aryeo API.

## Documentation

- [`aryeo_mcp_gap_audit.md`](./aryeo_mcp_gap_audit.md) — coverage report of MCP vs the full Aryeo API surface, with priority recommendations and a documented spec-vs-live-API drift caveat
- Architecture, security model, and changelog are maintained in the owner's Obsidian vault

## Notes on Aryeo's API

The published OpenAPI spec at `docs.aryeo.com` is **not** a faithful description of the live API. Notably:

- `GET /products/{id}` is in some clients' assumptions but is not implemented (returns `404 - Uh oh that path isn't found`)
- `GET /products` accepts flat query params (`?type=MAIN`), not the spec's bracketed form (`?filter[type]=MAIN`)
- The valid `include` allowlist for `/products` is enforced server-side and returned in the 400 body when an unknown value is sent — `variants` is **not** a valid include (variants are returned by default)

Verify endpoints against the live API before wrapping. See the gap audit for details.
