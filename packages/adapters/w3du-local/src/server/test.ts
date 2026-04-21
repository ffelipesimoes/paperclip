import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult
} from "@paperclipai/adapter-utils";
import { DEFAULT_W3DU_BASE_URL } from "../index.js";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function summarize(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const baseUrl = asString(
    (ctx.config as Record<string, unknown>)?.baseUrl,
    process.env.W3DU_GATEWAY_URL ?? DEFAULT_W3DU_BASE_URL
  );
  const model = asString((ctx.config as Record<string, unknown>)?.model, "");

  let url: URL | null = null;
  try {
    url = new URL(baseUrl);
  } catch {
    checks.push({ code: "w3du_url_invalid", level: "error", message: `Invalid baseUrl: ${baseUrl}` });
  }

  if (!model) {
    checks.push({
      code: "w3du_model_missing",
      level: "error",
      message: "w3du_local requires a model id.",
      hint: 'Set adapterConfig.model (e.g. "gemma4:26b").'
    });
  }

  if (url) {
    const apiKey = asString(
      (ctx.config as Record<string, unknown>)?.apiKey,
      process.env.W3DU_GATEWAY_API_KEY ?? ""
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const probeUrl = `${baseUrl.replace(/\/$/, "")}/models`;
      const res = await fetch(probeUrl, {
        method: "GET",
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        signal: controller.signal
      });
      if (res.ok) {
        checks.push({
          code: "w3du_reachable",
          level: "info",
          message: `Gateway reachable at ${baseUrl} (/models returned ${res.status}).`
        });
      } else if (res.status === 401 || res.status === 403) {
        checks.push({
          code: "w3du_auth_failed",
          level: "error",
          message: `Gateway rejected credentials (HTTP ${res.status}).`,
          hint: "Set adapterConfig.apiKey or env W3DU_GATEWAY_API_KEY."
        });
      } else {
        checks.push({
          code: "w3du_unexpected_status",
          level: "warn",
          message: `Gateway /models returned HTTP ${res.status}.`
        });
      }
    } catch (err) {
      checks.push({
        code: "w3du_unreachable",
        level: "error",
        message: `Could not reach gateway at ${baseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        hint: "Confirm the w3du-api-llm gateway is running and listening on the configured port."
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarize(checks),
    checks,
    testedAt: new Date().toISOString()
  };
}
