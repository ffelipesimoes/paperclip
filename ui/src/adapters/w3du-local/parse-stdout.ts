import type { TranscriptEntry } from "../types";

/**
 * The w3du_local adapter emits human-readable log lines via `onLog` (see
 * packages/adapters/w3du-local/src/server/execute.ts). Surface them verbatim
 * in the transcript UI as stdout lines — there is no JSONL protocol to parse.
 */
export function parseW3duStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return [{ kind: "stdout", ts, text: line }];
}
