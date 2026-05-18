import type { AryeoApiEnv } from "../env.js";
import type {
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  OrderStatus,
} from "../constants.js";
import { aryeoFetch, includeParam } from "./client.js";
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

export async function listOrders(env: AryeoApiEnv, input: ListOrdersInput): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/orders",
    query: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.payment_status !== undefined
        ? { payment_status: input.payment_status }
        : {}),
      ...(input.fulfillment_status !== undefined
        ? { fulfillment_status: input.fulfillment_status }
        : {}),
      ...(input.listing_id !== undefined ? { listing_id: input.listing_id } : {}),
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      ...(includeParam(input.include) !== undefined
        ? { include: includeParam(input.include) }
        : {}),
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
