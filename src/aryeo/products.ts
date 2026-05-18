import type { AryeoApiEnv } from "../env.js";
import type { ProductType } from "../constants.js";
import { aryeoFetch, includeParam } from "./client.js";

// Aryeo's published OpenAPI spec advertises filter[*] bracketed syntax for
// /products, but the live API rejects bracketed filters and only accepts flat
// query params. active=true is the API default; only pass include_inactive=true
// when the caller explicitly opts into inactive products.
//
// NOTE: there is no `get_product` endpoint. Aryeo's API has no GET /products/{id}
// (confirmed live with a real product UUID returning the plain-text 404
// `"404 - Uh oh that path isn't found"`). Single-product detail isn't supported
// by the API. Callers should use list_products with `search=` to locate one.
export interface ListProductsInput {
  type?: ProductType;
  active?: boolean;
  search?: string;
  page?: number;
  per_page?: number;
  include?: string[];
}

export async function listProducts(
  env: AryeoApiEnv,
  input: ListProductsInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/products",
    query: {
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.search !== undefined ? { search: input.search } : {}),
      ...(input.active === false ? { include_inactive: "true" } : {}),
      ...(includeParam(input.include) !== undefined
        ? { include: includeParam(input.include) }
        : {}),
    },
  });
}

export interface ListProductCategoriesInput {
  search?: string;
  page?: number;
  per_page?: number;
}

export async function listProductCategories(
  env: AryeoApiEnv,
  input: ListProductCategoriesInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/product-categories",
    query: {
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      ...(input.search !== undefined ? { search: input.search } : {}),
    },
  });
}
