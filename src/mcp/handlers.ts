import { ToolError } from "@bashco/mcp-toolkit";
import { DEFAULT_SLOT_INTERVAL_MINUTES, DEFAULT_TIMEZONE } from "../constants.js";
import type { AryeoApiEnv } from "../env.js";
import { deriveOrderDuration } from "../aryeo/duration.js";
import {
  cancelAppointment,
  createAppointment,
  getAvailableTimeslots,
  listAppointments,
  rescheduleAppointment,
} from "../aryeo/appointments.js";
import { createCustomer, getCustomer, listCustomers } from "../aryeo/customers.js";
import { getListing, listListings } from "../aryeo/listings.js";
import {
  getOrder,
  getOrderItem,
  listOrderItems,
  listOrders,
} from "../aryeo/orders.js";
import { listProductCategories, listProducts } from "../aryeo/products.js";
import type { ToolArgs, ToolName } from "./schemas.js";

type Handler<N extends ToolName> = (env: AryeoApiEnv, args: ToolArgs<N>) => Promise<unknown>;

/**
 * Resolve a slot length for get_available_timeslots: explicit value wins,
 * otherwise derive it from the order's products. Aryeo requires a duration and
 * will not infer one, so we refuse to invent a number when given neither.
 */
async function resolveDuration(
  env: AryeoApiEnv,
  explicit: number | undefined,
  orderId: string | undefined,
): Promise<number> {
  if (explicit !== undefined) return explicit;
  if (orderId !== undefined) return (await deriveOrderDuration(env, orderId)).duration;
  throw new ToolError({
    userMessage:
      "Pass either `duration` (minutes) or `order_id`. Aryeo sizes availability slots by the " +
      "requested appointment length and has no default, so asking for slots without one would " +
      "return times that may not fit the shoot.",
    internalMessage: "get_available_timeslots: neither duration nor order_id supplied",
    status: 422,
    upstreamName: "Aryeo",
  });
}

export const HANDLERS: { [N in ToolName]: Handler<N> } = {
  list_listings: (env, args) =>
    listListings(env, {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.search !== undefined ? { search: args.search } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
      ...(args.include !== undefined ? { include: args.include } : {}),
    }),

  get_listing: (env, { listing_id, include }) => getListing(env, listing_id, include),

  list_orders: (env, args) =>
    listOrders(env, {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.payment_status !== undefined ? { payment_status: args.payment_status } : {}),
      ...(args.fulfillment_status !== undefined
        ? { fulfillment_status: args.fulfillment_status }
        : {}),
      ...(args.listing_id !== undefined ? { listing_id: args.listing_id } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
      ...(args.include !== undefined ? { include: args.include } : {}),
    }),

  get_order: (env, { order_id, include }) => getOrder(env, order_id, include),

  list_customers: (env, args) =>
    listCustomers(env, {
      ...(args.search !== undefined ? { search: args.search } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
      ...(args.include !== undefined ? { include: args.include } : {}),
    }),

  get_customer: (env, { customer_id, include }) => getCustomer(env, customer_id, include),

  create_customer: (env, args) =>
    createCustomer(env, {
      owner_first_name: args.owner_first_name,
      owner_last_name: args.owner_last_name,
      email: args.email,
      ...(args.phone !== undefined ? { phone: args.phone } : {}),
    }),

  list_appointments: (env, args) =>
    listAppointments(env, {
      ...(args.order_id !== undefined ? { order_id: args.order_id } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
      ...(args.include !== undefined ? { include: args.include } : {}),
    }),

  get_available_timeslots: async (env, args) => {
    const duration = await resolveDuration(env, args.duration, args.order_id);
    return getAvailableTimeslots(env, {
      start_date: args.start_date,
      ...(args.end_date !== undefined ? { end_date: args.end_date } : {}),
      duration,
      interval: args.interval ?? DEFAULT_SLOT_INTERVAL_MINUTES,
      timezone: args.timezone ?? DEFAULT_TIMEZONE,
    });
  },

  create_appointment: async (env, args) => {
    const derived =
      args.duration === undefined ? await deriveOrderDuration(env, args.order_id) : undefined;
    const duration = args.duration ?? derived!.duration;

    const appointment = await createAppointment(env, {
      order_id: args.order_id,
      start_at: args.start_at,
      duration,
      notify_customer: args.notify_customer,
    });

    // Report the length actually booked and where it came from — silently
    // booking a different span than the caller expected is exactly the failure
    // mode this rewrite exists to prevent.
    return {
      appointment,
      scheduling: {
        duration_minutes: duration,
        duration_source: derived ? "derived_from_order_products" : "explicit_caller_override",
        ...(derived ? { product_breakdown: derived.breakdown } : {}),
      },
    };
  },

  reschedule_appointment: (env, args) =>
    rescheduleAppointment(env, {
      appointment_id: args.appointment_id,
      start_at: args.start_at,
      notify_customer: args.notify_customer,
    }),

  cancel_appointment: (env, args) =>
    cancelAppointment(env, {
      appointment_id: args.appointment_id,
      notify_customer: args.notify_customer,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    }),

  list_products: (env, args) =>
    listProducts(env, {
      ...(args.type !== undefined ? { type: args.type } : {}),
      ...(args.active !== undefined ? { active: args.active } : {}),
      ...(args.search !== undefined ? { search: args.search } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
      ...(args.include !== undefined ? { include: args.include } : {}),
    }),

  list_product_categories: (env, args) =>
    listProductCategories(env, {
      ...(args.search !== undefined ? { search: args.search } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
    }),

  list_order_items: (env, { order_id, product_id, include }) =>
    listOrderItems(env, order_id, {
      ...(product_id !== undefined ? { product_id } : {}),
      ...(include !== undefined ? { include } : {}),
    }),

  get_order_item: (env, { order_item_id, include }) =>
    getOrderItem(env, order_item_id, include),
};
