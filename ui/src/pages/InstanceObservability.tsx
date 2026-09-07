import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpDown,
  Bot,
  Building2,
  Clock,
  Coins,
  Cpu,
  DollarSign,
  ExternalLink,
  HardDrive,
  Info,
  Search,
  Server,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { Link } from "@/lib/router";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { ApiError } from "@/api/client";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentStatusBadge } from "@/components/StatusBadge";
import { formatBytes, formatCents, formatDurationMs, formatRuntimeMs, formatTokens } from "@/lib/utils";

const WINDOW_PRESETS = [
  { key: "24h", label: "Last 24h" },
  { key: "7d", label: "Last 7d" },
  { key: "30d", label: "Last 30d" },
  { key: "all", label: "All time" },
] as const;

type WindowKey = (typeof WINDOW_PRESETS)[number]["key"];
type SortField = "runtime" | "tokens" | "simulatedCost" | "cost" | "name" | "activeRuns";
type AgentSortField = "runtime" | "tokens" | "simulatedCost" | "name" | "runs" | "activeRuns" | "throughput";

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
  const [activeTab, setActiveTab] = useState<"organizations" | "agents">("organizations");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("runtime");
  const [sortAsc, setSortAsc] = useState(false);
  const [agentSortBy, setAgentSortBy] = useState<AgentSortField>("tokens");
  const [agentSortAsc, setAgentSortAsc] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Instance settings", href: "/company/settings/instance/general" },
      { label: "Observability" },
    ]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["instance-observability", window],
    queryFn: () => instanceSettingsApi.getObservability(window),
    refetchInterval: 30_000,
  });

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
          subtitle={`${(data?.tokensPerSecond ?? 0) > 0 ? `${data?.tokensPerSecond} tok/s · ` : ""}${formatTokens(data?.inputTokens ?? 0)} in · ${formatTokens(data?.outputTokens ?? 0)} out`}
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          setActiveTab(val as "organizations" | "agents");
          setSearch("");
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
              </TabsList>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={activeTab === "organizations" ? "Search organizations…" : "Search agents or roles…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
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
                        <tr key={comp.companyId} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                          <td className="px-5 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-foreground">{comp.companyName}</span>
                              <Badge variant="outline" className="font-mono text-xs">
                                {comp.companyPrefix}
                              </Badge>
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
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/${comp.companyPrefix}/dashboard`} className="flex items-center gap-1">
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
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
