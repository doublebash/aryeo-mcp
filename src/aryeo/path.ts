import { buildPath as toolkitBuildPath, uuidValidator } from "@bashco/mcp-toolkit";

// Aryeo IDs are UUIDs across every resource (verified live 2026-05-18; v7 in
// practice, but the toolkit's uuidValidator accepts any UUID layout — see
// path.ts in @bashco/mcp-toolkit/ids).
export function buildPath(template: string, ids: Record<string, string> = {}): string {
  return toolkitBuildPath(template, ids, { idValidator: uuidValidator });
}
