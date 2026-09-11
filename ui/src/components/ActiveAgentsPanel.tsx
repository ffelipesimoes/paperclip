import { memo, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Issue, IssueRecoveryAction } from "@paperclipai/shared";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import type { TranscriptEntry } from "../adapters";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatTokens, relativeTime } from "../lib/utils";
import {
  deriveActiveRecoveryDisplayState,
  RECOVERY_CHIP_DEFAULT_TONE,
} from "../lib/recovery-display";
import { Activity, ExternalLink, Eye, Zap } from "lucide-react";
import { Identity } from "./Identity";
import { RunChatSurface } from "./RunChatSurface";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";
import { Badge } from "@/components/ui/badge";

const TELEMETRY_STORAGE_KEY = "paperclip:dashboard:telemetry-mode";

export interface RunTokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  costUsd: number | null;
  hasMetrics: boolean;
}

export function extractRunTokenMetrics(
  run: LiveRunForIssue,
  transcript: TranscriptEntry[],
): RunTokenMetrics {
  let streamInput = 0;
  let streamOutput = 0;
  let streamCached = 0;
  let streamCost: number | null = null;
  let hasStreamMetrics = false;

  for (const entry of transcript) {
    if (entry.kind === "result") {
      hasStreamMetrics = true;
      streamInput += entry.inputTokens || 0;
      streamOutput += entry.outputTokens || 0;
      streamCached += entry.cachedTokens || 0;
      if (typeof entry.costUsd === "number" && entry.costUsd > 0) {
        streamCost = (streamCost ?? 0) + entry.costUsd;
      }
    }
  }

  let dbInput = 0;
  let dbOutput = 0;
  let dbCached = 0;
  let dbCost: number | null = null;
  let hasDbMetrics = false;

  if (run.usageJson && typeof run.usageJson === "object") {
    const u = run.usageJson as Record<string, unknown>;
    dbInput = Number(u.inputTokens ?? u.input_tokens ?? 0);
    dbOutput = Number(u.outputTokens ?? u.output_tokens ?? 0);
    dbCached = Number(
      u.cachedInputTokens ?? u.cached_input_tokens ?? u.cache_read_input_tokens ?? 0,
    );
    const rawCost = Number(u.costUsd ?? u.cost_usd ?? u.total_cost_usd ?? 0);
    if (rawCost > 0) {
      dbCost = rawCost;
    }
    if (dbInput > 0 || dbOutput > 0 || dbCached > 0 || (dbCost ?? 0) > 0) {
      hasDbMetrics = true;
    }
  }

  const inputTokens = Math.max(streamInput, dbInput);
  const outputTokens = Math.max(streamOutput, dbOutput);
  const cachedTokens = Math.max(streamCached, dbCached);
  const costUsd =
    dbCost != null && streamCost != null
      ? Math.max(dbCost, streamCost)
      : (dbCost ?? streamCost);

  const totalTokens = inputTokens + cachedTokens + outputTokens;
  const totalIn = inputTokens + cachedTokens;
  const cacheHitRate = totalIn > 0 ? Math.round((cachedTokens / totalIn) * 100) : 0;
  const hasMetrics = hasStreamMetrics || hasDbMetrics || totalTokens > 0;

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    cacheHitRate,
    costUsd,
    hasMetrics,
  };
}

