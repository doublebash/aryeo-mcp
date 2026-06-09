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

// VERIFIED 2026-06-09 against live API (POST /v1/customers):
//   - required fields: owner_first_name, owner_last_name, email
//   - optional accepted: phone
//   - silently overridden: `name` (server sets it to "<first> <last>")
//   - silently dropped: `internal_notes` (not write-accepted on create)
// Side effect: also auto-creates a customer_team and emails the owner
// an invitation; their status stays "inactive" until they accept.
// Aryeo "customers" are agent groups, not end-consumers (type: "AGENT").
export interface CreateCustomerInput {
  owner_first_name: string;
  owner_last_name: string;
  email: string;
  phone?: string;
}

export async function createCustomer(
  env: AryeoApiEnv,
  input: CreateCustomerInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "POST",
    path: "/customers",
    body: {
      owner_first_name: input.owner_first_name,
      owner_last_name: input.owner_last_name,
      email: input.email,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
  });
}
