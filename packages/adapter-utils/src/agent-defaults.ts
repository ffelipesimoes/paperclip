/**
 * Shared non-zero defaults for adapter wall-clock timeouts and per-run turn
 * caps.
 *
 * Every local adapter's UI config builder (`packages/adapters/*-local/src/ui/build-config.ts`)
 * used to persist `adapterConfig.timeoutSec = 0`, and built-in agent personas
 * (`server/src/services/built-in-agents.ts`) never set `timeoutSec` or
 * `maxTurnsPerRun`/`maxTurns` at all. `resolveAdapterExecutionTargetTimeout`
 * (./execution-target.ts) treats 0 as "no wall-clock timeout" for local/SSH
 * targets, and each adapter's execute.ts only passes `--max-turns` to the CLI
 * when the configured value is `> 0`. Net effect: a run could loop through an
 * unbounded number of agentic turns with no time backstop, which is what made
 * replies slow and made final answers accumulate irrelevant tool-exploration
 * context. These constants (and the env-overridable resolvers below) give
 * every adapter a sane non-zero floor instead.
 *
 * This module has no side effects at import time (env vars are only read
 * lazily, inside the resolver functions, when actually called), so it is
 * safe to import from both server code and the browser-bundled adapter UI
 * config builders -- the resolver functions just never get called there.
 *
 * Deliberately kept out of ./execution-target.ts: several adapters'
 * execute.test.ts files fully `vi.mock("@paperclipai/adapter-utils/execution-target")`,
 * and adding exports there would require updating every one of those mocks.
 */

/** Default wall-clock run timeout, in seconds, when none is configured. */
export const DEFAULT_AGENT_TIMEOUT_SEC = 600;

/** Default max agentic turns per run when none is configured. */
export const DEFAULT_AGENT_MAX_TURNS = 40;

// Mirrors PAPERCLIP_GIT_FETCH_TIMEOUT_MS in
// server/src/services/workspace-runtime.ts: an env var lets operators raise
// or lower the floor per-deployment without touching adapterConfig on every
// agent. An explicit adapterConfig.timeoutSec/maxTurnsPerRun value (including
// 0 or negative, which resolveAdapterExecutionTargetTimeout treats as "no
// timeout") always takes precedence over these defaults.
export function resolveDefaultAgentTimeoutSec(): number {
  const raw = process.env.PAPERCLIP_AGENT_TIMEOUT_SEC?.trim();
  if (!raw) return DEFAULT_AGENT_TIMEOUT_SEC;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_TIMEOUT_SEC;
}

export function resolveDefaultAgentMaxTurns(): number {
  const raw = process.env.PAPERCLIP_AGENT_MAX_TURNS?.trim();
  if (!raw) return DEFAULT_AGENT_MAX_TURNS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_MAX_TURNS;
}
