import type { CloudflareRateLimiter } from "@bashco/mcp-toolkit";

export interface AryeoApiEnv {
  ARYEO_API_KEY: string;
}

export interface WorkerEnv extends AryeoApiEnv {
  MCP_APPROVAL_CODE: string;

  OAUTH_KV: KVNamespace;

  RATE_LIMIT_APPROVE: CloudflareRateLimiter;
  RATE_LIMIT_TOKEN: CloudflareRateLimiter;
  RATE_LIMIT_REGISTER: CloudflareRateLimiter;
  RATE_LIMIT_MCP: CloudflareRateLimiter;
}

export function aryeoEnvFrom(env: WorkerEnv): AryeoApiEnv {
  return {
    ARYEO_API_KEY: env.ARYEO_API_KEY,
  };
}
