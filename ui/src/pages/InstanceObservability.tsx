import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpDown,
  Building2,
  Clock,
  Coins,
  DollarSign,
  ExternalLink,
  Info,
  Search,
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
import { formatCents, formatRuntimeMs, formatTokens } from "@/lib/utils";

const WINDOW_PRESETS = [
  { key: "24h", label: "Last 24h" },
  { key: "7d", label: "Last 7d" },
  { key: "30d", label: "Last 30d" },
  { key: "all", label: "All time" },
] as const;

type WindowKey = (typeof WINDOW_PRESETS)[number]["key"];
type SortField = "runtime" | "tokens" | "simulatedCost" | "cost" | "name" | "activeRuns";

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
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("runtime");
  const [sortAsc, setSortAsc] = useState(false);

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

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
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
            Compute runtime, token usage, and simulated model costs across all organizations.
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
          subtitle={`${data?.totalRuns ?? 0} runs (${data?.activeRuns ?? 0} currently active)`}
          icon={Clock}
        />
        <MetricTile
          label="Total tokens"
          value={formatTokens(data?.totalTokens ?? 0)}
          subtitle={`${formatTokens(data?.inputTokens ?? 0)} in · ${formatTokens(data?.cachedInputTokens ?? 0)} cached · ${formatTokens(data?.outputTokens ?? 0)} out`}
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
                to accurately measure compute consumption and simulate market expenditures across every company.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-5 pt-5 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Organizations Compute Breakdown</CardTitle>
              <CardDescription>
                Compare runtime, execution load, token volume, and costs per company.
              </CardDescription>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
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
        </CardContent>
      </Card>
    </div>
  );
}
