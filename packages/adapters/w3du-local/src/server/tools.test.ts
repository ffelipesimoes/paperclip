import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildToolDefinitions, executeTool, type ToolExecutionEnv } from "./tools.js";

let workdir: string;
let env: ToolExecutionEnv;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "w3du-tools-"));
  env = {
    cwd: workdir,
    allowFullFs: false,
    env: {},
    timeoutMs: 10_000
  };
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

describe("buildToolDefinitions", () => {
  it("exposes the canonical tool set with OpenAI-compatible schemas", () => {
    const tools = buildToolDefinitions();
    const names = tools.map((t) => t.function.name);
    expect(names).toEqual(["bash", "read", "write", "edit", "glob", "grep"]);
    const bash = tools[0].function;
    expect(bash.parameters).toMatchObject({ required: ["command", "description"] });
  });
});

describe("bash", () => {
  it("runs a command and captures stdout", async () => {
    const result = await executeTool("bash", { command: "echo hello world", description: "echo" }, env);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("hello world");
    expect(result.content).toContain("exit_code: 0");
  });

  it("reports non-zero exit", async () => {
    const result = await executeTool("bash", { command: "exit 7", description: "fail" }, env);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("exit_code: 7");
  });
});

describe("read / write / edit", () => {
  it("writes then reads a file", async () => {
    const w = await executeTool("write", { filePath: "hello.txt", content: "hi" }, env);
    expect(w.ok).toBe(true);
    const r = await executeTool("read", { filePath: "hello.txt" }, env);
    expect(r.ok).toBe(true);
    expect(r.content).toBe("hi");
  });

  it("rejects absolute paths outside cwd when allowFullFs=false", async () => {
    const r = await executeTool("read", { filePath: "/etc/hosts" }, env);
    expect(r.ok).toBe(false);
    expect(r.content).toContain("escapes workspace");
  });

  it("edit replaces a unique occurrence", async () => {
    await fs.writeFile(path.join(workdir, "f.txt"), "foo\nbar\nbaz", "utf8");
    const e = await executeTool(
      "edit",
      { filePath: "f.txt", old_string: "bar", new_string: "BAR" },
      env
    );
    expect(e.ok).toBe(true);
    const content = await fs.readFile(path.join(workdir, "f.txt"), "utf8");
    expect(content).toBe("foo\nBAR\nbaz");
  });

  it("edit fails when old_string not unique", async () => {
    await fs.writeFile(path.join(workdir, "f.txt"), "x\nx\nx", "utf8");
    const e = await executeTool(
      "edit",
      { filePath: "f.txt", old_string: "x", new_string: "y" },
      env
    );
    expect(e.ok).toBe(false);
    expect(e.content).toContain("must be unique");
  });
});

describe("glob / grep", () => {
  it("glob finds files by pattern", async () => {
    await fs.writeFile(path.join(workdir, "a.txt"), "x");
    await fs.writeFile(path.join(workdir, "b.txt"), "y");
    const g = await executeTool("glob", { pattern: "*.txt" }, env);
    expect(g.ok).toBe(true);
    expect(g.content).toContain("a.txt");
    expect(g.content).toContain("b.txt");
  });

  it("grep finds a pattern in files", async () => {
    await fs.writeFile(path.join(workdir, "hello.txt"), "alpha\nbeta\ngamma", "utf8");
    const g = await executeTool("grep", { pattern: "beta" }, env);
    expect(g.ok).toBe(true);
    expect(g.content).toContain("beta");
  });
});

describe("unknown tool", () => {
  it("returns an error with the list of known tools", async () => {
    const r = await executeTool("delete_universe", {}, env);
    expect(r.ok).toBe(false);
    expect(r.content).toContain("Unknown tool");
    expect(r.content).toContain("bash, read, write, edit, glob, grep");
  });
});
