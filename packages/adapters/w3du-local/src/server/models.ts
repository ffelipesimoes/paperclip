import { DEFAULT_W3DU_BASE_URL, DEFAULT_W3DU_LOCAL_MODEL, models as staticModels } from "../index.js";

interface ModelsListResponse {
  data?: Array<{ id?: string; label?: string }>;
}

/**
 * Discover available models from the W3DU gateway's /v1/models endpoint. Falls
 * back to the static list exported by ../index.ts when the endpoint is
 * unreachable so agent creation flows never block on network issues.
 */
export async function listW3duModels(
  baseUrl: string = DEFAULT_W3DU_BASE_URL,
  apiKey?: string
): Promise<Array<{ id: string; label: string }>> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return staticModels;
    const body = (await res.json()) as ModelsListResponse;
    if (!Array.isArray(body.data) || body.data.length === 0) return staticModels;
    const discovered = body.data
      .map((entry) => {
        const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : null;
        if (!id) return null;
        const label = typeof entry.label === "string" && entry.label.length > 0 ? entry.label : id;
        return { id, label };
      })
      .filter((m): m is { id: string; label: string } => m !== null);
    if (discovered.length === 0) return staticModels;
    // Ensure the canonical default is first even when discovery reorders.
    discovered.sort((a, b) =>
      a.id === DEFAULT_W3DU_LOCAL_MODEL ? -1 : b.id === DEFAULT_W3DU_LOCAL_MODEL ? 1 : 0
    );
    return discovered;
  } catch {
    return staticModels;
  }
}
