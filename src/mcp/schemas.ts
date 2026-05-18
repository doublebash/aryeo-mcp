import { z } from "zod";
import {
  APPOINTMENT_DURATION_MAX,
  APPOINTMENT_DURATION_MIN,
  APPOINTMENT_STATUSES,
  CANCEL_REASON_MAX_CHARS,
  LISTING_STATUSES,
  ORDER_FULFILLMENT_STATUSES,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
  PAGE_PER_PAGE_MAX,
  PRODUCT_TYPES,
  SEARCH_MAX_CHARS,
} from "../constants.js";

// Aryeo IDs are UUIDs across every resource. Accepts any UUID layout (v1-v8);
// path-traversal protection comes from the toolkit's buildPath helper, which
// also encodeURIComponent-encodes interpolated values.
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const aryeoUuid = z.string().regex(UUID_REGEX, "Must be an Aryeo UUID");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");
const isoDatetime = z.string().datetime({ offset: true });

// `?include=` values: lowercase + underscore + dotted-path (e.g. "order.address"),
// max 64 chars per item, max 10 items.
const includeRelations = z
  .array(z.string().regex(/^[a-z_][a-z_.]{0,63}$/, "Invalid include name"))
  .max(10)
  .optional();

const pageNum = z.number().int().positive();
const perPageNum = z.number().int().min(1).max(PAGE_PER_PAGE_MAX);

const listingStatus = z.enum(LISTING_STATUSES);
const orderStatus = z.enum(ORDER_STATUSES);
const orderPaymentStatus = z.enum(ORDER_PAYMENT_STATUSES);
const orderFulfillmentStatus = z.enum(ORDER_FULFILLMENT_STATUSES);
const appointmentStatus = z.enum(APPOINTMENT_STATUSES);
const productType = z.enum(PRODUCT_TYPES);

const search = z.string().min(1).max(SEARCH_MAX_CHARS);

export const toolSchemas = {
  list_listings: z.object({
    status: listingStatus.optional(),
    search: search.optional(),
    page: pageNum.optional(),
    per_page: perPageNum.optional(),
    include: includeRelations,
  }),

  get_listing: z.object({
    listing_id: aryeoUuid,
    include: includeRelations,
  }),

  list_orders: z.object({
    status: orderStatus.optional(),
    payment_status: orderPaymentStatus.optional(),
    fulfillment_status: orderFulfillmentStatus.optional(),
    listing_id: aryeoUuid.optional(),
    page: pageNum.optional(),
    per_page: perPageNum.optional(),
    include: includeRelations,
  }),

  get_order: z.object({
    order_id: aryeoUuid,
    include: includeRelations,
  }),

  list_customers: z.object({
    search: search.optional(),
    page: pageNum.optional(),
    per_page: perPageNum.optional(),
    include: includeRelations,
  }),

  get_customer: z.object({
    customer_id: aryeoUuid,
    include: includeRelations,
  }),

  list_appointments: z.object({
    order_id: aryeoUuid.optional(),
    status: appointmentStatus.optional(),
    page: pageNum.optional(),
    per_page: perPageNum.optional(),
    include: includeRelations,
  }),

  get_available_timeslots: z.object({
    start_date: isoDate,
    end_date: isoDate,
    order_id: aryeoUuid.optional(),
    region_id: aryeoUuid.optional(),
  }),

  create_appointment: z.object({
    order_id: aryeoUuid,
    start_at: isoDatetime,
    duration: z.number().int().min(APPOINTMENT_DURATION_MIN).max(APPOINTMENT_DURATION_MAX),
    notify_customer: z.boolean().optional().default(true),
  }),

  reschedule_appointment: z.object({
    appointment_id: aryeoUuid,
    start_at: isoDatetime,
    notify_customer: z.boolean().optional().default(true),
  }),

  cancel_appointment: z.object({
    appointment_id: aryeoUuid,
    reason: z.string().min(1).max(CANCEL_REASON_MAX_CHARS).optional(),
    notify_customer: z.boolean().optional().default(true),
  }),

  list_products: z.object({
    type: productType.optional(),
    active: z.boolean().optional(),
    search: search.optional(),
    page: pageNum.optional(),
    per_page: perPageNum.optional(),
    include: includeRelations,
  }),

  list_product_categories: z.object({
    search: search.optional(),
    page: pageNum.optional(),
    per_page: perPageNum.optional(),
  }),

  list_order_items: z.object({
    order_id: aryeoUuid,
    product_id: aryeoUuid.optional(),
    include: includeRelations,
  }),

  get_order_item: z.object({
    order_item_id: aryeoUuid,
    include: includeRelations,
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;
export type ToolArgs<N extends ToolName> = z.infer<(typeof toolSchemas)[N]>;
