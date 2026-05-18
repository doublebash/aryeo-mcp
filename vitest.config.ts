import { defineConfig } from "vitest/config";

// Plain Node-based vitest (no workers pool).
// The shared toolkit's test suite covers the OAuth + KV + middleware paths in miniflare;
// this project's tests only cover pure functions (Zod schemas + tool definitions).
// (Workers pool + miniflare misbehaves on paths containing spaces and '&'.)
export default defineConfig({
  test: {},
});
