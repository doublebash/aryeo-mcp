import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aryeoFetch, buildQuery } from "./aryeo.js";

// Validated ID: UUID or alphanumeric slug, max 128 chars — prevents path traversal
const safeId = z.string().regex(/^[a-zA-Z0-9_|-]{1,128}$/, "Invalid ID format");

// Validated date strings
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");
const isoDatetime = z.string().datetime({ offset: true });

// Validated relation name: lowercase + underscore only, max 32 chars per item, max 10 items.
// Used for ?include= query params on Aryeo's REST endpoints — caller passes an array
// (e.g. ["customer","agents"]) which is joined to a comma-separated string for the API.
// Allow dotted paths (e.g. "order.address") used by some Aryeo includes.
const includeRelations = z
  .array(z.string().regex(/^[a-z_][a-z_.]{0,63}$/, "Invalid include name"))
  .max(10)
  .optional();

// Common include hints (non-exhaustive — Aryeo accepts others; these are surfaced for discoverability):
//   Orders   → customer, agents, items, listing, appointments, address, group
//   Listings → address, agents, group, groups, images, videos, floor_plans, downloads, files
//   Products → variants, categories (per Aryeo docs; not enumerated in OpenAPI spec)

// UUID v4 — used for category filters and any UUID-typed list filter the API requires
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Must be a v4 UUID"
  );

