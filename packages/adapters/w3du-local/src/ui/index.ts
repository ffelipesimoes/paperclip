import { DEFAULT_W3DU_BASE_URL, DEFAULT_W3DU_LOCAL_MODEL } from "../index.js";

/**
 * Build a default adapterConfig for the w3du_local agent creation form. The UI
 * may spread this over any operator-supplied overrides.
 */
export function buildW3duLocalConfig(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    baseUrl: DEFAULT_W3DU_BASE_URL,
    model: DEFAULT_W3DU_LOCAL_MODEL,
    timeoutSec: 900,
    maxToolTurns: 30,
    dangerouslyAllowFullFs: false,
    ...overrides
  };
}
