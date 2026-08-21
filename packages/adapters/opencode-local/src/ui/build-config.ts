import {
  buildAdapterEnvConfig,
  DEFAULT_AGENT_TIMEOUT_SEC,
  type CreateConfigValues,
} from "@paperclipai/adapter-utils";

function parseCommaArgs(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildOpenCodeLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.model) ac.model = v.model;
  if (v.thinkingEffort) ac.variant = v.thinkingEffort;
  ac.dangerouslySkipPermissions = v.dangerouslySkipPermissions;
  // OpenCode sessions can run until the CLI exits naturally, but an unbounded
  // wall-clock timeout let a single stuck/over-exploring run loop forever
  // (see DEFAULT_AGENT_TIMEOUT_SEC doc comment). Apply the same sane floor as
  // the other local adapters; set adapterConfig.timeoutSec explicitly (0 or
  // negative) to restore the old unbounded behavior for this agent.
  ac.timeoutSec = DEFAULT_AGENT_TIMEOUT_SEC;
  ac.graceSec = 20;
  const env = buildAdapterEnvConfig(v.envBindings, v.envVars);
  if (Object.keys(env).length > 0) ac.env = env;
  if (v.command) ac.command = v.command;
  if (v.extraArgs) ac.extraArgs = parseCommaArgs(v.extraArgs);
  return ac;
}
