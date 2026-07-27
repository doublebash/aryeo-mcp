import type { AryeoApiEnv } from "../env.js";
import type {
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  OrderStatus,
} from "../constants.js";
import { aryeoFetch, filterParams, includeParam, listWithClientFilter } from "./client.js";
import { buildPath } from "./path.js";

export interface ListOrdersInput {
  status?: OrderStatus;
  payment_status?: OrderPaymentStatus;
  fulfillment_status?: OrderFulfillmentStatus;
  listing_id?: string;
  page?: number;
  per_page?: number;
  include?: string[];
}

interface OrderRecord {
  listing?: { id?: string };
}

// VERIFIED 2026-07-27 against the live account (58 orders total). Bracketed
// lowercase filters work and partition cleanly:
//   filter[status]:            open=55, canceled=3, draft=0, confirmed=0
//   filter[payment_status]:    paid=49, unpaid=9, partially_paid=0
//   filter[fulfillment_status]: fulfilled=47, unfulfilled=11
// The flat forms this code used to send (payment_status=PAID etc.) all returned
// the unfiltered 58. There is NO working listing filter — filter[listing_id],
// filter[listing] and filter[listing_ids][] were each ignored — so that one is
// applied client-side.
export async function listOrders(env: AryeoApiEnv, input: ListOrdersInput): Promise<unknown> {
  const serverQuery = {
    ...filterParams({
      status: input.status,
      payment_status: input.payment_status,
      fulfillment_status: input.fulfillment_status,
    }),
    ...(includeParam(input.include) !== undefined
      ? { include: includeParam(input.include) }
      : {}),
  };

  if (input.listing_id !== undefined) {
    // The listing object is not in the default payload, so force the include.
    const withListing = new Set(["listing", ...(input.include ?? [])]);
    return listWithClientFilter<OrderRecord>(
      env,
      "/orders",
      { ...serverQuery, include: Array.from(withListing).join(",") },
      (order) => order.listing?.id === input.listing_id,
      `Aryeo does not support filtering /orders by listing; listing_id=${input.listing_id} applied client-side.`,
    );
  }

  return aryeoFetch(env, {
    method: "GET",
    path: "/orders",
    query: {
      ...serverQuery,
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
    },
  });
}

export async function getOrder(
  env: AryeoApiEnv,
  orderId: string,
  include?: string[],
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: buildPath("/orders/{orderId}", { orderId }),
    query: {
      ...(includeParam(include) !== undefined ? { include: includeParam(include) } : {}),
    },
  });
}

// NOTE: Aryeo has no `GET /order-items` collection endpoint. We approximate
// "list order items" by fetching the parent order with items expanded and
// returning its items[]. `product_id`, when supplied, is applied client-side
// as a post-filter on the returned items.
interface OrderWithItemsResponse {
  data?: {
    items?: Array<{ product_id?: string; product?: { id?: string } }>;
  };
}

export interface ListOrderItemsResult {
  data: Array<{ product_id?: string; product?: { id?: string } }>;
  meta: { order_id: string; count: number };
}

export async function listOrderItems(
  env: AryeoApiEnv,
  orderId: string,
  options: { product_id?: string; include?: string[] } = {},
): Promise<ListOrderItemsResult> {
  const expand = new Set(["items", ...(options.include ?? [])]);
  const data = await aryeoFetch<OrderWithItemsResponse>(env, {
    method: "GET",
    path: buildPath("/orders/{orderId}", { orderId }),
    query: {
      include: Array.from(expand).join(","),
    },
  });

  let items = data?.data?.items ?? [];
  if (options.product_id) {
    items = items.filter(
      (i) => i.product_id === options.product_id || i.product?.id === options.product_id,
    );
  }

  return { data: items, meta: { order_id: orderId, count: items.length } };
}

export async function getOrderItem(
  env: AryeoApiEnv,
  orderItemId: string,
  include?: string[],
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: buildPath("/order-items/{orderItemId}", { orderItemId }),
    query: {
      ...(includeParam(include) !== undefined ? { include: includeParam(include) } : {}),
    },
  });
}
