import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpDown,
  BarChart2,
  Bot,
  Building2,
  Calendar,
  Check,
  Clock,
  Coins,
  Cpu,
  DollarSign,
  Download,
  ExternalLink,
  Flame,
  GitFork,
  HardDrive,
  Info,
  PieChart,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import type {
  InstanceObservabilitySummary,
  CompanyComputeUsage,
  ModelComputeUsage,
  ComputeTimelinePoint,
  CostlyTask,
  TaskCostDetail,
} from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { ApiError } from "@/api/client";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentStatusBadge } from "@/components/StatusBadge";
import { AgentTraceViewer } from "@/components/AgentTraceViewer";
import { cn, formatBytes, formatCents, formatDurationMs, formatRuntimeMs, formatTokens } from "@/lib/utils";

const WINDOW_PRESETS = [
  { key: "24h", label: "Last 24h" },
  { key: "7d", label: "Last 7d" },
  { key: "30d", label: "Last 30d" },
  { key: "all", label: "All time" },
] as const;

type WindowKey = (typeof WINDOW_PRESETS)[number]["key"];
type SortField = "runtime" | "tokens" | "simulatedCost" | "cost" | "name" | "activeRuns";
type AgentSortField = "runtime" | "tokens" | "simulatedCost" | "name" | "runs" | "activeRuns" | "throughput";

const MODEL_PALETTE = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-cyan-500",
  "bg-orange-500",
];

