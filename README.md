# Aryeo MCP Server

A custom Model Context Protocol (MCP) server that gives Claude live access to an [Aryeo](https://www.aryeo.com) account — listings, orders, customers, products, scheduling, and appointments — through natural language in Claude Desktop, claude.ai, and Claude Mobile.

Hosted on Cloudflare Workers; built on the shared [`@bashco/mcp-toolkit`](../../../ruflo-test/audits/mcp-toolkit) library.

## Tools (15)

**Read** — `list_listings`, `get_listing`, `list_orders`, `get_order`, `list_customers`, `get_customer`, `list_products`, `list_product_categories`, `list_order_items`, `get_order_item`, `list_appointments`, `get_available_timeslots`

**Write** — `create_appointment`, `reschedule_appointment`, `cancel_appointment`

## Local development

```sh
cp .dev.vars.example .dev.vars
# fill in ARYEO_API_KEY + MCP_APPROVAL_CODE
npm install
npm run dev          # http://localhost:8787/mcp
```

## Deploy

```sh
npm run deploy
```

Secrets (`ARYEO_API_KEY`, `MCP_APPROVAL_CODE`) are stored in Cloudflare via `wrangler secret put` — never in this repo.

## Endpoints

- `GET /.well-known/oauth-authorization-server` — OAuth metadata (public)
- `GET /.well-known/oauth-protected-resource` — Resource metadata (public)
- `GET /authorize` — Approval-code paste page (public)
- `POST /approve` — Approval-code submission (rate-limited)
- `POST /token` — OAuth token exchange (rate-limited)
- `POST /register` — Dynamic client registration per RFC 7591 (rate-limited)
- `POST /mcp` — JSON-RPC tool dispatch (bearer-protected, rate-limited)

## Test + typecheck

```sh
npm run typecheck
npm test
```

## Notes on Aryeo's API

The published OpenAPI spec at `docs.aryeo.com` is **not** a faithful description of the live API. Verified differences:

- `GET /products/{id}` is not implemented (returns `404 - Uh oh that path isn't found`)
- `GET /products` accepts flat query params (`?type=MAIN`), not bracketed (`?filter[type]=MAIN`)
- The valid `include` allowlist for `/products` is enforced server-side and returned in the 400 body when an unknown value is sent — `variants` is **not** a valid include
- Status enums are **uppercase** across listings (`DRAFT`, `FOR_SALE`, ...), orders (`CONFIRMED`, `PAID`, `FULFILLED`, ...), and appointments (`SCHEDULED`, `UNSCHEDULED`, `CANCELED` — American spelling)
- `GET /customers/{id}` works despite being absent from the spec (verified 2026-05-18)
- `GET /appointments` does **not** support any server-side date filter (verified 2026-05-18 — neither `start_date`, `end_date`, `start_at_gte`, nor `start_at_lte` filter the result set)

See `aryeo_mcp_gap_audit.md` for the full coverage report and the v2 migration audit at `~/ruflo-test/audits/aryeo-mcp/AUDIT.md` for the rebuild rationale.
