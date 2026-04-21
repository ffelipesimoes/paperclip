import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId = readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    const cwd = readNonEmptyString(record.cwd);
    const model = readNonEmptyString(record.model);
    if (!sessionId) return null;
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {})
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId = readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
    if (!sessionId) return null;
    const cwd = readNonEmptyString(params.cwd);
    const model = readNonEmptyString(params.model);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {})
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
  }
};

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { listW3duModels } from "./models.js";
export { buildToolDefinitions, executeTool } from "./tools.js";
