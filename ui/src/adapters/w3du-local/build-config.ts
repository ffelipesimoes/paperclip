import type { CreateConfigValues } from "../../components/AgentConfigForm";

const DEFAULT_BASE_URL = "https://llm.w3du.com/v1";

export function buildW3duLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  const extras = (v.adapterSchemaValues ?? {}) as Record<string, unknown>;

  const baseUrl = typeof v.url === "string" && v.url.trim().length > 0 ? v.url.trim() : DEFAULT_BASE_URL;
  ac.baseUrl = baseUrl;
  if (typeof v.model === "string" && v.model.trim().length > 0) ac.model = v.model.trim();
  if (typeof extras.apiKey === "string" && extras.apiKey.trim().length > 0) ac.apiKey = extras.apiKey.trim();
  if (typeof extras.timeoutSec === "number") ac.timeoutSec = extras.timeoutSec;
  if (typeof extras.maxToolTurns === "number") ac.maxToolTurns = extras.maxToolTurns;
  if (typeof extras.dangerouslyAllowFullFs === "boolean") ac.dangerouslyAllowFullFs = extras.dangerouslyAllowFullFs;

  return ac;
}
