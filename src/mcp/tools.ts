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
    "List all orders for your Aryeo group. Filter by overall status (CONFIRMED/CANCELED/DRAFT), " +
    "payment_status (PAID/UNPAID/PARTIALLY_PAID), fulfillment_status " +
    "(FULFILLED/UNFULFILLED/PARTIALLY_FULFILLED), or a specific listing UUID. " +
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

  list_appointments:
    "List appointments scheduled in your Aryeo group. Filter by order UUID or status " +
    "(SCHEDULED/UNSCHEDULED/CANCELED). " +
    "NOTE: Aryeo's API does not support server-side date filtering on this endpoint " +
    "(verified 2026-05-18). Fetch and filter in conversation if you need a date range. " +
    "Use `include` to expand related resources — common values: order, customer, agents, listing, address.",

  get_available_timeslots:
    "Get available appointment timeslots for scheduling a shoot, within a date range. " +
    "Optionally filter by order UUID or region UUID. Dates are YYYY-MM-DD.",

  create_appointment:
    "Book a new appointment for a listing shoot against an existing order. " +
    "start_at is ISO 8601 with timezone offset (e.g. 2025-06-01T10:00:00+12:00). " +
    "duration is in minutes (15-480). " +
    "notify_customer (default true) sends a confirmation email to the order's customer.",

  reschedule_appointment:
    "Reschedule an existing appointment to a new start time. " +
    "start_at is ISO 8601 with timezone offset. " +
    "notify_customer (default true) sends a notification to the customer about the change.",

  cancel_appointment:
    "Cancel an existing appointment. Optionally provide a cancellation reason (max 500 chars). " +
    "notify_customer (default true) sends a cancellation email to the customer.",

  list_products:
    "List all products in your Aryeo group — services, packages, add-ons. " +
    "Each product is returned with `variants` (pricing, duration) and `categories` already expanded. " +
    "Filter by type (MAIN = top-level services, ADDON = add-ons), search by title/description, " +
    "or set active=false to also include inactive products. " +
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
