/**
 * Smoke test: run the adapter against a live w3du gateway.
 *
 * Usage:
 *   W3DU_GATEWAY_URL=http://127.0.0.1:3000/v1 \
 *   W3DU_GATEWAY_API_KEY=w3du_sk_... \
 *   W3DU_MODEL=gemma4:26b \
 *   pnpm tsx scripts/smoke.ts
 *
 * The script spawns the adapter in-process with a temp workspace and asks the
 * model to run "echo hello" via the bash tool. Exits 0 on success, non-zero on
 * any failure path the adapter reports.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "../src/server/execute.js";
import { DEFAULT_W3DU_BASE_URL, DEFAULT_W3DU_LOCAL_MODEL } from "../src/index.js";

async function main(): Promise<void> {
  const baseUrl = process.env.W3DU_GATEWAY_URL ?? DEFAULT_W3DU_BASE_URL;
  const apiKey = process.env.W3DU_GATEWAY_API_KEY ?? "";
  const model = process.env.W3DU_MODEL ?? DEFAULT_W3DU_LOCAL_MODEL;

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "w3du-smoke-"));
  process.stderr.write(`[smoke] workdir=${workdir}\n`);

  try {
    const result = await execute({
      runId: `smoke-${Date.now()}`,
      agent: {
        id: "smoke-agent",
        companyId: "smoke-company",
        name: "Smoke Agent",
        adapterType: "w3du_local",
        adapterConfig: {}
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { baseUrl, apiKey, model, timeoutSec: 120, maxToolTurns: 6 },
      context: {
        paperclipWorkspace: { cwd: workdir },
        taskId: "smoke-task"
      },
      onLog: async (stream, chunk) => {
        process.stderr.write(`[${stream}] ${chunk}`);
      }
    });

    process.stdout.write(`\n=== RESULT ===\n${JSON.stringify(result, null, 2)}\n`);
    if (result.exitCode !== 0) {
      process.exit(1);
    }
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(2);
});
