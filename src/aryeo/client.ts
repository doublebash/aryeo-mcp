import {
  apiTokenHeader,
  createUpstreamClient,
  ToolError,
  type UpstreamRequestInit,
} from "@bashco/mcp-toolkit";
import { ARYEO_BASE_URL } from "../constants.js";
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
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) return parsed.message;
    if (typeof parsed.error === "string" && parsed.error.length > 0) return parsed.error;
  } catch {
    // Non-JSON body (e.g. Aryeo's plain-text 404). Fall through.
  }
  return null;
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
