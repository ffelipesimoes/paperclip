export const type = "w3du_local";
export const label = "W3DU (local gateway)";

export const DEFAULT_W3DU_LOCAL_MODEL = "gemma4:26b";
export const DEFAULT_W3DU_BASE_URL = "https://llm.w3du.com/v1";

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_W3DU_LOCAL_MODEL, label: DEFAULT_W3DU_LOCAL_MODEL },
  { id: "gemma4:31b", label: "gemma4:31b" },
  { id: "qwen3.5:27b", label: "qwen3.5:27b" },
  { id: "devstral-2:latest", label: "devstral-2:latest" }
];

export const agentConfigurationDoc = `# w3du_local agent configuration

Adapter: w3du_local

Use when:
- You want Paperclip to consume the W3DU AI Gateway (OpenAI-compatible, local) as the agent runtime.
- You want to run long-lived local inference (MLX or Ollama) without a subscription-based CLI.

Don't use when:
- You need session continuity via a vendor CLI's session tools (use claude_local, opencode_local).
- You need webhook-style external invocation (use openclaw_gateway or http).

Core fields:
- baseUrl (string, optional): OpenAI-compatible endpoint root, default https://llm.w3du.com/v1
- apiKey (string, optional): Bearer token for the gateway. Falls back to env W3DU_GATEWAY_API_KEY then the run's PAPERCLIP_API_KEY.
- model (string, required): model id known to the gateway (e.g. "gemma4:26b").
- cwd (string, optional): workspace cwd override; defaults to paperclipWorkspace.cwd.
- timeoutSec (number, optional): hard timeout per run (default 900).
- maxToolTurns (number, optional): cap on assistant→tool→assistant hops per run (default 30).
- temperature (number, optional): sampling temperature.
- top_p (number, optional): sampling top_p.
- max_tokens (number, optional): per-response cap.
- env (object, optional): extra environment variables exposed to bash tool invocations.
- dangerouslyAllowFullFs (boolean, optional): when false (default), filesystem tools are confined to cwd.

Tool loop:
- The adapter speaks OpenAI Chat Completions directly to the gateway.
- Tool calls from the model are executed in-process: bash, read, write, edit, glob, grep.
- Each result is appended as a role:"tool" message and the conversation is re-submitted until the model returns finish_reason:"stop" or the turn cap is hit.
- Completion signals from the model override hard-stop when forced-stop logic at the gateway (RFC-006) is engaged.

Notes:
- No CLI subprocess is spawned. The gateway is the single external dependency.
- Sessions are keyed by runId; subsequent runs re-send the full transcript (gateway is stateless).
- Cost attribution uses the gateway's usage reply; billingType is set to "api".
`;
