import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecutionEnv {
  cwd: string;
  allowFullFs: boolean;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface ToolExecutionResult {
  ok: boolean;
  content: string;
  exitCode?: number | null;
  error?: string;
}

const MAX_OUTPUT_CHARS = 16_384;

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}…[truncated ${output.length - MAX_OUTPUT_CHARS} chars]`;
}

function resolveInsideCwd(filePath: string, env: ToolExecutionEnv): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(env.cwd, filePath);
  const resolved = path.resolve(absolute);
  if (env.allowFullFs) return resolved;
  const cwdResolved = path.resolve(env.cwd);
  const relative = path.relative(cwdResolved, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path ${filePath} escapes workspace cwd ${cwdResolved}`);
  }
  return resolved;
}

export function buildToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "bash",
        description:
          "Execute a bash command in the workspace cwd. Returns stdout/stderr/exit_code. Use for shell ops, git, curl, package managers, tests.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The bash command to execute." },
            description: {
              type: "string",
              description: "Short (5-10 words) description of what the command does."
            },
            timeout: {
              type: "number",
              description: "Optional per-call timeout in ms (caps at adapter.timeoutSec)."
            }
          },
          required: ["command", "description"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read a text file from the workspace. Returns the file content.",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Path relative to cwd or absolute." }
          },
          required: ["filePath"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "write",
        description: "Write or overwrite a text file in the workspace.",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            content: { type: "string" }
          },
          required: ["filePath", "content"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "edit",
        description:
          "Replace exactly one occurrence of old_string with new_string in a file. Fails if the old_string is not unique.",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            old_string: { type: "string" },
            new_string: { type: "string" }
          },
          required: ["filePath", "old_string", "new_string"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "glob",
        description: "Find files by glob pattern (relative to cwd). Returns newline-separated paths.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" }
          },
          required: ["pattern"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "grep",
        description:
          "Search for a regex pattern in files under cwd. Returns matching lines with file:line prefix.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            path: { type: "string", description: "Subpath to restrict search; optional." },
            caseInsensitive: { type: "boolean" }
          },
          required: ["pattern"],
          additionalProperties: false
        }
      }
    }
  ];
}

async function runBash(
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command) return { ok: false, content: "bash: missing 'command' argument", error: "missing_command" };
  const perCallTimeout =
    typeof args.timeout === "number" && args.timeout > 0 ? Math.min(args.timeout, env.timeoutMs) : env.timeoutMs;

  return await new Promise<ToolExecutionResult>((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: env.cwd,
      env: { ...process.env, ...env.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, perCallTimeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, content: `bash spawn error: ${err.message}`, error: "spawn_error" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const payload = [
        `exit_code: ${timedOut ? "TIMEOUT" : code ?? "null"}`,
        stdout.length > 0 ? `stdout:\n${stdout}` : "stdout: <empty>",
        stderr.length > 0 ? `stderr:\n${stderr}` : "stderr: <empty>"
      ].join("\n\n");
      resolve({
        ok: !timedOut && code === 0,
        content: truncate(payload),
        exitCode: code,
        ...(timedOut ? { error: "timeout" } : {})
      });
    });
  });
}

async function runRead(
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  if (!filePath) return { ok: false, content: "read: missing 'filePath'", error: "missing_filePath" };
  try {
    const resolved = resolveInsideCwd(filePath, env);
    const data = await fs.readFile(resolved, "utf8");
    return { ok: true, content: truncate(data) };
  } catch (err) {
    return {
      ok: false,
      content: `read error: ${err instanceof Error ? err.message : String(err)}`,
      error: "read_error"
    };
  }
}

async function runWrite(
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  const content = typeof args.content === "string" ? args.content : "";
  if (!filePath) return { ok: false, content: "write: missing 'filePath'", error: "missing_filePath" };
  try {
    const resolved = resolveInsideCwd(filePath, env);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf8");
    return { ok: true, content: `wrote ${content.length} chars to ${resolved}` };
  } catch (err) {
    return {
      ok: false,
      content: `write error: ${err instanceof Error ? err.message : String(err)}`,
      error: "write_error"
    };
  }
}

async function runEdit(
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  const oldString = typeof args.old_string === "string" ? args.old_string : "";
  const newString = typeof args.new_string === "string" ? args.new_string : "";
  if (!filePath || !oldString) {
    return {
      ok: false,
      content: "edit: requires 'filePath' and 'old_string'",
      error: "missing_args"
    };
  }
  try {
    const resolved = resolveInsideCwd(filePath, env);
    const current = await fs.readFile(resolved, "utf8");
    const occurrences = current.split(oldString).length - 1;
    if (occurrences === 0) {
      return { ok: false, content: `edit: old_string not found in ${resolved}`, error: "not_found" };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        content: `edit: old_string appears ${occurrences} times in ${resolved}; must be unique. Provide more surrounding context.`,
        error: "not_unique"
      };
    }
    const next = current.replace(oldString, newString);
    await fs.writeFile(resolved, next, "utf8");
    return { ok: true, content: `edit applied (1 occurrence) in ${resolved}` };
  } catch (err) {
    return {
      ok: false,
      content: `edit error: ${err instanceof Error ? err.message : String(err)}`,
      error: "edit_error"
    };
  }
}

async function runGlob(
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern) return { ok: false, content: "glob: missing 'pattern'", error: "missing_pattern" };

  return await new Promise<ToolExecutionResult>((resolve) => {
    const child = spawn("bash", ["-lc", `ls -1 ${pattern} 2>/dev/null || true`], {
      cwd: env.cwd,
      env: { ...process.env, ...env.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.on("error", (err) => resolve({ ok: false, content: `glob error: ${err.message}`, error: "glob_error" }));
    child.on("close", () => resolve({ ok: true, content: truncate(stdout || "(no matches)") }));
  });
}

async function runGrep(
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern) return { ok: false, content: "grep: missing 'pattern'", error: "missing_pattern" };
  const subpath = typeof args.path === "string" && args.path.trim().length > 0 ? args.path.trim() : ".";
  const caseFlag = args.caseInsensitive ? "-i" : "";
  const cmd = `grep -r -n -H ${caseFlag} --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist ${JSON.stringify(
    pattern
  )} ${JSON.stringify(subpath)} 2>/dev/null || true`;

  return await new Promise<ToolExecutionResult>((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd: env.cwd,
      env: { ...process.env, ...env.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.on("error", (err) => resolve({ ok: false, content: `grep error: ${err.message}`, error: "grep_error" }));
    child.on("close", () => resolve({ ok: true, content: truncate(stdout || "(no matches)") }));
  });
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  env: ToolExecutionEnv
): Promise<ToolExecutionResult> {
  switch (name) {
    case "bash":
      return runBash(args, env);
    case "read":
      return runRead(args, env);
    case "write":
      return runWrite(args, env);
    case "edit":
      return runEdit(args, env);
    case "glob":
      return runGlob(args, env);
    case "grep":
      return runGrep(args, env);
    default:
      return {
        ok: false,
        content: `Unknown tool: ${name}. Available: bash, read, write, edit, glob, grep.`,
        error: "unknown_tool"
      };
  }
}
