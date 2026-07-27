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
 * 400 response and none of them reach it). Title is therefore the only join
 * key available, with unit price as a corroborating signal.
 *
 * We deliberately FAIL rather than under-count when an item cannot be matched:
 * a silently short appointment double-books a photographer, which is worse
 * than an error telling the caller to pass an explicit duration.
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
    const minutes = lookupDuration(catalogue, title, item.unit_price_amount);
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
        `Cannot derive a shoot length: ${unmatched.length} order item(s) could not be matched ` +
        `to a product in the Aryeo catalogue — ${unmatched.join(", ")}. ` +
        "Order items expose no product id, so matching is by exact title; a renamed or " +
        "deleted product breaks it. Pass an explicit `duration` (minutes) to proceed.",
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

/** title (lowercased) -> minutes, plus a price fallback for renamed products. */
interface ProductCatalogue {
  byTitle: Map<string, number>;
  byPrice: Map<number, number>;
  ambiguousPrices: Set<number>;
}

async function fetchProductDurations(env: AryeoApiEnv): Promise<ProductCatalogue> {
  const byTitle = new Map<string, number>();
  const byPrice = new Map<number, number>();
  const ambiguousPrices = new Set<number>();

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

      const price = variant.price_amount;
      if (typeof price === "number") {
        // Several products share a price (both 120-min Premium packages are
        // $749). A price collision is only usable if the durations agree.
        const seen = byPrice.get(price);
        if (seen !== undefined && seen !== variant.duration) ambiguousPrices.add(price);
        else byPrice.set(price, variant.duration);
      }
    }

    const lastPage = response?.meta?.last_page ?? page;
    if (page >= lastPage) break;
  }

  return { byTitle, byPrice, ambiguousPrices };
}

function lookupDuration(
  catalogue: ProductCatalogue,
  title: string,
  unitPrice: number | undefined,
): number | undefined {
  const byTitle = catalogue.byTitle.get(title.toLowerCase());
  if (byTitle !== undefined) return byTitle;

  // Fallback: an unambiguous price match. Covers a product renamed after the
  // order was placed, where the item still carries the old title.
  if (unitPrice !== undefined && !catalogue.ambiguousPrices.has(unitPrice)) {
    return catalogue.byPrice.get(unitPrice);
  }
  return undefined;
}
