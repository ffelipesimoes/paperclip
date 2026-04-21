import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult
} from "@paperclipai/adapter-utils";
import { DEFAULT_W3DU_BASE_URL, DEFAULT_W3DU_LOCAL_MODEL } from "../index.js";
import { buildToolDefinitions, executeTool, type ToolExecutionEnv } from "./tools.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: "assistant";
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

function parseObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through; model may have emitted non-JSON.
  }
  return {};
}

function toolCallSignature(tc: { function: { name: string; arguments: string } }): string {
  return `${tc.function.name}:${tc.function.arguments}`;
}

async function ensureCwd(cwd: string): Promise<void> {
  try {
    await fs.mkdir(cwd, { recursive: true });
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`cwd ${cwd} exists but is not a directory`);
    }
  } catch (err) {
    throw new Error(`Cannot prepare workspace cwd ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta, authToken } = ctx;

  const baseUrl = asString(
    config.baseUrl,
    process.env.W3DU_GATEWAY_URL ?? DEFAULT_W3DU_BASE_URL
  ).replace(/\/$/, "");
  const apiKey = asString(
    config.apiKey,
    process.env.W3DU_GATEWAY_API_KEY ?? authToken ?? ""
  );
  const model = asString(config.model, DEFAULT_W3DU_LOCAL_MODEL);
  const timeoutSec = asNumber(config.timeoutSec, 900);
  const maxToolTurns = Math.max(1, Math.floor(asNumber(config.maxToolTurns, 15)));
  const cycleRepeatThreshold = Math.max(2, Math.floor(asNumber(config.cycleRepeatThreshold, 3)));
  const identicalRepeatThreshold = Math.max(2, Math.floor(asNumber(config.identicalRepeatThreshold, 2)));
  const temperature = config.temperature != null ? asNumber(config.temperature, 0) : undefined;
  const topP = config.top_p != null ? asNumber(config.top_p, 1) : undefined;
  const maxTokens = config.max_tokens != null ? asNumber(config.max_tokens, 0) : undefined;

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const configuredCwd = asString(config.cwd, "");
  const cwd = workspaceCwd || configuredCwd || process.cwd();
  await ensureCwd(cwd);

  const envOverrides = parseObject(config.env);
  const bashEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    if (typeof v === "string") bashEnv[k] = v;
  }
  bashEnv.PAPERCLIP_RUN_ID = runId;
  bashEnv.PAPERCLIP_AGENT_ID = agent.id;
  if (typeof context.taskId === "string") bashEnv.PAPERCLIP_TASK_ID = context.taskId;
  if (apiKey) bashEnv.PAPERCLIP_API_KEY = apiKey;

  const allowFullFs = asBoolean(config.dangerouslyAllowFullFs, false);
  const toolEnv: ToolExecutionEnv = {
    cwd,
    allowFullFs,
    env: bashEnv,
    timeoutMs: Math.max(5_000, timeoutSec * 1000)
  };

  const tools = buildToolDefinitions();

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work in the workspace at {{cwd}}."
  );
  const renderedPrompt = promptTemplate
    .replace(/\{\{agent\.id\}\}/g, agent.id)
    .replace(/\{\{agent\.name\}\}/g, agent.name)
    .replace(/\{\{cwd\}\}/g, cwd);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are an autonomous agent operating inside Paperclip via the W3DU local gateway.\n" +
        "You have these tools available: bash, read, write, edit, glob, grep.\n\n" +
        "CRITICAL TOOL-USE RULES (override anything above that conflicts):\n" +
        "1. Emit EXACTLY ONE tool call per turn. Never emit parallel tool calls — do them sequentially across turns.\n" +
        "2. Before issuing the next tool call, read the previous tool result carefully and reason about it in plain text.\n" +
        "3. If you just emitted a tool call identical to a recent one, STOP and reply in plain text instead — you are in a loop.\n" +
        "4. When the user's task is complete, reply with plain text and no tool call. This is how you signal completion.\n" +
        "5. If a command fails, do not retry the same command or trivial variants. Move to the next step or report failure."
    },
    { role: "user", content: renderedPrompt }
  ];

  if (onMeta) {
    await onMeta({
      adapterType: "w3du_local",
      command: `${baseUrl}/chat/completions`,
      cwd,
      commandArgs: ["POST", `model=${model}`, `tools=${tools.length}`, `maxToolTurns=${maxToolTurns}`],
      env: {},
      prompt: renderedPrompt,
      promptMetrics: { promptChars: renderedPrompt.length },
      context
    });
  }

  const runDeadline = Date.now() + timeoutSec * 1000;
  const aggregateUsage = { input: 0, output: 0, cached: 0 };
  const signatureCounts = new Map<string, number>();
  let lastSignature: string | null = null;
  let consecutiveIdentical = 0;
  let discardedParallel = 0;
  let lastAssistantText = "";
  let finishReason: string | undefined;
  let timedOut = false;
  let errorMessage: string | null = null;
  let turns = 0;

  while (turns < maxToolTurns) {
    turns++;
    if (Date.now() >= runDeadline) {
      timedOut = true;
      errorMessage = `w3du_local run exceeded timeout of ${timeoutSec}s`;
      break;
    }

    const controller = new AbortController();
    const remainingMs = Math.max(1000, runDeadline - Date.now());
    const turnTimer = setTimeout(() => controller.abort(), remainingMs);

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      tools,
      tool_choice: "auto"
    };
    if (temperature !== undefined) requestBody.temperature = temperature;
    if (topP !== undefined) requestBody.top_p = topP;
    if (maxTokens !== undefined && maxTokens > 0) requestBody.max_tokens = maxTokens;

    await onLog(
      "stdout",
      `[w3du_local] turn ${turns} → POST ${baseUrl}/chat/completions model=${model}\n`
    );

    let data: ChatResponse;
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      clearTimeout(turnTimer);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        errorMessage = `w3du_local gateway returned HTTP ${res.status}: ${text.slice(0, 512)}`;
        await onLog("stderr", `${errorMessage}\n`);
        break;
      }
      data = (await res.json()) as ChatResponse;
    } catch (err) {
      clearTimeout(turnTimer);
      if ((err as { name?: string })?.name === "AbortError") {
        timedOut = true;
        errorMessage = `w3du_local run aborted after ${timeoutSec}s`;
      } else {
        errorMessage = `w3du_local fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      await onLog("stderr", `${errorMessage}\n`);
      break;
    }

    if (data.usage) {
      aggregateUsage.input += data.usage.prompt_tokens ?? 0;
      aggregateUsage.output += data.usage.completion_tokens ?? 0;
    }

    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;
    finishReason = choice?.finish_reason;

    const toolCalls = assistantMsg?.tool_calls ?? [];
    const textContent = typeof assistantMsg?.content === "string" ? assistantMsg.content : "";

    if (textContent) lastAssistantText = textContent;

    if (toolCalls.length === 0) {
      // Model produced a final text answer (or empty).
      await onLog("stdout", `[w3du_local] turn ${turns} → finish_reason=${finishReason ?? "n/a"}\n`);
      if (textContent) await onLog("stdout", `${textContent}\n`);
      break;
    }

    const allToolCalls = toolCalls.map((tc, idx) => ({
      id: tc.id ?? `call_${runId}_${turns}_${idx}`,
      type: "function" as const,
      function: {
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? "{}"
      }
    }));

    // Defense in depth vs Gemma-4 parallel bursts (ETH-35 / RFC-004 §5): keep
    // only the first tool_call per turn. The gateway should truncate upstream
    // but we also guard here so the adapter is correct regardless.
    if (allToolCalls.length > 1) {
      discardedParallel += allToolCalls.length - 1;
      await onLog(
        "stderr",
        `[w3du_local] discarded ${allToolCalls.length - 1} parallel tool_call(s); keeping the first.\n`
      );
    }
    const normalizedToolCalls = allToolCalls.slice(0, 1);

    // Cycle detection: same signature N times in a row, or N times total.
    const signature = toolCallSignature(normalizedToolCalls[0]);
    const totalCount = (signatureCounts.get(signature) ?? 0) + 1;
    signatureCounts.set(signature, totalCount);
    if (signature === lastSignature) {
      consecutiveIdentical += 1;
    } else {
      consecutiveIdentical = 1;
      lastSignature = signature;
    }
    if (consecutiveIdentical >= identicalRepeatThreshold) {
      errorMessage = `w3du_local stopped: identical tool call repeated ${consecutiveIdentical} times (${signature.slice(0, 120)})`;
      await onLog("stderr", `${errorMessage}\n`);
      break;
    }
    if (totalCount >= cycleRepeatThreshold) {
      errorMessage = `w3du_local stopped: tool call cycle detected — same signature used ${totalCount} times`;
      await onLog("stderr", `${errorMessage}\n`);
      break;
    }

    messages.push({
      role: "assistant",
      content: textContent || null,
      tool_calls: normalizedToolCalls
    });

    for (const call of normalizedToolCalls) {
      const name = call.function.name;
      const argsObject = parseJsonObject(call.function.arguments);
      await onLog("stdout", `[w3du_local] tool ${name} args=${call.function.arguments.slice(0, 200)}\n`);

      const result = await executeTool(name, argsObject, toolEnv);
      await onLog(
        result.ok ? "stdout" : "stderr",
        `[w3du_local] tool ${name} ${result.ok ? "ok" : "failed"}: ${result.content.slice(0, 500)}\n`
      );

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content
      });

      if (Date.now() >= runDeadline) {
        timedOut = true;
        errorMessage = `w3du_local run exceeded timeout of ${timeoutSec}s`;
        break;
      }
    }

    if (timedOut) break;
  }

  const exhausted = !finishReason || finishReason === "tool_calls";
  if (!errorMessage && exhausted && turns >= maxToolTurns) {
    errorMessage = `w3du_local stopped after ${maxToolTurns} tool turns without a final text response`;
    await onLog("stderr", `${errorMessage}\n`);
  }

  const summarySource = lastAssistantText.trim();
  const summary = summarySource ? summarySource.slice(0, 500) : null;

  const totalTokens = aggregateUsage.input + aggregateUsage.output;
  const sessionId = `w3du-${runId}`;

  return {
    exitCode: errorMessage ? 1 : 0,
    signal: null,
    timedOut,
    errorMessage,
    usage: { inputTokens: aggregateUsage.input, outputTokens: aggregateUsage.output },
    sessionId,
    sessionParams: { sessionId, cwd, model },
    sessionDisplayId: sessionId,
    provider: "w3du",
    biller: "w3du_local",
    model,
    billingType: "api",
    costUsd: null,
    resultJson: {
      turns,
      finishReason: finishReason ?? null,
      totalTokens,
      baseUrl,
      discardedParallelToolCalls: discardedParallel
    },
    summary
  };
}
