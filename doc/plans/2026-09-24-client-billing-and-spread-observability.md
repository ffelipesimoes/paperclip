# Client Billing, Spread Monetization, and Observability Masking

## Context

Paperclip tracks model spend in `cost_events` with support for `metered_api` and `subscription_included` billing modes. Under subscription modes (e.g. Claude OAuth, ChatGPT Plus/Team via Codex), `cost_cents` is recorded as 0 while `simulateCostCents` estimates the public token market value dynamically in memory for dashboards.

When operators or agencies use Paperclip to provide autonomous agent services to external clients, two major challenges arise:
1. **Lack of Spread Monetization & Billing Customization:** Operators have no native way to apply a commercial markup or BYOK platform fee to client usage.
2. **Client Transparency Leak:** If clients are given access to their company workspace or cost reports, they currently see `Spend: $0.00` alongside `(sim. $X.XX)`. This exposes internal cost structures, subscription arbitrage, and margin rates to the client.

## Goals

1. **Dual-Track & Commercial Cost Ledger:**
   - Store both actual incurred cost (`cost_cents`), market simulated cost (`simulated_cost_cents`), and client billable amount (`billable_cents`) directly on `cost_events`.
   - Calculate `billable_cents` automatically upon heartbeat completion based on company-level billing rules.
2. **Company Billing Configurations:**
   - `billingPricingMode`:
     - `passthrough`: exact billed cost.
     - `simulated_markup`: market value of tokens + operator markup percentage (e.g. 30%).
     - `fixed_markup`: real incurred cost + markup percentage.
     - `byok_fee`: platform fee per million tokens processed.
   - `billingMarkupPercent`: integer percentage.
   - `billingByokFeePerMillionCents`: fee per 1,000,000 tokens in cents.
   - `hideInternalCostFromClient`: boolean flag to toggle client-facing cost masking.
3. **Flexible Budget Enforcement:**
   - Support `metric` values: `billed_cents` (protect operator wallet), `simulated_cents` (protect subscription quota/rate limits), and `billable_cents` (commercial client contract budget).
4. **Client-Safe Observability & Operator Transparency:**
   - In Operator view: Expose Real Spend, Market Simulated Value, Billable Revenue, and Net Spread/Margin with margin %.
   - When masked for Client view: Display only commercial Billable Spend and Token/Task productivity metrics; suppress internal $0 spend numbers, `(sim. $...)` labels, and margin indicators.

## Plan

1. **Contracts & Schema (`packages/shared` & `packages/db`):**
   - Update constants, types, and schemas for `BillingPricingMode`, `BUDGET_METRICS`, `Company`, `CostEvent`, and `CostSummary`.
   - Add pricing calculation helper `calculateBillableCents`.
   - Add columns to `companies` and `cost_events` tables.
   - Generate database migration `0242_client_billing_and_spread.sql`.
2. **Backend Engine (`server`):**
   - In `heartbeat.ts`: compute `simulatedCostCents` and `billableCents` during run finalization, saving them on `cost_events`.
   - In `costs.ts`: aggregate `billableCents` and `marginCents` in summaries and breakdowns; respect `hideInternalCostFromClient`.
   - In `budgets.ts`: evaluate `metric: "billable_cents"` and `"simulated_cents"` in `computeObservedAmount` and `getInvocationBlock`.
   - In `companies.ts`: allow updating company billing configurations.
3. **UI / Observability (`ui`):**
   - Update `Costs.tsx` and `CompanySettings` to display commercial metrics and operator spread cards.
   - Hide internal costs and margin when viewing in masked/client mode.
4. **Verification:**
   - Run typecheck and Vitest test suites.
