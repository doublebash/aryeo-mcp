import { defineTools, type ToolMap } from "@bashco/mcp-toolkit";
import type { AryeoApiEnv } from "../env.js";
import { HANDLERS } from "./handlers.js";
import { toolSchemas, type ToolName } from "./schemas.js";

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_listings:
    "List all real estate listings accessible to your Aryeo group. " +
    "Optionally filter by status (DRAFT, FOR_SALE, SOLD, etc.) or search by address/MLS number. " +
    "Use `include` to expand related resources — common values: address, agents, group, groups, images, videos, floor_plans, downloads, files. " +
    "Returns paginated listings; pass page/per_page to navigate.",

  get_listing:
    "Retrieve full details for a single listing by its Aryeo UUID — media, stats, address, metadata. " +
    "Use `include` to expand related resources that aren't returned by default (e.g. agents, images). " +
    "Run `list_listings` first if you only have an address or MLS number.",

  list_orders:
    "List all orders for your Aryeo group. Filter by status (OPEN/DRAFT/CANCELED/CONFIRMED), " +
    "payment_status (PAID/UNPAID/PARTIALLY_PAID), fulfillment_status " +
    "(FULFILLED/UNFULFILLED/PARTIALLY_FULFILLED), or a specific listing UUID. " +
    "NOTE on status: Aryeo filters on the order's lifecycle, so most live orders are OPEN — " +
    "CONFIRMED matches almost nothing even though the response `status` field reads CONFIRMED. " +
    "Use OPEN for 'current orders' and CANCELED for cancelled ones. " +
    "listing_id has no server-side support and is applied client-side over a bounded fetch; " +
    "check `truncated` in the response meta before treating those results as complete. " +
    "Use `include` to expand related resources — common values: customer, agents, items, listing, appointments, address, group.",

  get_order:
    "Retrieve full details for a single order by its Aryeo UUID — line items, payment status, " +
    "fulfillment status, linked listing. " +
    "Use `include` to expand related resources that aren't returned by default " +
    "(customer, agents, items, etc.).",

  list_customers:
    "List customers in your Aryeo group. Optionally search by name or email. " +
    "Use `include` to expand related resources — common values: orders, listings, group.",

  get_customer:
    "Retrieve full details for a single customer by their Aryeo UUID. " +
    "Use `include` to expand related resources — common values: orders, listings, group. " +
    "Run `list_customers` first if you only have a name or email.",

  create_customer:
    "Add a new customer (agent or agency group) to your Aryeo group. " +
    "Required: owner_first_name, owner_last_name, email. Optional: phone. " +
    "The customer's display `name` is auto-set by Aryeo to '<first> <last>' — " +
    "do not try to override it. Aryeo also auto-creates a customer_team and emails " +
    "the owner an invitation; their status stays 'inactive' until they accept. " +
    "Returns the created customer record including its new Aryeo UUID.",

  list_appointments:
    "List appointments (shoots) scheduled in your Aryeo group, optionally narrowed to a date " +
    "range, an order UUID, or a status (SCHEDULED/UNSCHEDULED/CANCELED). " +
    "FOR A DAILY SHOOT BRIEFING pass start_date and end_date set to the same day — without a " +
    "date filter this returns every appointment on the account, which is megabytes of JSON and " +
    "will be truncated before you can read it. " +
    "start_date/end_date are YYYY-MM-DD and INCLUSIVE; end_date defaults to start_date, so a " +
    "lone start_date means that single day. `timezone` is an IANA name defaulting to " +
    "Pacific/Auckland, and it matters: Aryeo returns start_at in UTC, so on a NZ account roughly " +
    "40% of appointments fall on a different calendar day locally than their UTC timestamp reads. " +
    "HOW FILTERING WORKS: Aryeo itself supports NO filtering on this endpoint — not by date, not " +
    "by status, not by order (verified 2026-07-27/28; it returns the full collection with a 200 " +
    "and ignores the params). This Worker therefore applies every filter itself, over a bounded " +
    "scan of at most 500 appointments. The response meta reports `records_scanned`, " +
    "`records_matched`, `scan_limit` and, when dates were used, the `date_filter` applied. " +
    "If meta.truncated is true the account holds more appointments than the scan covered — say " +
    "so, and do NOT present the results as the complete set. " +
    "page/per_page apply only to an unfiltered call; filtered calls walk Aryeo's pages internally. " +
    "`include` is NOT supported on this tool: Aryeo rejects customer/agents/listing/address with " +
    "a 400, and the default payload already nests the order, its listing and the street address.",

  get_available_timeslots:
    "Get available appointment timeslots for scheduling a shoot. " +
    "PREFERRED USAGE: pass `order_id` and the slot length is derived from that order's " +
    "products (e.g. a Small Essentials Listing Package = 75 min), so the times returned are " +
    "long enough for the actual job. Pass `duration` (minutes) instead to override, or when " +
    "there is no order yet. One of the two is required — Aryeo sizes slots by the requested " +
    "length and has no default. " +
    "start_date is YYYY-MM-DD; end_date is optional (defaults to start_date, max 14 days — " +
    "Aryeo returns one day per request). " +
    "`interval` is how far apart candidate start times are, defaulting to the group's " +
    "configured 15 minutes. `timezone` is an IANA name, defaulting to Pacific/Auckland. " +
    "Returns one entry per day, each with its slots, plus a meta block stating the duration used.",

  create_appointment:
    "Book a new appointment for a listing shoot against an existing order. " +
    "start_at is ISO 8601 with timezone offset (e.g. 2025-06-01T10:00:00+12:00). " +
    "LEAVE `duration` UNSET unless you have a specific reason to override it: the shoot " +
    "length is then derived from the order's products, which is almost always what you want. " +
    "Aryeo does NOT do this itself — it stores whatever span it is given — so a guessed " +
    "duration silently books a photographer for the wrong length of time. " +
    "The response reports duration_minutes, duration_source and, when derived, the " +
    "per-product breakdown. " +
    "The order must already have an address, or Aryeo rejects the booking. " +
    "notify_customer (default true) sends a confirmation email to the order's customer.",

  reschedule_appointment:
    "Reschedule an existing appointment to a new start time, keeping its current length. " +
    "start_at is ISO 8601 with timezone offset. " +
    "To change how long the shoot runs, cancel and rebook with create_appointment instead — " +
    "this endpoint takes no duration. " +
    "notify_customer (default true) sends a notification to the customer about the change.",

  cancel_appointment:
    "Cancel an existing appointment. Optionally provide a cancellation reason (max 500 chars). " +
    "notify_customer (default true) sends a cancellation email to the customer.",

  list_products:
    "List all products in your Aryeo group — services, packages, add-ons. " +
    "Each product is returned with `variants` (pricing, duration) and `categories` already expanded. " +
    "Filter by type (MAIN = top-level services, ADDON = add-ons) or search by title/description. " +
    "`active` has no server-side support and is applied client-side over a bounded fetch. " +
    "Each variant's `duration` is the shoot time Aryeo has configured for that product — this " +
    "is what create_appointment uses when you leave its duration unset. " +
    "Use `include` for further expansion — verified-allowed values: categories, categoriesCount, " +
    "categoriesExists, order_form_categories, order_form_categoriesCount, order_form_categoriesExists, " +
    "order_form_categories.order_form. (`variants` is NOT a valid include here — it's in the default response.) " +
    "There is no `get_product` tool because Aryeo's API has no GET /products/{id} endpoint; " +
    "use `list_products` with `search=` to locate a specific product.",

  list_product_categories:
    "List all product categories used to organise the Aryeo catalogue " +
    "(e.g. Photography, Video, Floor Plans). Optionally search by title.",

  list_order_items:
    "List the line items on a single order — useful for product-level revenue breakdown. " +
    "Aryeo has no global order-items list endpoint, so order_id is required. " +
    "Optionally pass product_id (UUID) to client-side filter to only items of a specific product.",

  get_order_item:
    "Retrieve full details for a single order line item by its Aryeo UUID — " +
    "pricing, quantity, fulfillment status, linked product. " +
    "Use `include` to expand the parent order or appointment.",
};

const toolMap: ToolMap<AryeoApiEnv> = {};
for (const name of Object.keys(toolSchemas) as ToolName[]) {
  toolMap[name] = {
    schema: toolSchemas[name],
    description: TOOL_DESCRIPTIONS[name],
    handler: HANDLERS[name] as (env: AryeoApiEnv, args: unknown) => Promise<unknown>,
  };
}

const { toolDefinitions: definedToolDefinitions, dispatch } = defineTools<AryeoApiEnv>(toolMap);

export const toolDefinitions = definedToolDefinitions;
export const dispatchToolCall = dispatch;