function RunCardRecoveryChip({ action }: { action: IssueRecoveryAction }) {
  const state = deriveActiveRecoveryDisplayState(action);
  if (!state) return null;
  const tone = RECOVERY_CHIP_DEFAULT_TONE[state];
  const Icon = tone.icon;
  return (
    <Badge variant="outline"
      data-testid="active-agent-run-recovery-indicator"
      data-recovery-state={state}
      role="status"
      aria-label={tone.label}
      title={`${tone.label} — open the source task to act.`}
      className={cn(
        "gap-0.5 px-1.5 text-(length:--text-nano)",
        tone.className,
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      {tone.label}
    </Badge>
  );
}

const MIN_DASHBOARD_RUNS = 4;
const DASHBOARD_RUN_CARD_LIMIT = 4;
const DASHBOARD_LOG_POLL_INTERVAL_MS = 15_000;
const DASHBOARD_LOG_READ_LIMIT_BYTES = 64_000;
const DASHBOARD_MAX_CHUNKS_PER_RUN = 40;
const EMPTY_TRANSCRIPT: TranscriptEntry[] = [];

function isRunActive(run: LiveRunForIssue): boolean {
  return run.status === "queued" || run.status === "running";
}

interface ActiveAgentsPanelProps {
  companyId: string;
  title?: string;
  minRunCount?: number;
  fetchLimit?: number;
  cardLimit?: number;
  gridClassName?: string;
  cardClassName?: string;
  emptyMessage?: string;
  queryScope?: string;
  showMoreLink?: boolean;
  defaultTelemetryMode?: boolean;
}

export function ActiveAgentsPanel({
  companyId,
  title = "Agents",
  minRunCount = MIN_DASHBOARD_RUNS,
  fetchLimit,
  cardLimit = DASHBOARD_RUN_CARD_LIMIT,
  gridClassName,
  cardClassName,
  emptyMessage = "No recent agent runs.",
  queryScope = "dashboard",
  showMoreLink = true,
  defaultTelemetryMode,
}: ActiveAgentsPanelProps) {
  const [telemetryMode, setTelemetryMode] = useState<boolean>(() => {
    if (defaultTelemetryMode !== undefined) return defaultTelemetryMode;
    try {
      return typeof window !== "undefined" && window.localStorage?.getItem(TELEMETRY_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const handleToggleTelemetry = (enabled: boolean) => {
    setTelemetryMode(enabled);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(TELEMETRY_STORAGE_KEY, String(enabled));
      }
    } catch {}
  };

  const liveRunsQueryKey = [...queryKeys.liveRuns(companyId), queryScope, { minRunCount, fetchLimit }] as const;
  const sharedLiveRuns = useSharedPollingQuery({
    companyId,
    resourceKey: `live-runs:${queryScope}:${minRunCount}:${fetchLimit ?? "default"}`,
    queryKey: liveRunsQueryKey,
    enabled: !!companyId,
    leaderOnly: true,
  });
  const { data: liveRuns, dataUpdatedAt: liveRunsUpdatedAt } = useQuery({
    queryKey: liveRunsQueryKey,
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId, { minCount: minRunCount, limit: fetchLimit }),
    enabled: sharedLiveRuns.enabled,
  });
  usePublishSharedQueryData(sharedLiveRuns, liveRuns, liveRunsUpdatedAt);

  const runs = liveRuns ?? [];
  const visibleRuns = useMemo(() => runs.slice(0, cardLimit), [cardLimit, runs]);
  const hiddenRunCount = Math.max(0, runs.length - visibleRuns.length);
  const visibleIssueIds = useMemo(
    () => [...new Set(visibleRuns.map((run) => run.issueId).filter((issueId): issueId is string => Boolean(issueId)))],
    [visibleRuns],
  );

  const issueQueries = useQueries({
    queries: visibleIssueIds.map((issueId) => ({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: () => issuesApi.get(issueId),
      staleTime: 30_000,
      retry: false,
    })),
  });

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const query of issueQueries) {
      const issue = query.data;
      if (issue) map.set(issue.id, issue);
    }
    return map;
  }, [issueQueries]);

  const { transcriptByRun, hasOutputForRun } = useLiveRunTranscripts({
    runs: visibleRuns,
    companyId,
    maxChunksPerRun: DASHBOARD_MAX_CHUNKS_PER_RUN,
    logPollIntervalMs: DASHBOARD_LOG_POLL_INTERVAL_MS,
    logReadLimitBytes: DASHBOARD_LOG_READ_LIMIT_BYTES,
    enableRealtimeUpdates: false,
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <div
          role="group"
          aria-label="Modo de visualização dos agentes"
          className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5 text-xs"
        >
          <button
            type="button"
            onClick={() => handleToggleTelemetry(false)}
            data-testid="agents-mode-simple"
            aria-pressed={!telemetryMode}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              !telemetryMode
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            <span>Simples</span>
          </button>
          <button
            type="button"
            onClick={() => handleToggleTelemetry(true)}
            data-testid="agents-mode-telemetry"
            aria-pressed={telemetryMode}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              telemetryMode
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Activity className="h-3 w-3" aria-hidden="true" />
            <span>Telemetria</span>
          </button>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4", gridClassName)}>
          {visibleRuns.map((run) => (
            <AgentRunCard
              key={run.id}
              companyId={companyId}
              run={run}
              issue={run.issueId ? issueById.get(run.issueId) : undefined}
              transcript={transcriptByRun.get(run.id) ?? EMPTY_TRANSCRIPT}
              hasOutput={hasOutputForRun(run.id)}
              isActive={isRunActive(run)}
              telemetryMode={telemetryMode}
              className={cardClassName}
            />
          ))}
        </div>
      )}
      {showMoreLink && hiddenRunCount > 0 && (
        <div className="mt-3 flex justify-end text-xs text-muted-foreground">
          <Link to="/dashboard/live" className="hover:text-foreground hover:underline">
            {hiddenRunCount} more active/recent run{hiddenRunCount === 1 ? "" : "s"}
          </Link>
        </div>
      )}
    </div>
  );
}

