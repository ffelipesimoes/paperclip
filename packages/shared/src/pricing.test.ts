import { describe, expect, it } from "vitest";
import {
  resolveModelPricing,
  simulateCostCents,
  simulateCostUsd,
  KNOWN_MODEL_PRICING,
  DEFAULT_CLAUDE_PRICING,
} from "./pricing.js";

describe("pricing simulation", () => {
  it("resolves pricing for known Claude models", () => {
    const sonnet = resolveModelPricing("claude-3-5-sonnet-20241022");
    expect(sonnet).toEqual(KNOWN_MODEL_PRICING["claude-3-5-sonnet"]);
    expect(sonnet.inputPerMillionUsd).toBe(3.0);
    expect(sonnet.outputPerMillionUsd).toBe(15.0);

    const opus = resolveModelPricing("claude-3-opus-20240229");
    expect(opus).toEqual(KNOWN_MODEL_PRICING["claude-3-opus"]);

    const haiku = resolveModelPricing("claude-3-5-haiku-20241022");
    expect(haiku).toEqual(KNOWN_MODEL_PRICING["claude-3-5-haiku"]);
  });

  it("falls back to default Claude pricing for unknown Claude models", () => {
    const custom = resolveModelPricing("claude-future-model");
    expect(custom).toEqual(DEFAULT_CLAUDE_PRICING);
  });

  it("falls back to default Claude pricing for anthropic provider", () => {
    const generic = resolveModelPricing("custom-model", "anthropic");
    expect(generic).toEqual(DEFAULT_CLAUDE_PRICING);
  });

  it("correctly simulates cost in USD and cents", () => {
    // 1,000,000 input tokens on Sonnet ($3.00)
    // 500,000 cached input tokens on Sonnet ($0.15)
    // 200,000 output tokens on Sonnet ($3.00)
    // Total: $3.00 + $0.15 + $3.00 = $6.15 = 615 cents
    const usd = simulateCostUsd({
      model: "claude-3-7-sonnet",
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 200_000,
    });
    expect(usd).toBeCloseTo(6.15, 4);

    const cents = simulateCostCents({
      model: "claude-3-7-sonnet",
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 200_000,
    });
    expect(cents).toBe(615);
  });

  it("handles zero or missing tokens gracefully", () => {
    const usd = simulateCostUsd({
      model: "claude-3-5-sonnet",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(usd).toBe(0);
    expect(simulateCostCents({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
