---
name: cost-guard
description: Enforce token-efficient codebase investigation rules: avoid repetitive file reads, slice large files by line range, omit noisy diffs, and check budget limits before broad exploratory loops.
key: paperclipai/optional/software-development/cost-guard
recommendedForRoles:
  - engineer
  - researcher
tags:
  - token-efficiency
  - cost-control
  - budget
  - codebase-navigation
---

# Cost Guard (Token-Efficient Codebase Navigation)

Maintain strict token hygiene when investigating, searching, and editing code. Unconstrained file dumping and noisy command outputs waste the agent's context window, degrade reasoning, and inflate per-run token costs.

## Core Rules

1. **Targeted Reading (Slicing Over Dumping)**:
   - Never read an entire file (>200 lines) when searching for a specific function, type, or bug.
   - Use targeted grep (`grep_search`) or symbol search first to locate the line numbers, then view only the relevant slice with `StartLine` and `EndLine`.

2. **No Redundant Re-Reading**:
   - Do not re-fetch or re-read files that you inspected earlier in the current turn unless you have modified them or git state has changed. Rely on the transcript or local memory.

3. **Exclude Noisy Diffs**:
   - When inspecting git changes, always ignore generated files, dependencies, and lockfiles:
     ```bash
     git diff ':!*-lock.*' ':!*.lock' ':!dist/*' ':!node_modules/*'
     ```

4. **Filtered Test Output**:
   - When running unit tests or linters, filter the output to show only failing assertions:
     ```bash
     pnpm test:run --reporter=tap | grep -E 'not ok|FAIL|Error'
     ```
   - Never dump hundreds of passing tests into the context window.

5. **Loop and Turn Awareness**:
   - If an automated fix fails 3 consecutive times, stop running blind trial-and-error commands. Step back, re-analyze the root cause with a clear hypothesis, and present the obstacle concisely.
