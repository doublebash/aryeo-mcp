import type { AryeoApiEnv } from "../env.js";
import type { ListingStatus } from "../constants.js";
import { aryeoFetch, filterParams, includeParam, listWithClientFilter } from "./client.js";
import { buildPath } from "./path.js";

export interface ListListingsInput {
  status?: ListingStatus;
  search?: string;
  page?: number;
  per_page?: number;
  include?: string[];
}

interface ListingRecord {
  status?: string;
}

// VERIFIED 2026-07-27: ?search= is ignored (61 = everything), ?filter[search]=
// works (1). Status has no working server-side form — ?filter[status]=zzz was
// accepted without complaint and still returned all 61 — so it is applied
// client-side.
export async function listListings(env: AryeoApiEnv, input: ListListingsInput): Promise<unknown> {
  const include = includeParam(input.include);
  const serverQuery = {
    ...filterParams({ search: input.search }),
    ...(include !== undefined ? { include } : {}),
  };

  if (input.status !== undefined) {
    return listWithClientFilter<ListingRecord>(
      env,
      "/listings",
      serverQuery,
      (listing) => listing.status === input.status,
      `Aryeo does not support status filtering on /listings; status=${input.status} applied client-side.`,
    );
  }

  return aryeoFetch(env, {
    method: "GET",
    path: "/listings",
    query: {
      ...serverQuery,
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
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
