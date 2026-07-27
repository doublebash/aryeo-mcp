import { ToolError } from "@bashco/mcp-toolkit";
import type { AryeoApiEnv } from "../env.js";
import { aryeoFetch } from "./client.js";
import { buildPath } from "./path.js";

/**
 * Derive a shoot's length in minutes from the products on an order.
 *
 * WHY THIS EXISTS (verified against the live API 2026-07-27):
 * Aryeo does NOT compute appointment length from the order's products. Its
 * scheduling endpoints take `duration` / `end_at` as caller-supplied INPUTS:
 *   - /scheduling/available-timeslots takes `duration` and sizes slots by it
 *   - /appointments/store takes `end_at` and stores whatever span it is given
 * Evidence that Aryeo does not correct a wrong value: appointment #1061 is
 * stored at 90 minutes against an order whose only product (Small Essentials
 * Listing Package) is configured at 75. Whoever calls the API owns the number,
 * so we derive it from the catalogue instead of letting it be guessed.
 *
 * JOIN KEY CAVEAT: order items do not expose a product id or a duration.
 * `GET /orders/{id}?include=items` returns only title / price / quantity, the
 * `/order-items/{id}` detail endpoint returns the same fields, and no include
 * on /orders exposes the variant (allowed includes are enumerated by Aryeo's
 * 400 response and none of them reach it). EXACT TITLE is the only sound join
 * key available.
 *
 * NO PRICE FALLBACK — measured against 27 live orders on 2026-07-27. An earlier
 * version fell back to matching on unit price when the title did not match. It
 * produced 6 of its 7 "successes" that way, and they were coincidences: order
 * #1067 "Kitchen Photogaphy" ($250) matched the product "Small Apartment Video"
 * ($250, 45 min) — an unrelated service — and would have booked 45 minutes on
 * the strength of two numbers being equal. Prices collide constantly across a
 * media catalogue, so price carries no semantic signal. It is gone.
 *
 * PRACTICAL REACH: only orders whose line items were created FROM the product
 * catalogue (i.e. placed through the Aryeo order form) can be derived. Orders
 * hand-typed in the Aryeo admin carry free-text titles like "Photos + Short
 * Video" and will not match. On the live account that is 1 order in 27. The
 * fix for that is upstream — build orders from catalogue products — not a
 * looser matcher here.
 *
 * We deliberately FAIL rather than guess when an item cannot be matched:
 * a silently wrong appointment length misallocates a photographer's day, which
 * is worse than an error telling the caller to pass an explicit duration.
 */

interface OrderItem {
  title?: string;
  quantity?: number;
  unit_price_amount?: number;
  is_canceled?: boolean;
}

interface OrderWithItems {
  data?: { items?: OrderItem[] };
}

interface ProductVariant {
  duration?: number;
  price_amount?: number;
}

interface Product {
  title?: string;
  variants?: ProductVariant[];
}

interface ProductsPage {
  data?: Product[];
  meta?: { last_page?: number };
}

export interface DerivedDuration {
  duration: number;
  breakdown: Array<{ title: string; quantity: number; minutes_each: number }>;
}

export async function deriveOrderDuration(
  env: AryeoApiEnv,
  orderId: string,
): Promise<DerivedDuration> {
  const order = await aryeoFetch<OrderWithItems>(env, {
    method: "GET",
    path: buildPath("/orders/{orderId}", { orderId }),
    query: { include: "items" },
  });

  const items = (order?.data?.items ?? []).filter((i) => i.is_canceled !== true);
  if (items.length === 0) {
    throw new ToolError({
      userMessage:
        "Cannot derive a shoot length: this order has no line items. " +
        "Add products to the order in Aryeo, or call this tool again with an explicit `duration`.",
      internalMessage: `deriveOrderDuration: order ${orderId} has no items`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  const catalogue = await fetchProductDurations(env);

  const breakdown: DerivedDuration["breakdown"] = [];
  const unmatched: string[] = [];
  let duration = 0;

  for (const item of items) {
    const title = (item.title ?? "").trim();
    const minutes = catalogue.byTitle.get(title.toLowerCase());
    if (minutes === undefined) {
      unmatched.push(title || "(untitled item)");
      continue;
    }
    const quantity = item.quantity ?? 1;
    duration += minutes * quantity;
    breakdown.push({ title, quantity, minutes_each: minutes });
  }

  if (unmatched.length > 0) {
    throw new ToolError({
      userMessage:
        `Cannot derive a shoot length: ${unmatched.length} order item(s) do not match any product ` +
        `title in the Aryeo catalogue — ${unmatched.map((t) => `"${t}"`).join(", ")}. ` +
        "This normally means the order was typed by hand in the Aryeo admin rather than placed " +
        "through the order form, so its line items are free text. " +
        "Order items expose no product id and matching on price is unsafe (unrelated services " +
        "share prices), so there is nothing reliable to derive from. " +
        "Use `list_products` to see the configured duration for the intended service, confirm " +
        "the shoot length with the user, then call again with an explicit `duration`.",
      internalMessage: `deriveOrderDuration: unmatched titles on order ${orderId}: ${unmatched.join(" | ")}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  if (duration <= 0) {
    throw new ToolError({
      userMessage:
        "Cannot derive a shoot length: every product on this order is configured with a " +
        "duration of 0 minutes (typical for edit-only services such as virtual staging, " +
        "which need no site visit). Pass an explicit `duration` if a visit is required.",
      internalMessage: `deriveOrderDuration: order ${orderId} summed to 0 minutes`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  return { duration, breakdown };
}

/** Product title (lowercased) -> configured shoot minutes. */
interface ProductCatalogue {
  byTitle: Map<string, number>;
}

async function fetchProductDurations(env: AryeoApiEnv): Promise<ProductCatalogue> {
  const byTitle = new Map<string, number>();

  // The catalogue is small (27 products on this account) but paginated at 20.
  for (let page = 1; page <= 10; page++) {
    const response = await aryeoFetch<ProductsPage>(env, {
      method: "GET",
      path: "/products",
      query: { page, per_page: 100 },
    });

    for (const product of response?.data ?? []) {
      const variant = product.variants?.[0];
      if (!variant || typeof variant.duration !== "number") continue;
      const title = (product.title ?? "").trim().toLowerCase();
      if (title) byTitle.set(title, variant.duration);
    }

    const lastPage = response?.meta?.last_page ?? page;
    if (page >= lastPage) break;
  }

  return { byTitle };
}
