# Example: Concise Task Execution

This example demonstrates how an agent applies `concise-mode` to report the fix of a failing build.

## Scenario

A continuous integration job failed due to a missing import in an agent adapter UI builder.

### Verbose (Antipattern - High Token Waste)

> "Hello! Thank you for assigning this task to me. I took a thorough look at the error log and I can see that the TypeScript compiler was complaining about `DEFAULT_AGENT_TIMEOUT_SEC` not being found.
> 
> As you may know, TypeScript requires all used variables to be imported at the top of the file. So what I did was navigate to `packages/adapters/codex-local/src/ui/build-config.ts` and I opened it up. I found line 3 where the imports from `@paperclipai/adapter-utils` were located. I carefully inserted `DEFAULT_AGENT_TIMEOUT_SEC` into the import list right next to `buildAdapterEnvConfig`.
>
> After that, I ran the typecheck command `pnpm -r typecheck` to verify that everything compiles cleanly. The good news is that the error is completely gone! Everything passed without any problems. Let me know if you need anything else!"

### Concise Mode (Applied)

> - **Issue**: Missing `DEFAULT_AGENT_TIMEOUT_SEC` import in `packages/adapters/codex-local/src/ui/build-config.ts`.
> - **Action**: Added `DEFAULT_AGENT_TIMEOUT_SEC` to `@paperclipai/adapter-utils` import block (`build-config.ts#L4`).
> - **Verification**: `pnpm -r typecheck` passed with 0 errors.
> - **Status**: Ready for review.
