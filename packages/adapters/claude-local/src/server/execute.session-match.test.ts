import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeSessionCwdMatchesExecutionTarget } from "./execute.js";

describe("claudeSessionCwdMatchesExecutionTarget", () => {
  it("returns true when execution target is remote", () => {
    expect(
      claudeSessionCwdMatchesExecutionTarget({
        runtimeSessionCwd: "/workspace/local",
        effectiveExecutionCwd: "/remote/workspace",
        executionTargetIsRemote: true,
      }),
    ).toBe(true);
  });

  it("returns true when runtimeSessionCwd is empty", () => {
    expect(
      claudeSessionCwdMatchesExecutionTarget({
        runtimeSessionCwd: "",
        effectiveExecutionCwd: "/workspace/current",
        executionTargetIsRemote: false,
      }),
    ).toBe(true);
  });

  it("returns true for identical paths", () => {
    expect(
      claudeSessionCwdMatchesExecutionTarget({
        runtimeSessionCwd: "/workspace/current",
        effectiveExecutionCwd: "/workspace/current",
        executionTargetIsRemote: false,
      }),
    ).toBe(true);
  });

  it("returns false for different paths", () => {
    expect(
      claudeSessionCwdMatchesExecutionTarget({
        runtimeSessionCwd: "/workspace/foo",
        effectiveExecutionCwd: "/workspace/bar",
        executionTargetIsRemote: false,
      }),
    ).toBe(false);
  });

  it("matches real paths when one is a symlink", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-session-match-"));
    const realDir = path.join(tmpBase, "real-repo");
    const symlinkDir = path.join(tmpBase, "symlink-repo");
    await fs.mkdir(realDir);
    await fs.symlink(realDir, symlinkDir);

    try {
      expect(
        claudeSessionCwdMatchesExecutionTarget({
          runtimeSessionCwd: symlinkDir,
          effectiveExecutionCwd: realDir,
          executionTargetIsRemote: false,
        }),
      ).toBe(true);

      expect(
        claudeSessionCwdMatchesExecutionTarget({
          runtimeSessionCwd: realDir,
          effectiveExecutionCwd: symlinkDir,
          executionTargetIsRemote: false,
        }),
      ).toBe(true);
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true });
    }
  });
});