const AgentRunCard = memo(function AgentRunCard({
  companyId,
  run,
  issue,
  transcript,
  hasOutput,
  isActive,
  telemetryMode = false,
  className,
}: {
  companyId: string;
  run: LiveRunForIssue;
  issue?: Issue;
  transcript: TranscriptEntry[];
  hasOutput: boolean;
  isActive: boolean;
  telemetryMode?: boolean;
  className?: string;
}) {
  const metrics = useMemo(
    () => (telemetryMode ? extractRunTokenMetrics(run, transcript) : null),
    [telemetryMode, run, transcript],
  );

  return (
    <div className={cn(
      "flex h-(--sz-320px) flex-col overflow-hidden rounded-xl border shadow-sm",
      isActive
        ? "border-blue-500/25 bg-blue-500/[0.04] shadow-(--shadow-extract-1)"
        : "border-border bg-background/70",
      className,
    )}>
      <div className="border-b border-border/60 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isActive ? (
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                </span>
              ) : (
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-muted-foreground/35" />
              )}
              <Identity name={run.agentName} size="sm" className="[&>span:last-child]:!text-(length:--text-micro)" />
            </div>
            <div className="mt-2 flex items-center justify-between text-(length:--text-micro) text-muted-foreground">
              <span>{isActive ? "Live now" : run.finishedAt ? `Finished ${relativeTime(run.finishedAt)}` : `Started ${relativeTime(run.createdAt)}`}</span>
              {telemetryMode && metrics && metrics.totalTokens > 0 && (
                <span className="font-mono font-medium text-foreground/80" data-testid="agent-run-total-tokens">
                  {formatTokens(metrics.totalTokens)} tok
                </span>
              )}
            </div>
          </div>

          <Link
            to={`/agents/${run.agentId}/runs/${run.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2 py-1 text-(length:--text-nano) text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>

        {run.issueId && (
          <div className="mt-3 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-xs">
            <Link
              to={`/issues/${issue?.identifier ?? run.issueId}`}
              className={cn(
                "line-clamp-2 hover:underline",
                isActive ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground hover:text-foreground",
              )}
              title={issue?.title ? `${issue?.identifier ?? run.issueId.slice(0, 8)} - ${issue.title}` : issue?.identifier ?? run.issueId.slice(0, 8)}
            >
              {issue?.identifier ?? run.issueId.slice(0, 8)}
              {issue?.title ? ` - ${issue.title}` : ""}
            </Link>
            {issue?.activeRecoveryAction ? (
              <div className="mt-1.5">
                <RunCardRecoveryChip action={issue.activeRecoveryAction} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {telemetryMode && (
        <div
          data-testid="agent-run-telemetry-hud"
          className="border-b border-border/60 bg-muted/25 px-3 py-1.5"
        >
          <div className="flex items-center justify-between gap-1 text-(length:--text-nano)">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-muted-foreground">In:</span>
              <span className="font-medium text-foreground">{formatTokens(metrics?.inputTokens ?? 0)}</span>
              <span className="text-muted-foreground/30">/</span>
              <span className="text-muted-foreground">Out:</span>
              <span className="font-medium text-foreground">{formatTokens(metrics?.outputTokens ?? 0)}</span>
            </div>

            <div className="flex items-center gap-1.5">
              {(metrics?.cachedTokens ?? 0) > 0 ? (
                <span
                  className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 font-mono font-medium text-emerald-600 dark:text-emerald-400"
                  title={`Prompt Cache: ${formatTokens(metrics?.cachedTokens ?? 0)} tokens (${metrics?.cacheHitRate}%)`}
                >
                  <Zap className="h-2.5 w-2.5" />
                  <span>{metrics?.cacheHitRate}%</span>
                </span>
              ) : (
                <span className="font-mono text-muted-foreground">
                  0% cache
                </span>
              )}

              {metrics?.costUsd != null && metrics.costUsd > 0 && (
                <span
                  className="font-mono font-medium text-amber-600 dark:text-amber-400"
                  title={`Custo estimado: $${metrics.costUsd.toFixed(4)}`}
                >
                  {metrics.costUsd < 0.01
                    ? "<$0.01"
                    : `$${metrics.costUsd.toFixed(2)}`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <RunChatSurface
          run={run}
          transcript={transcript}
          hasOutput={hasOutput}
          companyId={companyId}
        />
      </div>
    </div>
  );
});
