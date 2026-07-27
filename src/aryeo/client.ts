import {
  apiTokenHeader,
  createUpstreamClient,
  ToolError,
  type UpstreamRequestInit,
} from "@bashco/mcp-toolkit";
import {
  ARYEO_BASE_URL,
  CLIENT_FILTER_MAX_PAGES,
  CLIENT_FILTER_PAGE_SIZE,
} from "../constants.js";
import type { AryeoApiEnv } from "../env.js";

export type AryeoRequestInit = UpstreamRequestInit;

/**
 * Aryeo upstream fetch wrapper.
 *
 * Wraps the toolkit's createUpstreamClient with Aryeo-specific error-body
 * parsing. Aryeo returns error responses shaped like `{message, error}` —
 * we extract that `message`/`error` field and surface it as the userMessage
 * so Claude sees the real upstream error text, not just a generic status
 * summary like "not found".
 *
 * If the body is non-JSON (e.g. Aryeo's plain-text 404 `"404 - Uh oh that
 * path isn't found"`), the original ToolError from the toolkit is rethrown
 * unchanged.
 */
export async function aryeoFetch<T = unknown>(
  env: AryeoApiEnv,
  init: AryeoRequestInit,
): Promise<T> {
  const client = createUpstreamClient({
    upstreamName: "Aryeo",
    baseUrl: ARYEO_BASE_URL,
    buildHeaders: async () => apiTokenHeader(env.ARYEO_API_KEY),
  });

  try {
    return await client.fetch<T>(init);
  } catch (err) {
    if (err instanceof ToolError && err.upstreamName === "Aryeo" && err.status !== undefined) {
      const aryeoMessage = extractAryeoMessage(err.internalMessage);
      if (aryeoMessage) {
        throw new ToolError({
          userMessage: `Aryeo ${err.status}: ${aryeoMessage}`,
          internalMessage: err.internalMessage,
          status: err.status,
          upstreamName: "Aryeo",
        });
      }
    }
    throw err;
  }
}

function extractAryeoMessage(internalMessage: string): string | null {
  // internalMessage shape from ToolError.upstream: "Aryeo <status>: <raw-body>".
  // We need everything after the first ": " and try to JSON.parse it.
  const colonIdx = internalMessage.indexOf(": ");
  if (colonIdx < 0) return null;
  const body = internalMessage.slice(colonIdx + 2);
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown;
      error?: unknown;
      data?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.length > 0) return parsed.message;
    if (typeof parsed.error === "string" && parsed.error.length > 0) return parsed.error;
    // VERIFIED 2026-07-27: Aryeo's 422s carry NO top-level `message`. Field
    // errors live under `data` as {field: [msg, ...]} — e.g.
    //   {"status":"fail","data":{"end_at":["The end at field is required."]}}
    // Without this branch every validation failure surfaced to Claude as the
    // toolkit's bare status summary ("unprocessable entity"), hiding the cause.
    const fieldErrors = formatFieldErrors(parsed.data);
    if (fieldErrors) return fieldErrors;
  } catch {
    // Non-JSON body (e.g. Aryeo's plain-text 404). Fall through.
  }
  return null;
}

function formatFieldErrors(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const parts: string[] = [];
  for (const [field, messages] of Object.entries(data as Record<string, unknown>)) {
    const texts = (Array.isArray(messages) ? messages : [messages]).filter(
      (m): m is string => typeof m === "string" && m.length > 0,
    );
    if (texts.length > 0) parts.push(`${field}: ${texts.join(" ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/**
 * Build Aryeo's bracketed filter query params.
 *
 * VERIFIED 2026-07-27 against the live API — this reverses a long-standing
 * incorrect assumption in this codebase. Aryeo accepts ONLY `filter[name]=value`
 * with LOWERCASE enum values. Flat params (`search=`, `status=`, `order_id=`)
 * are silently IGNORED — the endpoint returns the complete unfiltered
 * collection with a 200, so the bug was invisible. Measured evidence:
 *   /customers?search=Michelle        -> 47 (all)   [ignored]
 *   /customers?filter[search]=Michelle -> 1         [works]
 *   /orders?payment_status=PAID       -> 58 (all)   [ignored]
 *   /orders?filter[payment_status]=paid -> 49       [works; PAID is rejected]
 *
 * Unsupported filter names are also ignored rather than rejected, so every
 * filter routed through here has been individually confirmed to work.
 */
export function filterParams(
  filters: Record<string, string | number | undefined>,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    params[`filter[${name}]`] = toAryeoFilterValue(value);
  }
  return params;
}

/** Aryeo's filter enums are lowercase; its response enums are uppercase. */
export function toAryeoFilterValue(value: string | number): string {
  return typeof value === "number" ? String(value) : value.toLowerCase();
}

/**
 * Helper: serialise an optional `include` array to the comma-separated string
 * Aryeo expects on `?include=`. Returns undefined for empty/missing input so
 * the toolkit's query builder drops the param entirely.
 */
export function includeParam(include?: string[]): string | undefined {
  if (!include || include.length === 0) return undefined;
  return include.join(",");
}

interface AryeoPage<T> {
  data?: T[];
  meta?: { current_page?: number; last_page?: number; total?: number };
}

export interface ClientFilteredResult<T> {
  data: T[];
  meta: {
    count: number;
    filtered_client_side: true;
    filter_note: string;
    records_scanned: number;
    pages_scanned: number;
    truncated: boolean;
  };
}

/**
 * Fetch and filter in-memory, for filters Aryeo advertises but does not honour.
 *
 * VERIFIED 2026-07-27: /appointments ignores every filter variant tried
 * (`status`, `order_id`, `filter[status]`, `filter[order_id]`,
 * `filter[appointment_status]` — all returned the full set of 52), and
 * /listings ignores status filtering. Rather than silently returning unfiltered
 * data — which reads to Claude as "these are the matching records" — we walk a
 * bounded number of pages and filter here, reporting exactly what we did.
 *
 * `truncated: true` means the account has more records than the walk covered,
 * so results may be incomplete. Callers must surface that rather than treating
 * the list as exhaustive.
 */
export async function listWithClientFilter<T>(
  env: AryeoApiEnv,
  path: string,
  query: Record<string, string | number | undefined>,
  predicate: (item: T) => boolean,
  filterNote: string,
): Promise<ClientFilteredResult<T>> {
  const matched: T[] = [];
  let scanned = 0;
  let pagesScanned = 0;
  let lastPage = 1;

  for (let page = 1; page <= CLIENT_FILTER_MAX_PAGES; page++) {
    const response = await aryeoFetch<AryeoPage<T>>(env, {
      method: "GET",
      path,
      query: { ...query, page, per_page: CLIENT_FILTER_PAGE_SIZE },
    });

    const items = response?.data ?? [];
    scanned += items.length;
    pagesScanned = page;
    lastPage = response?.meta?.last_page ?? page;

    for (const item of items) {
      if (predicate(item)) matched.push(item);
    }

    if (page >= lastPage || items.length === 0) break;
  }

  return {
    data: matched,
    meta: {
      count: matched.length,
      filtered_client_side: true,
      filter_note: filterNote,
      records_scanned: scanned,
      pages_scanned: pagesScanned,
      truncated: lastPage > pagesScanned,
    },
  };
}
