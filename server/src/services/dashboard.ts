import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, heartbeatRuns, issues } from "@paperclipai/db";
import { simulateCostCents } from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";
import { visibleIssueCondition } from "./issue-visibility.js";

const DASHBOARD_RUN_ACTIVITY_DAYS = 14;

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getRecentUtcDateKeys(now: Date, days: number): string[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const dayOffset = index - (days - 1);
    return formatUtcDateKey(new Date(todayUtc + dayOffset * 24 * 60 * 60 * 1000));
  });
}

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const now = new Date();
      const monthStart = getUtcMonthStart(now);
      const runActivityDays = getRecentUtcDateKeys(now, DASHBOARD_RUN_ACTIVITY_DAYS);
      const runActivityStart = new Date(`${runActivityDays[0]}T00:00:00.000Z`);

      const [
        agentRows,
        taskRows,
        pendingApprovals,
        costRows,
        runActivityRaw,
        budgetOverview,
      ] = await Promise.all([
        db
          .select({ status: agents.status, count: sql<number>`count(*)` })
          .from(agents)
          .where(eq(agents.companyId, companyId))
          .groupBy(agents.status),

        db
          .select({ status: issues.status, count: sql<number>`count(*)` })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), visibleIssueCondition()))
          .groupBy(issues.status),

        db
          .select({ count: sql<number>`count(*)` })
          .from(approvals)
          .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
          .then((rows) => Number(rows[0]?.count ?? 0)),

        db
          .select({
            model: costEvents.model,
            provider: costEvents.provider,
            billingType: costEvents.billingType,
            costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
            inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
            cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
            outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
          })
          .from(costEvents)
          .where(
            and(
              eq(costEvents.companyId, companyId),
              gte(costEvents.occurredAt, monthStart),
            ),
          )
          .groupBy(costEvents.model, costEvents.provider, costEvents.billingType),

        db.execute(sql`
          WITH RECURSIVE recovered_runs(id) AS (
            SELECT parent.id
            FROM ${heartbeatRuns} AS child
            JOIN ${heartbeatRuns} AS parent ON parent.id = child.retry_of_run_id
            WHERE child.company_id = ${companyId}
              AND child.status = 'succeeded'
              AND child.created_at >= ${runActivityStart.toISOString()}::timestamptz
            UNION
            SELECT parent.id
            FROM recovered_runs rr
            JOIN ${heartbeatRuns} AS child ON child.id = rr.id
            JOIN ${heartbeatRuns} AS parent ON parent.id = child.retry_of_run_id
            WHERE child.created_at >= ${runActivityStart.toISOString()}::timestamptz
          )
          SELECT
            to_char(run.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
            run.status AS status,
            run.error_code AS error_code,
            (run.id IN (SELECT id FROM recovered_runs)) AS recovered,
            count(*)::double precision AS count
          FROM ${heartbeatRuns} AS run
          WHERE run.company_id = ${companyId}
            AND run.created_at >= ${runActivityStart.toISOString()}::timestamptz
          GROUP BY date, run.status, run.error_code, recovered
        `),

        budgets.overview(companyId),
      ]);

      const runActivityRows = runActivityRaw as unknown as Iterable<{
        date: string;
        status: string;
        error_code: string | null;
        recovered: boolean | string;
        count: number | string;
      }>;

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      let billedCostCents = 0;
      let simulatedCostCents = 0;
      let subscriptionSimulatedCostCents = 0;
      let inputTokens = 0;
      let cachedInputTokens = 0;
      let outputTokens = 0;
      let hasMetered = false;
      let hasSubscription = false;

      for (const row of costRows) {
        const costC = Number(row.costCents ?? 0);
        const inTok = Number(row.inputTokens ?? 0);
        const cacheTok = Number(row.cachedInputTokens ?? 0);
        const outTok = Number(row.outputTokens ?? 0);

        billedCostCents += costC;
        inputTokens += inTok;
        cachedInputTokens += cacheTok;
        outputTokens += outTok;

        const simC = simulateCostCents({
          model: row.model,
          provider: row.provider,
          inputTokens: inTok,
          cachedInputTokens: cacheTok,
          outputTokens: outTok,
        });
        simulatedCostCents += simC;

        if (row.billingType === "metered_api") {
          hasMetered = true;
        } else {
          hasSubscription = true;
          subscriptionSimulatedCostCents += simC;
        }
      }

      if (simulatedCostCents === 0 && (inputTokens > 0 || cachedInputTokens > 0 || outputTokens > 0)) {
        simulatedCostCents = simulateCostCents({
          inputTokens,
          cachedInputTokens,
          outputTokens,
        });
      }

      const totalTokens = inputTokens + cachedInputTokens + outputTokens;
      const isSubscriptionOnly = hasSubscription && !hasMetered && billedCostCents === 0;

      const effectiveSpendCents = billedCostCents > 0
        ? Math.round(billedCostCents + subscriptionSimulatedCostCents)
        : Math.round(simulatedCostCents);

      const monthSpendCents = effectiveSpendCents;

      const runActivity = new Map(
        runActivityDays.map((date) => [
          date,
          {
            date,
            succeeded: 0,
            failed: 0,
            recovered: 0,
            other: 0,
            total: 0,
            failedByErrorCode: {} as Record<string, number>,
          },
        ]),
      );
      for (const row of runActivityRows) {
        const bucket = runActivity.get(String(row.date));
        if (!bucket) continue;
        const count = Number(row.count);
        const status = String(row.status);
        // Postgres booleans can arrive as JS boolean or "t"/"true" depending on driver.
        const recovered = row.recovered === true || row.recovered === "t" || row.recovered === "true";
        if (status === "succeeded") {
          bucket.succeeded += count;
        } else if (status === "failed" || status === "timed_out") {
          if (recovered) {
            bucket.recovered += count;
          } else {
            bucket.failed += count;
            const code =
              typeof row.error_code === "string" && row.error_code.length > 0
                ? row.error_code
                : "unknown";
            bucket.failedByErrorCode[code] = (bucket.failedByErrorCode[code] ?? 0) + count;
          }
        } else {
          bucket.other += count;
        }
        bucket.total += count;
      }

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
          billedCostCents,
          simulatedCostCents,
          totalTokens,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          isSubscriptionOnly,
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        runActivity: Array.from(runActivity.values()),
      };
    },
  };
}
