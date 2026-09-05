import { describe, it, expect, beforeEach } from "vitest";
import { shouldTouchApiKey, resetApiKeyTouchBuffer } from "./api-key-touch-buffer.js";

describe("apiKeyTouchBuffer", () => {
  beforeEach(() => {
    resetApiKeyTouchBuffer();
  });

  it("returns true on the first call for a key", () => {
    expect(shouldTouchApiKey("key-1", 300_000, 1_000_000)).toBe(true);
  });

  it("returns false if called within minIntervalMs", () => {
    const start = 1_000_000;
    expect(shouldTouchApiKey("key-1", 300_000, start)).toBe(true);
    expect(shouldTouchApiKey("key-1", 300_000, start + 100_000)).toBe(false);
    expect(shouldTouchApiKey("key-1", 300_000, start + 299_999)).toBe(false);
  });

  it("returns true again once minIntervalMs has elapsed", () => {
    const start = 1_000_000;
    expect(shouldTouchApiKey("key-1", 300_000, start)).toBe(true);
    expect(shouldTouchApiKey("key-1", 300_000, start + 300_000)).toBe(true);
  });

  it("tracks different keys independently", () => {
    const start = 1_000_000;
    expect(shouldTouchApiKey("key-1", 300_000, start)).toBe(true);
    expect(shouldTouchApiKey("key-2", 300_000, start)).toBe(true);
    expect(shouldTouchApiKey("key-1", 300_000, start + 10_000)).toBe(false);
    expect(shouldTouchApiKey("key-2", 300_000, start + 10_000)).toBe(false);
  });

  it("returns false for empty keyId", () => {
    expect(shouldTouchApiKey("")).toBe(false);
  });
});
