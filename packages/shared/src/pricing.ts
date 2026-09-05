export interface ModelPricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/**
 * Standard public API list prices ($ per 1,000,000 tokens) for inference cost simulation.
 * Used to calculate the economic value of tokens processed under subscription-included
 * auth modes where provider-reported billable cost is $0.
 */
export const KNOWN_MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude 3.7 & 3.5 Sonnet / Sonnet 4
  "claude-3-7-sonnet": { inputPerMillionUsd: 3.0, cachedInputPerMillionUsd: 0.3, outputPerMillionUsd: 15.0 },
  "claude-3-5-sonnet": { inputPerMillionUsd: 3.0, cachedInputPerMillionUsd: 0.3, outputPerMillionUsd: 15.0 },
  "claude-sonnet": { inputPerMillionUsd: 3.0, cachedInputPerMillionUsd: 0.3, outputPerMillionUsd: 15.0 },

  // Claude 3 Opus / Opus 4
  "claude-3-opus": { inputPerMillionUsd: 15.0, cachedInputPerMillionUsd: 1.5, outputPerMillionUsd: 75.0 },
  "claude-opus": { inputPerMillionUsd: 15.0, cachedInputPerMillionUsd: 1.5, outputPerMillionUsd: 75.0 },

  // Claude 3.5 Haiku / Haiku 4
  "claude-3-5-haiku": { inputPerMillionUsd: 0.8, cachedInputPerMillionUsd: 0.08, outputPerMillionUsd: 4.0 },
  "claude-3-haiku": { inputPerMillionUsd: 0.25, cachedInputPerMillionUsd: 0.03, outputPerMillionUsd: 1.25 },
  "claude-haiku": { inputPerMillionUsd: 0.8, cachedInputPerMillionUsd: 0.08, outputPerMillionUsd: 4.0 },

  // OpenAI / Codex models
  "gpt-4o": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, cachedInputPerMillionUsd: 0.075, outputPerMillionUsd: 0.6 },
  "o1": { inputPerMillionUsd: 15.0, cachedInputPerMillionUsd: 7.5, outputPerMillionUsd: 60.0 },
  "o3-mini": { inputPerMillionUsd: 1.1, cachedInputPerMillionUsd: 0.55, outputPerMillionUsd: 4.4 },
};

export const DEFAULT_CLAUDE_PRICING: ModelPricing = {
  inputPerMillionUsd: 3.0,
  cachedInputPerMillionUsd: 0.3,
  outputPerMillionUsd: 15.0,
};

export function resolveModelPricing(model: string, provider?: string | null): ModelPricing {
  const normalized = (model || "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
  for (const [key, pricing] of Object.entries(KNOWN_MODEL_PRICING)) {
    if (normalized.includes(key)) return pricing;
  }
  if (provider === "anthropic" || normalized.includes("claude")) {
    return DEFAULT_CLAUDE_PRICING;
  }
  return DEFAULT_CLAUDE_PRICING;
}

export function simulateCostUsd(input: {
  model?: string | null;
  provider?: string | null;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): number {
  const pricing = resolveModelPricing(input.model ?? "", input.provider ?? "");
  const inputTokens = Math.max(0, input.inputTokens || 0);
  const cachedInputTokens = Math.max(0, input.cachedInputTokens || 0);
  const outputTokens = Math.max(0, input.outputTokens || 0);

  const inputUsd = (inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const cachedUsd = (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillionUsd;
  const outputUsd = (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;

  return inputUsd + cachedUsd + outputUsd;
}

export function simulateCostCents(input: {
  model?: string | null;
  provider?: string | null;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): number {
  const usd = simulateCostUsd(input);
  return Math.round(usd * 100);
}
