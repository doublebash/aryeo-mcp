import type { AryeoApiEnv } from "../env.js";
import { aryeoFetch, includeParam } from "./client.js";
import { buildPath } from "./path.js";

export interface ListCustomersInput {
  search?: string;
  page?: number;
  per_page?: number;
  include?: string[];
}

export async function listCustomers(
  env: AryeoApiEnv,
  input: ListCustomersInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/customers",
    query: {
      ...(input.search !== undefined ? { search: input.search } : {}),
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      ...(includeParam(input.include) !== undefined
        ? { include: includeParam(input.include) }
        : {}),
    },
  });
}

// VERIFIED 2026-05-18: GET /customers/{id} returns 200 with full customer
// record despite being absent from Aryeo's published OpenAPI spec.
export async function getCustomer(
  env: AryeoApiEnv,
  customerId: string,
  include?: string[],
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: buildPath("/customers/{customerId}", { customerId }),
    query: {
      ...(includeParam(include) !== undefined ? { include: includeParam(include) } : {}),
    },
  });
}