function exportObservabilityCsv(
  data: InstanceObservabilitySummary,
  windowKey: string,
  selectedCompanyId?: string,
  selectedCompany?: CompanyComputeUsage | null,
) {
  const rows: string[] = [];

  const escape = (val: unknown) => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const scopeLabel =
    selectedCompany && selectedCompanyId !== "all"
      ? `${selectedCompany.companyName} (${selectedCompany.companyPrefix})`
      : "Total Geral (All Organizations)";

  // Section 1: Summary Overview
  rows.push("=== PAPERCLIP INSTANCE COMPUTE & OBSERVABILITY REPORT ===");
  rows.push(`Report Generated,${new Date().toISOString()}`);
  rows.push(`Scope,${escape(scopeLabel)}`);
  rows.push(`Time Window,${windowKey}`);
  rows.push(`Total Organizations,${data.totalCompanies}`);
  rows.push(`Total Agents,${data.totalAgents}`);
  rows.push(`Total Runs,${data.totalRuns}`);
  rows.push(`Active Runs,${data.activeRuns}`);
  rows.push(`Total Runtime (ms),${data.totalRuntimeMs}`);
  rows.push(`Total Runtime (formatted),${escape(formatRuntimeMs(data.totalRuntimeMs))}`);
  rows.push(`Total Tokens,${data.totalTokens}`);
  rows.push(`Input Tokens,${data.inputTokens}`);
  rows.push(`Cached Input Tokens,${data.cachedInputTokens}`);
  rows.push(`Output Tokens,${data.outputTokens}`);
  rows.push(`Cache Hit Rate (%),${data.cacheHitRate ?? 0}%`);
  rows.push(`Estimated Cache Savings ($),${((data.simulatedCacheSavingsCents ?? 0) / 100).toFixed(2)}`);
  rows.push(`Simulated Model Cost ($),${((data.simulatedCostCents ?? 0) / 100).toFixed(2)}`);
  rows.push(`Actual Billed Spend ($),${((data.billedCostCents ?? 0) / 100).toFixed(2)}`);
  rows.push("");

  // Section 2: Organizations
  rows.push("=== ORGANIZATIONS ===");
  rows.push(
    [
      "Company ID",
      "Company Name",
      "Prefix",
      "Status",
      "Agents",
      "Active Agents",
      "Tasks",
      "Runs",
      "Active Runs",
      "Runtime (ms)",
      "Total Tokens",
      "Input Tokens",
      "Cached Input Tokens",
      "Output Tokens",
      "Billed Cost ($)",
      "Simulated Cost ($)",
    ]
      .map(escape)
      .join(","),
  );

  for (const c of data.companies) {
    rows.push(
      [
        c.companyId,
        c.companyName,
        c.companyPrefix,
        c.companyStatus,
        c.agentCount,
        c.activeAgentCount,
        c.issueCount,
        c.runCount,
        c.activeRunCount,
        c.runtimeMs,
        c.totalTokens,
        c.inputTokens,
        c.cachedInputTokens,
        c.outputTokens,
        (c.costCents / 100).toFixed(2),
        (c.simulatedCostCents / 100).toFixed(2),
      ]
        .map(escape)
        .join(","),
    );
  }
  rows.push("");

  // Section 3: Agents Breakdown
  rows.push("=== AGENTS ===");
  rows.push(
    [
      "Agent ID",
      "Agent Name",
      "Role",
      "Status",
      "Company Name",
      "Company Prefix",
      "Runs",
      "Active Runs",
      "Runtime (ms)",
      "Avg Duration (ms)",
      "Total Tokens",
      "Input Tokens",
      "Cached Input Tokens",
      "Output Tokens",
      "Tokens/sec",
      "Billed Cost ($)",
      "Simulated Cost ($)",
    ]
      .map(escape)
      .join(","),
  );

  for (const a of data.agents) {
    rows.push(
      [
        a.agentId,
        a.agentName,
        a.agentRole,
        a.agentStatus,
        a.companyName,
        a.companyPrefix,
        a.runCount,
        a.activeRunCount,
        a.runtimeMs,
        a.avgDurationMs,
        a.totalTokens,
        a.inputTokens,
        a.cachedInputTokens,
        a.outputTokens,
        a.tokensPerSecond,
        (a.costCents / 100).toFixed(2),
        (a.simulatedCostCents / 100).toFixed(2),
      ]
        .map(escape)
        .join(","),
    );
  }
  rows.push("");

  // Section 4: Models Mix
  if (data.models && data.models.length > 0) {
    rows.push("=== MODEL MIX ===");
    rows.push(
      [
        "Provider",
        "Model",
        "Input Tokens",
        "Cached Input Tokens",
        "Output Tokens",
        "Total Tokens",
        "Percentage (%)",
        "Billed Cost ($)",
        "Simulated Cost ($)",
      ]
        .map(escape)
        .join(","),
    );

    for (const m of data.models) {
      rows.push(
        [
          m.provider,
          m.model,
          m.inputTokens,
          m.cachedInputTokens,
          m.outputTokens,
          m.totalTokens,
          m.percentage,
          (m.costCents / 100).toFixed(2),
          (m.simulatedCostCents / 100).toFixed(2),
        ]
          .map(escape)
          .join(","),
      );
    }
    rows.push("");
  }

  // Section 5: Top Tasks
  if (data.costlyTasks && data.costlyTasks.length > 0) {
    rows.push("=== TOP COSTLIEST TASKS ===");
    rows.push(
      [
        "Issue ID",
        "Issue Title",
        "Company Name",
        "Agent Name",
        "Total Tokens",
        "Simulated Cost ($)",
      ]
        .map(escape)
        .join(","),
    );

    for (const t of data.costlyTasks) {
      rows.push(
        [
          t.issueId,
          t.issueTitle,
          t.companyName ?? "",
          t.agentName ?? "",
          t.totalTokens,
          (t.simulatedCostCents / 100).toFixed(2),
        ]
          .map(escape)
          .join(","),
      );
    }
  }

  // Section 5: Task Costs & Workflow Attribution
  if (data.tasks && data.tasks.length > 0) {
    rows.push("");
    rows.push("=== TASK COSTS & WORKFLOW ATTRIBUTION ===");
    rows.push(
      [
        "Issue ID",
        "Identifier",
        "Task Title",
        "Company",
        "Agent",
        "Status",
        "Priority",
        "Origin",
        "Runs",
        "Total Tokens",
        "Input Tokens",
        "Cached Tokens",
        "Output Tokens",
        "Cache Hit Rate (%)",
        "Simulated Cost ($)",
        "Billed Cost ($)",
      ]
        .map(escape)
        .join(","),
    );

    for (const t of data.tasks) {
      rows.push(
        [
          t.issueId,
          t.identifier ?? "",
          t.issueTitle,
          t.companyName ?? "",
          t.agentName ?? "",
          t.status,
          t.priority,
          t.originKind,
          t.runCount,
          t.totalTokens,
          t.inputTokens,
          t.cachedInputTokens,
          t.outputTokens,
          `${t.cacheHitRate}%`,
          (t.simulatedCostCents / 100).toFixed(2),
          (t.costCents / 100).toFixed(2),
        ]
          .map(escape)
          .join(","),
      );
    }
  }

  const csvContent = "\uFEFF" + rows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const scopeSlug =
    selectedCompany && selectedCompanyId !== "all"
      ? selectedCompany.companyPrefix.toLowerCase()
      : "all";
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `paperclip-observability-${scopeSlug}-${windowKey}-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ModelMixCard({ models }: { models?: ModelComputeUsage[] }) {
  const modelList = models ?? [];

  return (
    <Card>
      <CardHeader className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Model Mix & LLM Distribution</CardTitle>
        </div>
        <CardDescription>
          Share of tokens and simulated expenditure across providers and LLM architectures.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-2 space-y-4">
        {modelList.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
            No model usage recorded for this window.
          </div>
        ) : (
          <>
            <div className="h-3 w-full rounded-full overflow-hidden flex bg-muted/40">
              {modelList.map((m, idx) => (
                <div
                  key={`${m.provider}:${m.model}`}
                  className={`${MODEL_PALETTE[idx % MODEL_PALETTE.length]} transition-all`}
                  style={{ width: `${Math.max(1, m.percentage)}%` }}
                  title={`${m.model}: ${m.percentage}% (${formatTokens(m.totalTokens)} tokens)`}
                />
              ))}
            </div>

            <div className="space-y-2 pt-1 max-h-56 overflow-y-auto pr-1">
              {modelList.map((m, idx) => (
                <div
                  key={`${m.provider}:${m.model}`}
                  className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${MODEL_PALETTE[idx % MODEL_PALETTE.length]}`} />
                    <span className="font-medium text-foreground truncate">{m.model}</span>
                    <Badge variant="outline" className="text-(length:--text-micro) font-mono px-1 py-0">
                      {m.provider}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    <span className="text-muted-foreground font-mono">
                      {formatTokens(m.totalTokens)} ({m.percentage}%)
                    </span>
                    <span className="font-mono font-medium text-amber-500 min-w-16">
                      {formatCents(m.simulatedCostCents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CostlyTasksCard({
  tasks,
  onSelectRun,
}: {
  tasks?: CostlyTask[];
  onSelectRun?: (runId: string) => void;
}) {
  const taskList = tasks ?? [];

  return (
    <Card>
      <CardHeader className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">Top Costliest Tasks</CardTitle>
        </div>
        <CardDescription>
          Work items and tasks accounting for the highest token and compute consumption.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-2">
        {taskList.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
            No task-level compute attribution recorded.
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {taskList.map((t, idx) => (
              <div
                key={t.issueId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono font-medium text-(length:--text-micro) text-muted-foreground">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {t.companyPrefix ? (
                        <Link
                          to={`/${t.companyPrefix}/issues/${t.issueId}`}
                          className="hover:underline text-foreground"
                        >
                          {t.issueTitle}
                        </Link>
                      ) : (
                        t.issueTitle
                      )}
                    </div>
                    <div className="text-(length:--text-micro) text-muted-foreground">
                      {t.companyName ?? "Organization"} {t.agentName ? `· Agent: ${t.agentName}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-right">
                  <div className="text-right">
                    <div className="font-mono font-medium text-amber-500">{formatCents(t.simulatedCostCents)}</div>
                    <div className="text-(length:--text-micro) font-mono text-muted-foreground">{formatTokens(t.totalTokens)}</div>
                  </div>
                  {t.companyPrefix && (
                    <Button variant="ghost" size="icon-sm" asChild className="h-7 w-7">
                      <Link to={`/${t.companyPrefix}/issues/${t.issueId}`} aria-label="Open task">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                  {onSelectRun && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2 gap-1 text-sky-600 dark:text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
                      onClick={() => onSelectRun(t.latestRunId ?? t.issueId)}
                      title="Ver Árvore de Rastreio (Trace)"
                    >
                      <GitFork className="h-3 w-3" />
                      <span>Trace</span>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ComputeTimelineCard({
  timeline,
  window,
}: {
  timeline?: ComputeTimelinePoint[];
  window: string;
}) {
  const [metric, setMetric] = useState<"cost" | "tokens" | "runtime">("cost");
  const points = timeline ?? [];
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  const analytics = useMemo(() => {
    if (points.length === 0) {
      return { total: 0, avg: 0, peak: null, peakVal: 0 };
    }
    let total = 0;
    let peakVal = -1;
    let peakPoint: ComputeTimelinePoint | null = null;

    for (const p of points) {
      const v = metric === "cost" ? p.simulatedCostCents : metric === "tokens" ? p.tokens : p.runtimeMs;
      total += v;
      if (v > peakVal) {
        peakVal = v;
        peakPoint = p;
      }
    }
    const avg = Math.round(total / points.length);
    return { total, avg, peak: peakPoint, peakVal: Math.max(0, peakVal) };
  }, [points, metric]);

  const maxVal = analytics.peakVal > 0 ? analytics.peakVal : 1;

  const activePoint = useMemo(() => {
    if (selectedBucket) {
      const found = points.find((p) => p.bucket === selectedBucket);
      if (found) return found;
    }
    return analytics.peak ?? points[points.length - 1] ?? null;
  }, [points, selectedBucket, analytics.peak]);

  const formatMetricValue = (val: number) => {
    if (metric === "cost") return formatCents(val);
    if (metric === "tokens") return formatTokens(val);
    return formatRuntimeMs(val);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="px-5 pt-5 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Linha do Tempo de Computação (Compute Timeline)</CardTitle>
            </div>
            <CardDescription>
              Evolução {window === "24h" ? "horária" : "diária"} de investimento, volume de tokens e tempo de máquina.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border text-xs">
            <button
              type="button"
              onClick={() => setMetric("cost")}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                metric === "cost" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Custo Estimado
            </button>
            <button
              type="button"
              onClick={() => setMetric("tokens")}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                metric === "tokens" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tokens (Cache / In / Out)
            </button>
            <button
              type="button"
              onClick={() => setMetric("runtime")}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                metric === "runtime" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tempo de Execução
            </button>
          </div>
        </div>

        {points.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg border border-border bg-muted/20 p-3 text-xs">
            <div>
              <span className="text-muted-foreground">Total no período:</span>
              <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                {formatMetricValue(analytics.total)}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Média diária:</span>
              <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                {formatMetricValue(analytics.avg)}/dia
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Pico de consumo:</span>
              <div className="mt-0.5 font-mono text-sm font-semibold text-amber-500">
                {analytics.peak ? `${analytics.peak.label} (${formatMetricValue(analytics.peakVal)})` : "—"}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Períodos com atividade:</span>
              <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                {points.length} {window === "24h" ? "horas" : "dias"}
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="px-5 pb-5 pt-2 space-y-4">
        {points.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">
            Nenhuma atividade de computação registrada neste período.
          </div>
        ) : (
          <>
            <div className="relative pt-6 pb-2">
              <div className="absolute inset-x-0 top-6 bottom-8 flex flex-col justify-between pointer-events-none opacity-40">
                <div className="border-b border-dashed border-border w-full flex justify-end">
                  <span className="text-(length:--text-micro) font-mono text-muted-foreground pr-1 -mt-2">
                    {formatMetricValue(analytics.peakVal)}
                  </span>
                </div>
                <div className="border-b border-dashed border-border w-full flex justify-end">
                  <span className="text-(length:--text-micro) font-mono text-muted-foreground pr-1 -mt-2">
                    {formatMetricValue(Math.round(analytics.peakVal / 2))}
                  </span>
                </div>
                <div className="border-b border-border w-full" />
              </div>

              <div className="flex items-end justify-around gap-2 sm:gap-4 h-48 w-full px-2">
                {points.map((pt) => {
                  const val = metric === "cost" ? pt.simulatedCostCents : metric === "tokens" ? pt.tokens : pt.runtimeMs;
                  const heightPct = Math.max(6, Math.round((val / maxVal) * 100));
                  const isSelected = activePoint?.bucket === pt.bucket;
                  const isPeak = analytics.peak?.bucket === pt.bucket;

                  const totalTok = Math.max(1, pt.tokens);
                  const cachedPct = Math.round(((pt.cachedInputTokens ?? 0) / totalTok) * 100);
                  const inPct = Math.round(((pt.inputTokens ?? 0) / totalTok) * 100);
                  const outPct = Math.max(0, 100 - cachedPct - inPct);

                  return (
                    <div
                      key={pt.bucket}
                      onClick={() => setSelectedBucket(pt.bucket)}
                      className="group relative flex-1 max-w-24 flex flex-col items-center justify-end h-full cursor-pointer"
                    >
                      <div className="mb-1.5 flex flex-col items-center">
                        {isPeak && (
                          <span className="text-(length:--text-micro) font-semibold uppercase tracking-wider text-amber-500">
                            Pico
                          </span>
                        )}
                        <span
                          className={`font-mono text-xs font-semibold whitespace-nowrap transition-colors ${
                            isSelected ? "text-foreground scale-105" : "text-muted-foreground group-hover:text-foreground"
                          }`}
                        >
                          {formatMetricValue(val)}
                        </span>
                      </div>

                      <div
                        className={`w-full rounded-t-md transition-all relative overflow-hidden ${
                          isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                        }`}
                        style={{ height: `${heightPct}%` }}
                      >
                        {metric === "tokens" ? (
                          <div className="w-full h-full flex flex-col justify-end">
                            {outPct > 0 && <div style={{ height: `${outPct}%` }} className="bg-purple-500 w-full" title={`Output: ${formatTokens(pt.outputTokens ?? 0)}`} />}
                            {inPct > 0 && <div style={{ height: `${inPct}%` }} className="bg-sky-500 w-full" title={`Input: ${formatTokens(pt.inputTokens ?? 0)}`} />}
                            {cachedPct > 0 && <div style={{ height: `${cachedPct}%` }} className="bg-emerald-500 w-full" title={`Cached: ${formatTokens(pt.cachedInputTokens ?? 0)}`} />}
                          </div>
                        ) : metric === "cost" ? (
                          <div className={`w-full h-full transition-colors ${
                            isPeak ? "bg-amber-500 group-hover:bg-amber-600" : "bg-primary/80 group-hover:bg-primary"
                          }`} />
                        ) : (
                          <div className="w-full h-full bg-blue-500 group-hover:bg-blue-600 transition-colors" />
                        )}
                      </div>

                      <span className={`mt-2 text-xs font-mono transition-colors ${
                        isSelected ? "font-bold text-foreground" : "text-muted-foreground group-hover:text-foreground"
                      }`}>
                        {pt.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {metric === "tokens" && (
              <div className="flex flex-wrap items-center justify-center gap-4 text-xs pt-1 text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span>Prompt Cache</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                  <span>Entrada Padrão (Fresh Input)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
                  <span>Saída (Completion)</span>
                </div>
              </div>
            )}

            {activePoint && (
              <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm text-foreground">
                      Detalhamento de <span className="font-mono">{activePoint.bucket}</span>
                    </span>
                    {analytics.peak?.bucket === activePoint.bucket && (
                      <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs py-0">
                        Pico do Período
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Clique em qualquer barra para alternar o dia
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
                  <div className="rounded border border-border/50 bg-muted/20 p-2 space-y-0.5">
                    <span className="text-muted-foreground">Custo Simulado</span>
                    <div className="font-mono text-sm font-semibold text-amber-500">
                      {formatCents(activePoint.simulatedCostCents)}
                    </div>
                    <span className="text-(length:--text-micro) text-muted-foreground block">
                      Billed direto: {formatCents(activePoint.costCents)}
                    </span>
                  </div>

                  <div className="rounded border border-border/50 bg-muted/20 p-2 space-y-0.5">
                    <span className="text-muted-foreground">Volume de Tokens</span>
                    <div className="font-mono text-sm font-semibold text-foreground">
                      {formatTokens(activePoint.tokens)}
                    </div>
                    <span className="text-(length:--text-micro) text-muted-foreground block">
                      {formatTokens(activePoint.cachedInputTokens ?? 0)} cached ({Math.round(((activePoint.cachedInputTokens ?? 0) / Math.max(1, activePoint.tokens)) * 100)}%)
                    </span>
                  </div>

                  <div className="rounded border border-border/50 bg-muted/20 p-2 space-y-0.5">
                    <span className="text-muted-foreground">Execuções de Agentes</span>
                    <div className="font-mono text-sm font-semibold text-foreground">
                      {activePoint.runCount} runs
                    </div>
                    <span className="text-(length:--text-micro) text-muted-foreground block">
                      Tempo: {formatRuntimeMs(activePoint.runtimeMs)}
                    </span>
                  </div>

                  <div className="rounded border border-border/50 bg-muted/20 p-2 space-y-0.5">
                    <span className="text-muted-foreground">Média por Execução</span>
                    <div className="font-mono text-sm font-semibold text-foreground">
                      {activePoint.runCount > 0 ? formatTokens(Math.round(activePoint.tokens / activePoint.runCount)) : "0"} tok
                    </div>
                    <span className="text-(length:--text-micro) text-muted-foreground block">
                      {activePoint.runCount > 0 ? formatCents(Math.round(activePoint.simulatedCostCents / activePoint.runCount)) : "$0"}/run
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function MetricTile({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="block p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-(length:--text-micro) uppercase tracking-(--tracking-eyebrow) text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Card>
  );
}

export function InstanceObservability() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [window, setWindow] = useState<WindowKey>("30d");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"organizations" | "agents" | "tasks">("organizations");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortField>("runtime");
  const [sortAsc, setSortAsc] = useState(false);
  const [agentSortBy, setAgentSortBy] = useState<AgentSortField>("tokens");
  const [agentSortAsc, setAgentSortAsc] = useState(false);
  const [taskSortBy, setTaskSortBy] = useState<"tokens" | "simulatedCost" | "cost" | "runs" | "title">("simulatedCost");
  const [taskSortAsc, setTaskSortAsc] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Instance settings", href: "/company/settings/instance/general" },
      { label: "Observability" },
    ]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["instance-observability", window, selectedCompanyId],
    queryFn: () => instanceSettingsApi.getObservability(window, selectedCompanyId),
    refetchInterval: 30_000,
  });

  const selectedCompany = useMemo(() => {
    if (!data?.companies || selectedCompanyId === "all") return null;
    return data.companies.find((c) => c.companyId === selectedCompanyId) ?? null;
  }, [data?.companies, selectedCompanyId]);

  const filteredAndSortedCompanies = useMemo(() => {
    if (!data?.companies) return [];
    let list = [...data.companies];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          c.companyPrefix.toLowerCase().includes(q) ||
          c.companyId.toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      let diff = 0;
      switch (sortBy) {
        case "runtime":
          diff = a.runtimeMs - b.runtimeMs;
          break;
        case "tokens":
          diff = a.totalTokens - b.totalTokens;
          break;
        case "simulatedCost":
          diff = a.simulatedCostCents - b.simulatedCostCents;
          break;
        case "cost":
          diff = a.costCents - b.costCents;
          break;
        case "activeRuns":
          diff = a.activeRunCount - b.activeRunCount;
          break;
        case "name":
          diff = a.companyName.localeCompare(b.companyName);
          break;
      }
      return sortAsc ? diff : -diff;
    });

    return list;
  }, [data?.companies, search, sortBy, sortAsc]);

  const filteredAndSortedAgents = useMemo(() => {
    if (!data?.agents) return [];
    let list = [...data.agents];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.agentName.toLowerCase().includes(q) ||
          a.agentRole.toLowerCase().includes(q) ||
          a.companyName.toLowerCase().includes(q) ||
          a.companyPrefix.toLowerCase().includes(q) ||
          a.agentId.toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      let diff = 0;
      switch (agentSortBy) {
        case "runtime":
          diff = a.runtimeMs - b.runtimeMs;
          break;
        case "tokens":
          diff = a.totalTokens - b.totalTokens;
          break;
        case "simulatedCost":
          diff = a.simulatedCostCents - b.simulatedCostCents;
          break;
        case "runs":
          diff = a.runCount - b.runCount;
          break;
        case "activeRuns":
          diff = a.activeRunCount - b.activeRunCount;
          break;
        case "throughput":
          diff = a.tokensPerSecond - b.tokensPerSecond;
          break;
        case "name":
          diff = a.agentName.localeCompare(b.agentName);
          break;
      }
      return agentSortAsc ? diff : -diff;
    });

    return list;
  }, [data?.agents, search, agentSortBy, agentSortAsc]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  const handleAgentSort = (field: AgentSortField) => {
    if (agentSortBy === field) {
      setAgentSortAsc(!agentSortAsc);
    } else {
      setAgentSortBy(field);
      setAgentSortAsc(false);
    }
  };

  const filteredAndSortedTasks = useMemo(() => {
    if (!data?.tasks) return [];
    let list = [...data.tasks];

    if (taskStatusFilter !== "all") {
      list = list.filter((t) => t.status.toLowerCase() === taskStatusFilter.toLowerCase());
    }

    if (taskSearch.trim()) {
      const q = taskSearch.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.issueTitle.toLowerCase().includes(q) ||
          (t.identifier && t.identifier.toLowerCase().includes(q)) ||
          (t.agentName && t.agentName.toLowerCase().includes(q)) ||
          (t.companyName && t.companyName.toLowerCase().includes(q)) ||
          (t.companyPrefix && t.companyPrefix.toLowerCase().includes(q)) ||
          (t.createdByUserId && t.createdByUserId.toLowerCase().includes(q)) ||
          (t.originKind && t.originKind.toLowerCase().includes(q)),
      );
    }

    list.sort((a, b) => {
      let diff = 0;
      switch (taskSortBy) {
        case "tokens":
          diff = a.totalTokens - b.totalTokens;
          break;
        case "simulatedCost":
          diff = a.simulatedCostCents - b.simulatedCostCents;
          break;
        case "cost":
          diff = a.costCents - b.costCents;
          break;
        case "runs":
          diff = a.runCount - b.runCount;
          break;
        case "title":
          diff = a.issueTitle.localeCompare(b.issueTitle);
          break;
      }
      return taskSortAsc ? diff : -diff;
    });

    return list;
  }, [data?.tasks, taskSearch, taskStatusFilter, taskSortBy, taskSortAsc]);

  const handleTaskSort = (field: "tokens" | "simulatedCost" | "cost" | "runs" | "title") => {
    if (taskSortBy === field) {
      setTaskSortAsc(!taskSortAsc);
    } else {
      setTaskSortBy(field);
      setTaskSortAsc(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Observability & Compute Usage</h1>
          </div>
          <p className="text-sm text-muted-foreground">Loading instance compute metrics…</p>
        </div>
      </div>
    );
  }

  if (error) {
    const is403 = error instanceof ApiError && error.status === 403;
    return (
      <div className="max-w-6xl space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Observability & Compute Usage</h1>
          </div>
        </div>

        <Card className="border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                {is403 ? "Admin access required" : "Failed to load observability data"}
              </p>
              <p className="text-muted-foreground">
                {is403
                  ? "Instance admin access is required to view global compute consumption and observability across organizations."
                  : (error as Error).message}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Observability & Compute Usage</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Compute runtime, token usage, simulated model costs, and host hardware resources across all organizations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48 sm:w-56">
            <Select value={selectedCompanyId} onValueChange={(val) => setSelectedCompanyId(val)}>
              <SelectTrigger size="sm" className="h-8 text-xs font-medium">
                <div className="flex items-center gap-1.5 truncate">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {selectedCompanyId === "all"
                      ? "Total Geral"
                      : selectedCompany
                      ? `${selectedCompany.companyName}`
                      : selectedCompanyId}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent align="end" className="max-h-72">
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Total Geral (Todas)</span>
                  </div>
                </SelectItem>
                {data?.companies?.map((c) => (
                  <SelectItem key={c.companyId} value={c.companyId}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.companyName}</span>
                      <span className="text-xs text-muted-foreground font-mono">({c.companyPrefix})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => data && exportObservabilityCsv(data, window, selectedCompanyId, selectedCompany)}
            disabled={!data}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </Button>
          {WINDOW_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              variant={window === preset.key ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setWindow(preset.key)}
              aria-pressed={window === preset.key}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {selectedCompany && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary shrink-0" />
            <span className="text-muted-foreground">Métricas filtradas por empresa:</span>
            <span className="font-semibold text-foreground">{selectedCompany.companyName}</span>
            <Badge variant="outline" className="font-mono text-xs">
              {selectedCompany.companyPrefix}
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              ({selectedCompany.activeAgentCount} agentes ativos · {selectedCompany.issueCount} tarefas · {selectedCompany.runCount} execuções)
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelectedCompanyId("all")}
            className="h-7 px-2.5 text-xs font-medium"
          >
            Ver Total Geral
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Compute runtime"
          value={formatRuntimeMs(data?.totalRuntimeMs ?? 0)}
          subtitle={`${data?.totalRuns ?? 0} runs (${data?.activeRuns ?? 0} active) · avg ${formatDurationMs(data?.avgRunDurationMs ?? 0)}/run`}
          icon={Clock}
        />
        <MetricTile
          label="Total tokens"
          value={formatTokens(data?.totalTokens ?? 0)}
          subtitle={`${(data?.tokensPerSecond ?? 0) > 0 ? `${data?.tokensPerSecond} tok/s · ` : ""}${formatTokens(data?.inputTokens ?? 0)} in · ${formatTokens(data?.cachedInputTokens ?? 0)} cached · ${formatTokens(data?.outputTokens ?? 0)} out`}
          icon={Zap}
        />
        <MetricTile
          label="Simulated model cost"
          value={formatCents(data?.simulatedCostCents ?? 0)}
          subtitle="Estimated standard API value for all runs (incl. Claude subscriptions)"
          icon={Coins}
        />
        <MetricTile
          label="Actual billed spend"
          value={formatCents(data?.billedCostCents ?? 0)}
          subtitle={`${data?.totalCompanies ?? 0} organizations · ${data?.activeAgents ?? 0} active agents`}
          icon={DollarSign}
        />
      </div>

      {((data?.cachedInputTokens ?? 0) > 0 || (data?.simulatedCacheSavingsCents ?? 0) > 0) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-foreground">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <strong className="font-semibold text-emerald-600 dark:text-emerald-400">Prompt Cache Efficiency:</strong>{" "}
              <span className="font-mono font-medium">{data?.cacheHitRate ?? 0}%</span> of input tokens served from prompt cache ({formatTokens(data?.cachedInputTokens ?? 0)} cached tokens).
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Estimated API savings:</span>
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
              +{formatCents(data?.simulatedCacheSavingsCents ?? 0)} saved
            </Badge>
          </div>
        </div>
      )}

      {data?.host && (
        <Card>
          <CardHeader className="px-5 pt-5 pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">Host & Hardware Resources</CardTitle>
                </div>
                <CardDescription>
                  Physical host capacity, memory utilization, load average, and active background execution.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {data.host.cpuModel ? `${data.host.cpuCount} cores · ${data.host.cpuModel}` : `${data.host.cpuCount} CPU cores`}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-2">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>CPU Load Average</span>
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {data.host.loadAvg[0].toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  1m: <span className="font-mono text-foreground font-medium">{data.host.loadAvg[0].toFixed(2)}</span> · 5m: <span className="font-mono text-foreground font-medium">{data.host.loadAvg[1].toFixed(2)}</span> · 15m: <span className="font-mono text-foreground font-medium">{data.host.loadAvg[2].toFixed(2)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Load across {data.host.cpuCount} logical cores
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Host Memory (RAM)</span>
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {Math.round((data.host.usedMemBytes / Math.max(1, data.host.totalMemBytes)) * 100)}%
                  </span>
                </div>
                <div className="text-xs font-mono text-foreground font-medium">
                  {formatBytes(data.host.usedMemBytes)} <span className="text-muted-foreground font-normal">/ {formatBytes(data.host.totalMemBytes)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Free: {formatBytes(data.host.freeMemBytes)}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Disk Storage</span>
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {data.host.diskTotalBytes != null && data.host.diskTotalBytes > 0
                      ? `${Math.round(((data.host.diskUsedBytes ?? 0) / data.host.diskTotalBytes) * 100)}%`
                      : "—"}
                  </span>
                </div>
                <div className="text-xs font-mono text-foreground font-medium">
                  {data.host.diskTotalBytes != null && data.host.diskTotalBytes > 0 ? (
                    <>
                      {formatBytes(data.host.diskUsedBytes ?? 0)}{" "}
                      <span className="text-muted-foreground font-normal">/ {formatBytes(data.host.diskTotalBytes)}</span>
                    </>
                  ) : (
                    "Available"
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.host.diskFreeBytes != null ? `Free: ${formatBytes(data.host.diskFreeBytes)}` : "Host filesystem"}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" />
                    <span>Process Memory</span>
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {formatBytes(data.host.processRssBytes)}
                  </span>
                </div>
                <div className="text-xs font-mono text-foreground font-medium">
                  Heap: {formatBytes(data.host.processHeapUsedBytes)} <span className="text-muted-foreground font-normal">/ {formatBytes(data.host.processHeapTotalBytes)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Node.js RSS: {formatBytes(data.host.processRssBytes)}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Uptime & Concurrency</span>
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {data.host.activeWorkers} active
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Host uptime: <span className="font-mono text-foreground font-medium">{formatUptime(data.host.hostUptimeSeconds)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Process uptime: <span className="font-mono text-foreground font-medium">{formatUptime(data.host.uptimeSeconds)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ModelMixCard models={data?.models} />
        <CostlyTasksCard tasks={data?.costlyTasks} onSelectRun={setSelectedRunId} />
      </div>

      <ComputeTimelineCard timeline={data?.timeline} window={window} />

      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-xs text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground">Claude Subscriptions & Token Cost Simulation</p>
              <p>
                Runs executed via subscription or local CLI adapters bill at $0 direct API cost. Paperclip tracks all
                assistant token streams (prompt, cached, and completion tokens) and calculates a simulated cost based on
                standard public model rates (e.g. Claude 3.7 Sonnet, Opus, Haiku, GPT-4o). This allows instance admins
                to accurately measure compute consumption and simulate market expenditures across every company and agent.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(val) => {
          setActiveTab(val as "organizations" | "agents" | "tasks");
          setSearch("");
          setTaskSearch("");
        }}
        className="w-full"
      >
        <Card>
          <CardHeader className="px-5 pt-5 pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList variant="line">
                <TabsTrigger value="organizations" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  <span>Organizations</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {data?.companies?.length ?? 0}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="agents" className="gap-2">
                  <Bot className="h-4 w-4" />
                  <span>Agents Breakdown</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {data?.agents?.length ?? 0}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="tasks" className="gap-2">
                  <Flame className="h-4 w-4 text-amber-500" />
                  <span>Tarefas & Custos</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {data?.tasks?.length ?? 0}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    activeTab === "organizations"
                      ? "Search organizations…"
                      : activeTab === "agents"
                      ? "Search agents or roles…"
                      : "Buscar tarefa, agente, ID…"
                  }
                  value={activeTab === "tasks" ? taskSearch : search}
                  onChange={(e) => {
                    if (activeTab === "tasks") {
                      setTaskSearch(e.target.value);
                    } else {
                      setSearch(e.target.value);
                    }
                  }}
                  className="pl-8 text-xs"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <TabsContent value="organizations" className="m-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort("name")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Organization</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">Agents</th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort("activeRuns")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Runs</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort("runtime")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Compute runtime</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort("tokens")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Tokens</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort("cost")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Billed</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort("simulatedCost")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Simulated Cost</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedCompanies.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">
                          No organizations found matching the criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedCompanies.map((comp) => (
                        <tr
                          key={comp.companyId}
                          className={cn(
                            "border-b border-border last:border-b-0 hover:bg-muted/20",
                            selectedCompanyId === comp.companyId && "bg-primary/5 hover:bg-primary/10",
                          )}
                        >
                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-foreground">{comp.companyName}</span>
                              <Badge variant="outline" className="font-mono text-xs">
                                {comp.companyPrefix}
                              </Badge>
                              {selectedCompanyId === comp.companyId && (
                                <Badge variant="secondary" className="bg-primary/10 text-primary text-xs px-1.5 py-0 font-normal">
                                  Filtrada
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {comp.issueCount} tasks · status: {comp.companyStatus}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="text-sm font-medium">
                              {comp.activeAgentCount} <span className="text-xs text-muted-foreground font-normal">/ {comp.agentCount}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">active agents</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{comp.runCount}</span>
                              {comp.activeRunCount > 0 && (
                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 text-xs px-1.5 py-0">
                                  {comp.activeRunCount} active
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">total runs</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">{formatRuntimeMs(comp.runtimeMs)}</div>
                            <div className="text-xs text-muted-foreground">cumulative execution</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">{formatTokens(comp.totalTokens)}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatTokens(comp.inputTokens)} in · {formatTokens(comp.outputTokens)} out
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">{formatCents(comp.costCents)}</div>
                            <div className="text-xs text-muted-foreground">direct invoices</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium text-amber-500">{formatCents(comp.simulatedCostCents)}</div>
                            <div className="text-xs text-muted-foreground">simulated value</div>
                          </td>

                          <td className="px-5 py-3.5 text-right align-top">
                            <div className="flex items-center justify-end gap-1.5">
                              {selectedCompanyId === comp.companyId ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setSelectedCompanyId("all")}
                                  className="h-8 px-2.5 text-xs gap-1"
                                  title="Limpar filtro e ver total geral"
                                >
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                  <span>Filtrada</span>
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedCompanyId(comp.companyId)}
                                  className="h-8 px-2.5 text-xs gap-1"
                                  title={`Filtrar métricas para ${comp.companyName}`}
                                >
                                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span>Filtrar</span>
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                                <Link to={`/${comp.companyPrefix}/dashboard`} className="flex items-center gap-1">
                                  <span>Open</span>
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="agents" className="m-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleAgentSort("name")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Agent</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleAgentSort("runs")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Runs</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleAgentSort("runtime")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Compute runtime</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleAgentSort("tokens")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Tokens</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleAgentSort("throughput")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Throughput</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleAgentSort("simulatedCost")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Simulated Cost</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedAgents.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">
                          No agents found matching the criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedAgents.map((agent) => (
                        <tr key={agent.agentId} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-foreground">{agent.agentName}</span>
                              <Badge variant="outline" className="font-mono text-xs">
                                {agent.companyPrefix}
                              </Badge>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {agent.agentRole} · {agent.companyName}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <AgentStatusBadge status={agent.agentStatus} />
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{agent.runCount}</span>
                              {agent.activeRunCount > 0 && (
                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 text-xs px-1.5 py-0">
                                  {agent.activeRunCount} active
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">heartbeat executions</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">{formatRuntimeMs(agent.runtimeMs)}</div>
                            <div className="text-xs text-muted-foreground">
                              {agent.runCount > 0 ? `avg ${formatDurationMs(agent.avgDurationMs)}/run` : "no runs"}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">{formatTokens(agent.totalTokens)}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatTokens(agent.inputTokens)} in · {formatTokens(agent.outputTokens)} out
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">
                              {agent.tokensPerSecond > 0 ? `${agent.tokensPerSecond} tok/s` : "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">token stream rate</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium text-amber-500">
                              {formatCents(agent.simulatedCostCents)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {agent.costCents > 0 ? `billed: ${formatCents(agent.costCents)}` : "subscription ($0 billed)"}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 text-right align-top">
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/${agent.companyPrefix}/agents/${agent.agentId}`} className="flex items-center gap-1">
                                <span>Open</span>
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="tasks" className="m-0">
              <div className="p-4 border-b border-border/60 bg-muted/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground">Filtrar por status:</span>
                  {(["all", "in_progress", "done", "todo", "backlog"] as const).map((st) => (
                    <Button
                      key={st}
                      variant={taskStatusFilter === st ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setTaskStatusFilter(st)}
                      className="h-7 text-xs px-2.5 capitalize"
                    >
                      {st === "all" ? "Todos" : st === "in_progress" ? "Em Progresso" : st === "done" ? "Concluído" : st}
                    </Button>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  Mostrando <strong className="text-foreground">{filteredAndSortedTasks.length}</strong> de{" "}
                  <strong>{data?.tasks?.length ?? 0}</strong> tarefas com consumo
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleTaskSort("title")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Tarefa & Origem</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">Agente & Org</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleTaskSort("runs")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Execuções</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleTaskSort("tokens")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Tokens & Cache</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => handleTaskSort("simulatedCost")}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <span>Custo Simulado</span>
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-5 py-3 text-right font-medium">Rastreio (Trace)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredAndSortedTasks.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-xs text-muted-foreground">
                          Nenhuma tarefa encontrada com consumo de computação.
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedTasks.map((task) => (
                        <tr key={task.issueId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3.5 align-top">
                            <div className="font-medium text-foreground">
                              {task.companyPrefix ? (
                                <Link
                                  to={`/${task.companyPrefix}/issues/${task.issueId}`}
                                  className="hover:underline flex items-center gap-1.5"
                                >
                                  {task.identifier && (
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {task.identifier}
                                    </span>
                                  )}
                                  <span>{task.issueTitle}</span>
                                </Link>
                              ) : (
                                <span>{task.issueTitle}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <Badge variant="outline" className="text-xs px-1 py-0 capitalize">
                                {task.originKind || "manual"}
                              </Badge>
                              {task.createdByUserId && <span>Criado por {task.createdByUserId}</span>}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-medium text-foreground">{task.agentName ?? "Sem agente"}</div>
                            <div className="text-xs text-muted-foreground">{task.companyName}</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="secondary" className="capitalize text-xs">
                                {task.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground capitalize">
                                {task.priority}
                              </span>
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium">{task.runCount}</div>
                            <div className="text-xs text-muted-foreground">runs executadas</div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium">{formatTokens(task.totalTokens)}</span>
                              {task.cacheHitRate > 0 && (
                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs px-1 py-0">
                                  {task.cacheHitRate}% cache
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatTokens(task.inputTokens)} in · {formatTokens(task.outputTokens)} out
                            </div>
                          </td>

                          <td className="px-5 py-3.5 align-top">
                            <div className="font-mono text-sm font-medium text-amber-500">
                              {formatCents(task.simulatedCostCents)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {task.costCents > 0 ? `faturado: ${formatCents(task.costCents)}` : "subscription ($0)"}
                            </div>
                          </td>

                          <td className="px-5 py-3.5 text-right align-top">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-8 text-sky-600 dark:text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
                              onClick={() => setSelectedRunId(task.latestRunId ?? task.issueId)}
                              title="Visualizar Árvore de Rastreio (Trace Tree)"
                            >
                              <GitFork className="h-3.5 w-3.5" />
                              <span>Ver Trace</span>
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      <AgentTraceViewer
        runId={selectedRunId}
        onClose={() => setSelectedRunId(null)}
      />
    </div>
  );
}