export function registerTools(server: McpServer, apiKey: string) {
  // ── Listings ──────────────────────────────────────────────────────────────

  server.tool(
    "list_listings",
    "List all real estate listings accessible to your Aryeo group. Optionally filter by status or search by address. Use `include` to expand related resources like agents, address, images.",
    {
      status: z.enum(["active", "archived", "draft"]).optional().describe("Filter by listing status"),
      search: z.string().max(200).optional().describe("Search by address or MLS number"),
      page: z.number().int().positive().optional().describe("Page number for pagination"),
      per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: address, agents, group, groups, images, videos, floor_plans, downloads, files."
      ),
    },
    async ({ status, search, page, per_page, include }) => {
      try {
        const query = buildQuery({ status, search, page, per_page, include: include?.join(",") });
        const data = await aryeoFetch(`/listings${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "get_listing",
    "Retrieve full details for a single listing including media, stats, and metadata. Use `include` to expand related resources (e.g. agents, address) — these are NOT returned by default.",
    {
      listing_id: safeId.describe("The Aryeo listing ID"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: address, agents, group, groups, images, videos, floor_plans, downloads, files."
      ),
    },
    async ({ listing_id, include }) => {
      try {
        const query = buildQuery({ include: include?.join(",") });
        const data = await aryeoFetch(`/listings/${listing_id}${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // ── Orders ────────────────────────────────────────────────────────────────

  server.tool(
    "list_orders",
    "List all orders for your group. Optionally filter by status or listing. Use `include` to expand related resources like customer, agents, items.",
    {
      status: z
        .enum(["pending", "fulfilled", "cancelled", "in_progress"])
        .optional()
        .describe("Filter by order status"),
      listing_id: safeId.optional().describe("Filter orders for a specific listing"),
      page: z.number().int().positive().optional().describe("Page number for pagination"),
      per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: customer, agents, items, listing, appointments, address, group."
      ),
    },
    async ({ status, listing_id, page, per_page, include }) => {
      try {
        const query = buildQuery({ status, listing_id, page, per_page, include: include?.join(",") });
        const data = await aryeoFetch(`/orders${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "get_order",
    "Retrieve full details for a single order including line items, payment status, and linked listing. Use `include` to expand customer, agents, items, etc. — these are NOT returned by default.",
    {
      order_id: safeId.describe("The Aryeo order ID"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: customer, agents, items, listing, appointments, address, group."
      ),
    },
    async ({ order_id, include }) => {
      try {
        const query = buildQuery({ include: include?.join(",") });
        const data = await aryeoFetch(`/orders/${order_id}${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // ── Scheduling ────────────────────────────────────────────────────────────

  server.tool(
    "get_available_timeslots",
    "Get available appointment timeslots for scheduling a shoot. Requires a date range and optionally filters by product or region.",
    {
      start_date: isoDate.describe("Start of date range to check (YYYY-MM-DD)"),
      end_date: isoDate.describe("End of date range to check (YYYY-MM-DD)"),
      order_id: safeId.optional().describe("Filter timeslots for a specific order"),
      region_id: safeId.optional().describe("Filter by region ID"),
    },
    async ({ start_date, end_date, order_id, region_id }) => {
      try {
        const query = buildQuery({ start_date, end_date, order_id, region_id });
        const data = await aryeoFetch(`/scheduling/available-timeslots${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // ── Appointments ──────────────────────────────────────────────────────────

  server.tool(
    "list_appointments",
    "List appointments scheduled in your Aryeo group. Optionally filter by date range, order, or status. Use `include` to expand related resources like order, customer, agents.",
    {
      start_date: isoDate.optional().describe("Earliest appointment date (YYYY-MM-DD)"),
      end_date: isoDate.optional().describe("Latest appointment date (YYYY-MM-DD)"),
      order_id: safeId.optional().describe("Filter appointments for a specific order"),
      status: z
        .enum(["confirmed", "pending", "cancelled", "completed"])
        .optional()
        .describe("Filter by appointment status"),
      page: z.number().int().positive().optional().describe("Page number for pagination"),
      per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: order, customer, agents, listing, address."
      ),
    },
    async ({ start_date, end_date, order_id, status, page, per_page, include }) => {
      try {
        const query = buildQuery({
          start_date,
          end_date,
          order_id,
          status,
          page,
          per_page,
          include: include?.join(","),
        });
        const data = await aryeoFetch(`/appointments${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "create_appointment",
    "Book a new appointment for a listing shoot.",
    {
      order_id: safeId.describe("The order this appointment belongs to"),
      start_at: isoDatetime.describe("Appointment start time in ISO 8601 format (e.g. 2025-06-01T10:00:00Z)"),
      duration: z.number().int().min(15).max(480).describe("Duration of the appointment in minutes (15–480)"),
      notify_customer: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to send a confirmation notification to the customer"),
    },
    async ({ order_id, start_at, duration, notify_customer }) => {
      try {
        const data = await aryeoFetch("/appointments/store", apiKey, {
          method: "POST",
          body: JSON.stringify({ order_id, start_at, duration, notify_customer }),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "reschedule_appointment",
    "Reschedule an existing appointment to a new start time. Optionally notify the customer of the change.",
    {
      appointment_id: safeId.describe("The appointment ID to reschedule"),
      start_at: isoDatetime.describe("New start time in ISO 8601 format (e.g. 2025-06-02T14:00:00Z)"),
      notify_customer: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to notify the customer about the reschedule"),
    },
    async ({ appointment_id, start_at, notify_customer }) => {
      try {
        const data = await aryeoFetch(`/appointments/${appointment_id}/reschedule`, apiKey, {
          method: "PUT",
          body: JSON.stringify({ start_at, notify_customer }),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "cancel_appointment",
    "Cancel an existing appointment. Optionally notify the customer and provide a cancellation reason.",
    {
      appointment_id: safeId.describe("The appointment ID to cancel"),
      reason: z.string().max(500).optional().describe("Optional cancellation reason"),
      notify_customer: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to notify the customer about the cancellation"),
    },
    async ({ appointment_id, reason, notify_customer }) => {
      try {
        const body: Record<string, unknown> = { notify_customer };
        if (reason) body['reason'] = reason;
        const data = await aryeoFetch(`/appointments/${appointment_id}/cancel`, apiKey, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // ── Customers ─────────────────────────────────────────────────────────────

  server.tool(
    "list_customers",
    "List customers in your Aryeo group. Optionally search by name or email. Use `include` to expand related resources like orders, group.",
    {
      search: z.string().max(200).optional().describe("Search by name or email"),
      page: z.number().int().positive().optional().describe("Page number for pagination"),
      per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: orders, listings, group."
      ),
    },
    async ({ search, page, per_page, include }) => {
      try {
        const query = buildQuery({ search, page, per_page, include: include?.join(",") });
        const data = await aryeoFetch(`/customers${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "get_customer",
    "Retrieve full details for a single customer by their ID. Use `include` to expand related resources like orders, listings.",
    {
      customer_id: safeId.describe("The Aryeo customer ID"),
      include: includeRelations.describe(
        "Related resources to expand. Common values: orders, listings, group."
      ),
    },
    async ({ customer_id, include }) => {
      try {
        const query = buildQuery({ include: include?.join(",") });
        const data = await aryeoFetch(`/customers/${customer_id}${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // ── Products ──────────────────────────────────────────────────────────────

  server.tool(
    "list_products",
    "List all products in your Aryeo group — services, packages, and add-ons. Each product comes back with its `variants` (pricing, duration) and `categories` already expanded by default. Optionally filter by type (MAIN/ADDON), active state, or search term.",
    {
      type: z
        .enum(["MAIN", "ADDON"])
        .optional()
        .describe("Filter by product type. MAIN = top-level services/packages, ADDON = add-on items"),
      active: z
        .boolean()
        .optional()
        .describe(
          "true (default) returns only active products; false also returns inactive products. Mapped to ?include_inactive=true on the API when false."
        ),
      search: z.string().max(255).optional().describe("Search products by title or description"),
      page: z.number().int().positive().optional().describe("Page number for pagination"),
      per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
      include: includeRelations.describe(
        "Related resources to expand. Verified-allowed by Aryeo for /products: categories, categoriesCount, categoriesExists, order_form_categories, order_form_categoriesCount, order_form_categoriesExists, order_form_categories.order_form. (`variants` is NOT a valid include here — variants are returned in the default response.)"
      ),
    },
    async ({ type, active, search, page, per_page, include }) => {
      try {
        // Aryeo's published OpenAPI spec advertises filter[*] syntax for /products, but
        // the live API rejects bracketed filters and only accepts flat query params here.
        // active=true is the API default (active-only); only pass include_inactive=true
        // when the caller explicitly opts into inactive products.
        const query = buildQuery({
          page,
          per_page,
          type,
          search,
          include_inactive: active === false ? true : undefined,
          include: include?.join(","),
        });
        const data = await aryeoFetch(`/products${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // NOTE: There is no `get_product` tool. Aryeo's API has no `GET /products/{id}`
  // endpoint — confirmed live with a real product UUID, response is a 404 with the
  // body `"404 - Uh oh that path isn't found"`. Single-product detail is unavailable;
  // callers should use `list_products` with `search=...` to locate one and read the
  // (already-expanded) `variants` and `categories` from the collection response.

  server.tool(
    "list_product_categories",
    "List all product categories used to organise the catalogue (e.g. Photography, Video, Floor Plans).",
    {
      search: z.string().max(255).optional().describe("Search categories by title"),
      page: z.number().int().positive().optional().describe("Page number for pagination"),
      per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
    },
    async ({ search, page, per_page }) => {
      try {
        // /product-categories accepts flat ?search= per the same live-API behaviour as
        // /products (Aryeo's docs spec is unreliable on this).
        const query = buildQuery({
          page,
          per_page,
          search,
        });
        const data = await aryeoFetch(`/product-categories${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  // ── Order Items ───────────────────────────────────────────────────────────
  // NOTE: Aryeo exposes only POST /order-items, GET /order-items/{id}, PUT, DELETE.
  // There is NO GET /order-items collection endpoint, so cross-order line-item listing
  // isn't supported by the API. We approximate "list order items" by fetching one order
  // and returning its items[] (via /orders/{order_id}?include=items). product_id, when
  // supplied, is applied client-side as a post-filter on the returned items.

  server.tool(
    "list_order_items",
    "List the line items on a single order. Useful for product-level breakdown of an order. NOTE: Aryeo does not expose a global order-items list endpoint, so order_id is required — this fetches /orders/{order_id} with items expanded and returns the items array. product_id (if supplied) is applied as a client-side filter on the returned items.",
    {
      order_id: safeId.describe("The Aryeo order ID whose line items to list (required)"),
      product_id: uuid.optional().describe("If supplied, only return items whose product UUID matches"),
      page: z.number().int().positive().optional().describe("Reserved for future use; currently no-op (not supported by underlying endpoint)"),
      per_page: z.number().int().min(1).max(100).optional().describe("Reserved for future use; currently no-op"),
      include: includeRelations.describe(
        "Related resources to expand on the parent order. `items` is always included by this tool."
      ),
    },
    async ({ order_id, product_id, include }) => {
      try {
        const expand = new Set(["items", ...(include ?? [])]);
        const query = buildQuery({ include: Array.from(expand).join(",") });
        const data = await aryeoFetch<{ data?: { items?: Array<{ product_id?: string; product?: { id?: string } }> } }>(
          `/orders/${order_id}${query}`,
          apiKey
        );

        let items = data?.data?.items ?? [];
        if (product_id) {
          items = items.filter(
            (i) => i.product_id === product_id || i.product?.id === product_id
          );
        }

        return {
          content: [
            { type: "text", text: JSON.stringify({ data: items, meta: { order_id, count: items.length } }, null, 2) },
          ],
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );

  server.tool(
    "get_order_item",
    "Retrieve full details for a single order line item by its UUID — pricing, quantity, status, fulfillment, and linked product. Use `include` to expand the parent order or appointment.",
    {
      order_item_id: uuid.describe("The Aryeo order item UUID"),
      include: includeRelations.describe(
        "Related resources to expand. The OpenAPI spec doesn't enumerate the full allowlist; common-sense candidates are `appointment`, `order`, `order.customer`, `product`. The API will return a 400 listing the verified-allowed set if an unknown value is sent."
      ),
    },
    async ({ order_item_id, include }) => {
      try {
        const query = buildQuery({ include: include?.join(",") });
        const data = await aryeoFetch(`/order-items/${order_item_id}${query}`, apiKey);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err) }] };
      }
    }
  );
}
