import type { AryeoApiEnv } from "../env.js";
import {
  cancelAppointment,
  createAppointment,
  getAvailableTimeslots,
  listAppointments,
  rescheduleAppointment,
} from "../aryeo/appointments.js";
import { getCustomer, listCustomers } from "../aryeo/customers.js";
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

  list_appointments: (env, args) =>
    listAppointments(env, {
      ...(args.order_id !== undefined ? { order_id: args.order_id } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(args.per_page !== undefined ? { per_page: args.per_page } : {}),
      ...(args.include !== undefined ? { include: args.include } : {}),
    }),

  get_available_timeslots: (env, args) =>
    getAvailableTimeslots(env, {
      start_date: args.start_date,
      end_date: args.end_date,
      ...(args.order_id !== undefined ? { order_id: args.order_id } : {}),
      ...(args.region_id !== undefined ? { region_id: args.region_id } : {}),
    }),

  create_appointment: (env, args) =>
    createAppointment(env, {
      order_id: args.order_id,
      start_at: args.start_at,
      duration: args.duration,
      notify_customer: args.notify_customer,
    }),

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
