# Example: Token-Efficient File Inspection

This example demonstrates how an agent applies `cost-guard` to investigate and fix a function in a large file.

## Scenario

A service in `server/src/services/heartbeat.ts` (over 20,000 lines) needs a check on `shouldResetTaskSessionForWake`.

### Inefficient (Antipattern - Context Flood)

1. Agent calls `view_file` on `server/src/services/heartbeat.ts` without line bounds.
2. The model receives 800 lines of unrelated code (tens of thousands of tokens).
3. Agent repeats the call with offset to find the function, consuming hundreds of thousands of context tokens.
4. Total tokens consumed: ~45,000 tokens just to locate a 15-line function.

### Cost Guard Pattern (Applied)

1. **Locate exact line number with grep:**
   ```bash
   grep -n "function shouldResetTaskSessionForWake" server/src/services/heartbeat.ts
   # Output: 5169:export function shouldResetTaskSessionForWake(
   ```

2. **Inspect targeted slice:**
   - Agent calls `view_file` specifying `StartLine: 5169` and `EndLine: 5195`.
   - The model receives exactly 26 lines (~250 tokens).

3. **Total tokens consumed:** ~350 tokens (99% token reduction).
