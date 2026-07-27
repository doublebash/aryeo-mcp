import type { AryeoApiEnv } from "../env.js";
import type { ProductType } from "../constants.js";
import { aryeoFetch, filterParams, includeParam, listWithClientFilter } from "./client.js";

// CORRECTED 2026-07-27 — the previous note here claimed the live API "rejects
// bracketed filters and only accepts flat query params". That is backwards, and
// the mistake had spread through every module. Measured on the live API:
//   ?search=Twilight        -> 27 (the whole catalogue; silently ignored)
//   ?filter[search]=Twilight -> 1  (works)
//   ?filter[type]=main       -> 13, ?filter[type]=addon -> 14  (13+14 = 27)
//   ?filter[type]=MAIN       -> rejected; filter enums must be lowercase
//
// The `active` filter has NO working form: ?include_inactive=true,
// ?filter[include_inactive]=true and ?filter[active]=false all returned the
// full 27. It is applied client-side instead.
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

interface ProductRecord {
  active?: boolean;
}

export async function listProducts(
  env: AryeoApiEnv,
  input: ListProductsInput,
): Promise<unknown> {
  const include = includeParam(input.include);
  const serverQuery = {
    ...filterParams({ search: input.search, type: input.type }),
    ...(include !== undefined ? { include } : {}),
  };

  if (input.active !== undefined) {
    return listWithClientFilter<ProductRecord>(
      env,
      "/products",
      serverQuery,
      (product) => product.active === input.active,
      "Aryeo has no working active/inactive product filter; applied client-side.",
    );
  }

  return aryeoFetch(env, {
    method: "GET",
    path: "/products",
    query: {
      ...serverQuery,
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
    },
  });
}

export interface ListProductCategoriesInput {
  search?: string;
  page?: number;
  per_page?: number;
}

// VERIFIED 2026-07-27: filter[search]=Video -> 1 of 6 categories.
export async function listProductCategories(
  env: AryeoApiEnv,
  input: ListProductCategoriesInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/product-categories",
    query: {
      ...filterParams({ search: input.search }),
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
    },
  });
}
