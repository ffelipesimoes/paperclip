import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { execute } from "./execute.js";

function buildContext(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  const logs: Array<{ stream: string; chunk: string }> = [];
  return {
    runId: "run-test-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Test Agent",
      adapterType: "w3du_local",
      adapterConfig: {}
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null
    },
    config: {
      model: "gemma4:26b",
      baseUrl: "http://127.0.0.1:3000/v1",
      maxToolTurns: 4,
      timeoutSec: 30,
      ...(overrides.config ?? {})
    },
    context: overrides.context ?? {},
    onLog: async (stream, chunk) => {
      logs.push({ stream, chunk });
    },
    ...overrides
  } as AdapterExecutionContext;
}

let workdir: string;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "w3du-exec-"));
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("execute — happy path", () => {
  it("terminates when the model returns text and no tool_calls on the first turn", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "chat-1",
          model: "gemma4:26b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "All set." },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const ctx = buildContext({
      context: { paperclipWorkspace: { cwd: workdir } }
    });
    const result = await execute(ctx);

    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("All set.");
    expect(result.model).toBe("gemma4:26b");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstInit = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as
      | { body: string }
      | undefined;
    const body = JSON.parse(firstInit?.body ?? "{}");
    expect(body.tools).toHaveLength(6);
    expect(body.tool_choice).toBe("auto");
  });
});

describe("execute — tool loop", () => {
  it("executes a bash tool and re-submits the conversation", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chat-1",
          model: "gemma4:26b",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "bash",
                      arguments: JSON.stringify({ command: "echo ping", description: "echo" })
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chat-2",
          model: "gemma4:26b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "bash said ping." },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const ctx = buildContext({ context: { paperclipWorkspace: { cwd: workdir } } });
    const result = await execute(ctx);

    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("bash said ping.");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondInit = (fetchMock.mock.calls[1] as unknown[] | undefined)?.[1] as
      | { body: string }
      | undefined;
    const secondBody = JSON.parse(secondInit?.body ?? "{}");
    const toolMessage = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage.tool_call_id).toBe("call_1");
    expect(toolMessage.content).toContain("ping");
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 9 });
  });
});

describe("execute — hard stop", () => {
  it("returns errorMessage when maxToolTurns is exhausted without a stop", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "chat-loop",
          model: "gemma4:26b",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_loop",
                    type: "function",
                    function: { name: "bash", arguments: JSON.stringify({ command: "true", description: "noop" }) }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const ctx = buildContext({
      context: { paperclipWorkspace: { cwd: workdir } },
      config: { model: "gemma4:26b", baseUrl: "http://127.0.0.1:3000/v1", maxToolTurns: 2, timeoutSec: 30 }
    });
    const result = await execute(ctx);

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("without a final text response");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("execute — gateway error", () => {
  it("surfaces HTTP errors from the gateway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("boom", { status: 502, headers: { "Content-Type": "text/plain" } })
      )
    );

    const ctx = buildContext({ context: { paperclipWorkspace: { cwd: workdir } } });
    const result = await execute(ctx);

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("HTTP 502");
  });
});
