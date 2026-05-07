const BASE_URL = "https://api.aryeo.com/v1";

export async function aryeoFetch<T = unknown>(
  path: string,
  apiKey: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    // Extract only the user-facing message — never forward raw API internals
    let message: string;
    try {
      const json = await response.json() as { message?: string; error?: string };
      message = json.message ?? json.error ?? `HTTP ${response.status}`;
    } catch {
      message = `HTTP ${response.status}`;
    }
    throw new Error(`Aryeo API error: ${message}`);
  }

  return response.json() as Promise<T>;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)] as [string, string])).toString();
}
