const DEFAULT_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES_BEFORE_CLEANUP = 10_000;

const lastTouchedMap = new Map<string, number>();

/**
 * Determines whether an API key should update its `lastUsedAt` timestamp in the database.
 * Returns true at most once every `minIntervalMs` (default: 5 minutes) per key.
 */
export function shouldTouchApiKey(
  keyId: string,
  minIntervalMs = DEFAULT_TOUCH_INTERVAL_MS,
  nowMs = Date.now(),
): boolean {
  if (!keyId) return false;

  const lastTouched = lastTouchedMap.get(keyId);
  if (lastTouched !== undefined && nowMs - lastTouched < minIntervalMs) {
    return false;
  }

  // Periodic bounded prune to avoid unbounded memory growth
  if (lastTouchedMap.size >= MAX_ENTRIES_BEFORE_CLEANUP) {
    const cutoff = nowMs - minIntervalMs;
    for (const [id, timestamp] of lastTouchedMap.entries()) {
      if (timestamp < cutoff) {
        lastTouchedMap.delete(id);
      }
    }
  }

  lastTouchedMap.set(keyId, nowMs);
  return true;
}

/** Reset touch buffer state (for unit tests). */
export function resetApiKeyTouchBuffer(): void {
  lastTouchedMap.clear();
}
