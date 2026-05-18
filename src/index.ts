import { Hono } from "hono";
import {
  createBearerMiddleware,
  createCors,
  createMcpRouter,
  createOAuthServer,
  createRateLimit,
  DEFAULT_CLAUDE_ORIGINS,
  OAUTH_PUBLIC_PATHS,
} from "@bashco/mcp-toolkit";
import {
  ALLOWED_REDIRECT_HOSTS,
  DEFAULT_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./constants.js";
import { aryeoEnvFrom, type WorkerEnv } from "./env.js";
import { dispatchToolCall, toolDefinitions } from "./mcp/tools.js";

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use("*", createCors({ allowedOrigins: DEFAULT_CLAUDE_ORIGINS }));
app.use(
  "*",
  createBearerMiddleware({
    kv: (env) => (env as WorkerEnv).OAUTH_KV,
    publicPaths: OAUTH_PUBLIC_PATHS,
    realm: SERVER_NAME,
  }),
);

const oauth = createOAuthServer<WorkerEnv>({
  serverName: SERVER_NAME,
  approvalCodeName: "MCP_APPROVAL_CODE",
  kv: (env) => env.OAUTH_KV,
  approvalCodeSecret: (env) => env.MCP_APPROVAL_CODE,
  allowedRedirectHosts: ALLOWED_REDIRECT_HOSTS,
  rateLimiters: {
    approve: createRateLimit<WorkerEnv>({
      binding: (env) => env.RATE_LIMIT_APPROVE,
      bucketName: "approve",
    }),
    token: createRateLimit<WorkerEnv>({
      binding: (env) => env.RATE_LIMIT_TOKEN,
      bucketName: "token",
    }),
    register: createRateLimit<WorkerEnv>({
      binding: (env) => env.RATE_LIMIT_REGISTER,
      bucketName: "register",
    }),
  },
});

const mcp = createMcpRouter<WorkerEnv>({
  serverName: SERVER_NAME,
  serverVersion: SERVER_VERSION,
  protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  defaultProtocolVersion: DEFAULT_PROTOCOL_VERSION,
  toolDefinitions,
  dispatch: async (env, _ctx, name, args) => dispatchToolCall(aryeoEnvFrom(env), name, args),
  rateLimiter: createRateLimit<WorkerEnv>({
    binding: (env) => env.RATE_LIMIT_MCP,
    bucketName: "mcp",
  }),
});

app.route("/", oauth.routes);
app.route("/", mcp);

export default app;
