import { describe, expect, it } from "vitest";
import { sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });

  it("drops sensitive host provider and LLM credentials from inherited environment", () => {
    expect(sanitizeInheritedPaperclipEnv({
      ANTHROPIC_API_KEY: "sk-ant-host-key",
      OPENAI_API_KEY: "sk-proj-host-key",
      GEMINI_API_KEY: "host-gemini-key",
      XAI_API_KEY: "host-xai-key",
      AWS_SECRET_ACCESS_KEY: "host-aws-secret",
      AWS_SESSION_TOKEN: "host-session-token",
      CURSOR_API_KEY: "host-cursor-key",
      CLAUDE_CONFIG_DIR: "/Users/host/.claude",
      CODEX_HOME: "/Users/host/.codex",
      PATH: "/usr/bin",
    })).toEqual({
      PATH: "/usr/bin",
    });
  });
});
