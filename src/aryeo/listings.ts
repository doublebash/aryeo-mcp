import type { AryeoApiEnv } from "../env.js";
import type { ListingStatus } from "../constants.js";
import { aryeoFetch, includeParam } from "./client.js";
import { buildPath } from "./path.js";

export interface ListListingsInput {
  status?: ListingStatus;
  search?: string;
  page?: number;
  per_page?: number;
  include?: string[];
}

export async function listListings(env: AryeoApiEnv, input: ListListingsInput): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/listings",
    query: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.search !== undefined ? { search: input.search } : {}),
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      ...(includeParam(input.include) !== undefined
        ? { include: includeParam(input.include) }
        : {}),
    },
  });
}

export async function getListing(
  env: AryeoApiEnv,
  listingId: string,
  include?: string[],
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: buildPath("/listings/{listingId}", { listingId }),
    query: {
      ...(includeParam(include) !== undefined ? { include: includeParam(include) } : {}),
    },
  });
}
