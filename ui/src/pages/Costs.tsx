import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BudgetPolicySummary,
  CostByAgentModel,
  CostByBiller,
  CostByProviderModel,
  CostWindowSpendRow,
  FinanceEvent,
  QuotaWindow,
  BudgetScopeType,
} from "@paperclipai/shared";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, Coins, DollarSign, Plus, ReceiptText } from "lucide-react";
import { companiesApi } from "../api/companies";
import { budgetsApi } from "../api/budgets";
import { costsApi } from "../api/costs";
import { AddBudgetModal } from "../components/AddBudgetModal";
import { BillerSpendCard } from "../components/BillerSpendCard";
import { BudgetIncidentCard } from "../components/BudgetIncidentCard";
import { BudgetPolicyCard } from "../components/BudgetPolicyCard";
import { EmptyState } from "../components/EmptyState";
import { FinanceBillerCard } from "../components/FinanceBillerCard";
import { FinanceKindCard } from "../components/FinanceKindCard";
import { FinanceTimelineCard } from "../components/FinanceTimelineCard";
import { Identity } from "../components/Identity";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar } from "../components/PageTabBar";
import { ProviderQuotaCard } from "../components/ProviderQuotaCard";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDateRange, PRESET_KEYS, PRESET_LABELS } from "../hooks/useDateRange";
import { queryKeys } from "../lib/queryKeys";
import { billingTypeDisplayName, cn, formatCents, formatTokens, providerDisplayName } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NO_COMPANY = "__none__";
export type CostsMainTab = "overview" | "budgets" | "providers" | "billers" | "finance";

export interface CostsProps {
  /** Render inside Audit without a second page-level title or breadcrumb. */
  embedded?: boolean;
  initialTab?: CostsMainTab;
  /** Pin the surface to one tab (used by Audit > Budgets). */
  lockTab?: boolean;
  /** Budgets is a peer Audit section, so omit it from the Costs sub-navigation. */
  hideBudgetsTab?: boolean;
}

function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon, 0, 0, 0, 0);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59, 999);
  return { from: mon.toISOString(), to: sun.toISOString() };
}

function ProviderTabLabel({ provider, rows }: { provider: string; rows: CostByProviderModel[] }) {
  const totalTokens = rows.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costCents, 0);
  return (
    <span className="flex items-center gap-1.5">
      <span>{providerDisplayName(provider)}</span>
      <span className="font-mono text-xs text-muted-foreground">{formatTokens(totalTokens)}</span>
      <span className="text-xs text-muted-foreground">{formatCents(totalCost)}</span>
    </span>
  );
}

function BillerTabLabel({ biller, rows }: { biller: string; rows: CostByBiller[] }) {
  const totalTokens = rows.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costCents, 0);
  return (
    <span className="flex items-center gap-1.5">
      <span>{providerDisplayName(biller)}</span>
      <span className="font-mono text-xs text-muted-foreground">{formatTokens(totalTokens)}</span>
      <span className="text-xs text-muted-foreground">{formatCents(totalCost)}</span>
    </span>
  );
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

function FinanceSummaryCard({
  debitCents,
  creditCents,
  netCents,
  estimatedDebitCents,
  eventCount,
}: {
  debitCents: number;
  creditCents: number;
  netCents: number;
  estimatedDebitCents: number;
  eventCount: number;
}) {
  return (
    <Card>
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-base">Finance ledger</CardTitle>
        <CardDescription>
          Account-level charges that do not map to a single inference request.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 pb-5 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Debits"
          value={formatCents(debitCents)}
          subtitle={`${eventCount} total event${eventCount === 1 ? "" : "s"} in range`}
          icon={ArrowUpRight}
        />
        <MetricTile
          label="Credits"
          value={formatCents(creditCents)}
          subtitle="Refunds, offsets, and credit returns"
          icon={ArrowDownLeft}
        />
        <MetricTile
          label="Net"
          value={formatCents(netCents)}
          subtitle="Debit minus credit for the selected period"
          icon={ReceiptText}
        />
        <MetricTile
          label="Estimated"
          value={formatCents(estimatedDebitCents)}
          subtitle="Estimated debits that are not yet invoice-authoritative"
          icon={Coins}
        />
      </CardContent>
    </Card>
  );
}

export function Costs({
  embedded = false,
  initialTab = "overview",
  lockTab = false,
  hideBudgetsTab = false,
}: CostsProps = {}) {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [mainTab, setMainTab] = useState<CostsMainTab>(initialTab);
  const [activeProvider, setActiveProvider] = useState("all");
  const [activeBiller, setActiveBiller] = useState("all");
  const showSummaryChrome = !(embedded && lockTab && initialTab === "budgets");

  const {
    preset,
    setPreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    from,
    to,
    customReady,
  } = useDateRange();

  useEffect(() => {
    if (!embedded) setBreadcrumbs([{ label: "Costs" }]);
  }, [embedded, setBreadcrumbs]);

  useEffect(() => {
    setMainTab(initialTab);
  }, [initialTab]);

  const [today, setToday] = useState(() => new Date().toDateString());
  const todayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const schedule = () => {
      const now = new Date();
      const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
      todayTimerRef.current = setTimeout(() => {
        setToday(new Date().toDateString());
        schedule();
      }, ms);
    };
    schedule();
    return () => {
      if (todayTimerRef.current != null) clearTimeout(todayTimerRef.current);
    };
  }, []);

  const weekRange = useMemo(() => currentWeekRange(), [today]);
  const companyId = selectedCompanyId ?? NO_COMPANY;

  const { data: budgetData, isLoading: budgetLoading, error: budgetError } = useQuery({
    queryKey: queryKeys.budgets.overview(companyId),
    queryFn: () => budgetsApi.overview(companyId),
    enabled: !!selectedCompanyId && customReady,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const invalidateBudgetViews = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.budgets.overview(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(selectedCompanyId) });
  };

  const policyMutation = useMutation({
    mutationFn: (input: {
      scopeType: BudgetPolicySummary["scopeType"];
      scopeId: string;
      amount: number;
      windowKind: BudgetPolicySummary["windowKind"];
    }) =>
      budgetsApi.upsertPolicy(companyId, {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        amount: input.amount,
        windowKind: input.windowKind,
      }),
    onSuccess: invalidateBudgetViews,
  });

  const incidentMutation = useMutation({
    mutationFn: (input: { incidentId: string; action: "keep_paused" | "raise_budget_and_resume"; amount?: number }) =>
      budgetsApi.resolveIncident(companyId, input.incidentId, input),
    onSuccess: invalidateBudgetViews,
  });

  const { data: spendData, isLoading: spendLoading, error: spendError } = useQuery({
    queryKey: queryKeys.costs(companyId, from || undefined, to || undefined),
    queryFn: async () => {
      const [summary, byAgent, byProject, byAgentModel] = await Promise.all([
        costsApi.summary(companyId, from || undefined, to || undefined),
        costsApi.byAgent(companyId, from || undefined, to || undefined),
        costsApi.byProject(companyId, from || undefined, to || undefined),
        costsApi.byAgentModel(companyId, from || undefined, to || undefined),
      ]);
      return { summary, byAgent, byProject, byAgentModel };
    },
    enabled: !!selectedCompanyId && customReady && showSummaryChrome,
  });

  const { data: financeData, isLoading: financeLoading, error: financeError } = useQuery({
    queryKey: [
      queryKeys.financeSummary(companyId, from || undefined, to || undefined),
      queryKeys.financeByBiller(companyId, from || undefined, to || undefined),
      queryKeys.financeByKind(companyId, from || undefined, to || undefined),
      queryKeys.financeEvents(companyId, from || undefined, to || undefined, 18),
    ],
    queryFn: async () => {
      const [summary, byBiller, byKind, events] = await Promise.all([
        costsApi.financeSummary(companyId, from || undefined, to || undefined),
        costsApi.financeByBiller(companyId, from || undefined, to || undefined),
        costsApi.financeByKind(companyId, from || undefined, to || undefined),
        costsApi.financeEvents(companyId, from || undefined, to || undefined, 18),
      ]);
      return { summary, byBiller, byKind, events };
    },
    enabled: !!selectedCompanyId && customReady && showSummaryChrome,
  });

  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpandedAgents(new Set());
  }, [companyId, from, to]);

  function toggleAgent(agentId: string) {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  const agentModelRows = useMemo(() => {
    const map = new Map<string, CostByAgentModel[]>();
    for (const row of spendData?.byAgentModel ?? []) {
      const rows = map.get(row.agentId) ?? [];
      rows.push(row);
      map.set(row.agentId, rows);
    }
    for (const [agentId, rows] of map) {
      map.set(agentId, rows.slice().sort((a, b) => b.costCents - a.costCents));
    }
    return map;
  }, [spendData?.byAgentModel]);

  const { data: providerData } = useQuery({
    queryKey: queryKeys.usageByProvider(companyId, from || undefined, to || undefined),
    queryFn: () => costsApi.byProvider(companyId, from || undefined, to || undefined),
    enabled: !!selectedCompanyId && customReady && (mainTab === "providers" || mainTab === "billers"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: billerData } = useQuery({
    queryKey: queryKeys.usageByBiller(companyId, from || undefined, to || undefined),
    queryFn: () => costsApi.byBiller(companyId, from || undefined, to || undefined),
    enabled: !!selectedCompanyId && customReady && mainTab === "billers",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: weekData } = useQuery({
    queryKey: queryKeys.usageByProvider(companyId, weekRange.from, weekRange.to),
    queryFn: () => costsApi.byProvider(companyId, weekRange.from, weekRange.to),
    enabled: !!selectedCompanyId && (mainTab === "providers" || mainTab === "billers"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: weekBillerData } = useQuery({
    queryKey: queryKeys.usageByBiller(companyId, weekRange.from, weekRange.to),
    queryFn: () => costsApi.byBiller(companyId, weekRange.from, weekRange.to),
    enabled: !!selectedCompanyId && mainTab === "billers",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: windowData } = useQuery({
    queryKey: queryKeys.usageWindowSpend(companyId),
    queryFn: () => costsApi.windowSpend(companyId),
    enabled: !!selectedCompanyId && mainTab === "providers",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: quotaData, isLoading: quotaLoading } = useQuery({
    queryKey: queryKeys.usageQuotaWindows(companyId),
    queryFn: () => costsApi.quotaWindows(companyId),
    enabled: !!selectedCompanyId && mainTab === "providers",
    refetchInterval: 300_000,
    staleTime: 60_000,
  });

  const byProvider = useMemo(() => {
    const map = new Map<string, CostByProviderModel[]>();
    for (const row of providerData ?? []) {
      const rows = map.get(row.provider) ?? [];
      rows.push(row);
      map.set(row.provider, rows);
    }
    return map;
  }, [providerData]);

  const byBiller = useMemo(() => {
    const map = new Map<string, CostByBiller[]>();
    for (const row of billerData ?? []) {
      const rows = map.get(row.biller) ?? [];
      rows.push(row);
      map.set(row.biller, rows);
    }
    return map;
  }, [billerData]);

  const weekSpendByProvider = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of weekData ?? []) {
      map.set(row.provider, (map.get(row.provider) ?? 0) + row.costCents);
    }
    return map;
  }, [weekData]);

  const weekSpendByBiller = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of weekBillerData ?? []) {
      map.set(row.biller, (map.get(row.biller) ?? 0) + row.costCents);
    }
    return map;
  }, [weekBillerData]);

  const windowSpendByProvider = useMemo(() => {
    const map = new Map<string, CostWindowSpendRow[]>();
    for (const row of windowData ?? []) {
      const rows = map.get(row.provider) ?? [];
      rows.push(row);
      map.set(row.provider, rows);
    }
    return map;
  }, [windowData]);

  const quotaWindowsByProvider = useMemo(() => {
    const map = new Map<string, QuotaWindow[]>();
    for (const result of quotaData ?? []) {
      if (result.ok && result.windows.length > 0) {
        map.set(result.provider, result.windows);
      }
    }
    return map;
  }, [quotaData]);

  const quotaErrorsByProvider = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of quotaData ?? []) {
      if (!result.ok && result.error) map.set(result.provider, result.error);
    }
    return map;
  }, [quotaData]);

  const quotaSourcesByProvider = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of quotaData ?? []) {
      if (typeof result.source === "string" && result.source.length > 0) {
        map.set(result.provider, result.source);
      }
    }
    return map;
  }, [quotaData]);

  const deficitNotchByProvider = useMemo(() => {
    const map = new Map<string, boolean>();
    if (preset !== "mtd") return map;
    const budget = spendData?.summary.budgetCents ?? 0;
    if (budget <= 0) return map;
    const totalSpend = spendData?.summary.spendCents ?? 0;
    const now = new Date();
    const daysElapsed = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (const [providerKey, rows] of byProvider) {
      const providerCostCents = rows.reduce((sum, row) => sum + row.costCents, 0);
      const providerShare = totalSpend > 0 ? providerCostCents / totalSpend : 0;
      const providerBudget = budget * providerShare;
      if (providerBudget <= 0) {
        map.set(providerKey, false);
        continue;
      }
      const burnRate = providerCostCents / Math.max(daysElapsed, 1);
      map.set(providerKey, providerCostCents + burnRate * (daysInMonth - daysElapsed) > providerBudget);
    }
    return map;
  }, [preset, spendData, byProvider]);

  const providers = useMemo(() => Array.from(byProvider.keys()), [byProvider]);
  const billers = useMemo(() => Array.from(byBiller.keys()), [byBiller]);

  const effectiveProvider =
    activeProvider === "all" || providers.includes(activeProvider) ? activeProvider : "all";
  useEffect(() => {
    if (effectiveProvider !== activeProvider) setActiveProvider("all");
  }, [effectiveProvider, activeProvider]);

  const effectiveBiller =
    activeBiller === "all" || billers.includes(activeBiller) ? activeBiller : "all";
  useEffect(() => {
    if (effectiveBiller !== activeBiller) setActiveBiller("all");
  }, [effectiveBiller, activeBiller]);

  const providerTabItems = useMemo(() => {
    const providerKeys = Array.from(byProvider.keys());
    const allTokens = providerKeys.reduce(
      (sum, provider) => sum + (byProvider.get(provider)?.reduce((acc, row) => acc + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0) ?? 0),
      0,
    );
    const allCents = providerKeys.reduce(
      (sum, provider) => sum + (byProvider.get(provider)?.reduce((acc, row) => acc + row.costCents, 0) ?? 0),
      0,
    );
    return [
      {
        value: "all",
        label: (
          <span className="flex items-center gap-1.5">
            <span>All providers</span>
            {providerKeys.length > 0 ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">{formatTokens(allTokens)}</span>
                <span className="text-xs text-muted-foreground">{formatCents(allCents)}</span>
              </>
            ) : null}
          </span>
        ),
      },
      ...providerKeys.map((provider) => ({
        value: provider,
        label: <ProviderTabLabel provider={provider} rows={byProvider.get(provider) ?? []} />,
      })),
    ];
  }, [byProvider]);

  const billerTabItems = useMemo(() => {
    const billerKeys = Array.from(byBiller.keys());
    const allTokens = billerKeys.reduce(
      (sum, biller) => sum + (byBiller.get(biller)?.reduce((acc, row) => acc + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0) ?? 0),
      0,
    );
    const allCents = billerKeys.reduce(
      (sum, biller) => sum + (byBiller.get(biller)?.reduce((acc, row) => acc + row.costCents, 0) ?? 0),
      0,
    );
    return [
      {
        value: "all",
        label: (
          <span className="flex items-center gap-1.5">
            <span>All billers</span>
            {billerKeys.length > 0 ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">{formatTokens(allTokens)}</span>
                <span className="text-xs text-muted-foreground">{formatCents(allCents)}</span>
              </>
            ) : null}
          </span>
        ),
      },
      ...billerKeys.map((biller) => ({
        value: biller,
        label: <BillerTabLabel biller={biller} rows={byBiller.get(biller) ?? []} />,
      })),
    ];
  }, [byBiller]);

  const inferenceTokenTotal =
    (spendData?.byAgent ?? []).reduce(
      (sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens,
      0,
    );

  const effectiveSimulatedCostCents = useMemo<number>(() => {
    if ((spendData?.summary.simulatedCostCents ?? 0) > 0) {
      return spendData!.summary.simulatedCostCents ?? 0;
    }
    const fromByAgent = (spendData?.byAgent ?? []).reduce(
      (sum, row) => sum + (row.simulatedCostCents ?? 0),
      0,
    );
    if (fromByAgent > 0) return fromByAgent;

    const fromByAgentModel = (spendData?.byAgentModel ?? []).reduce(
      (sum, row) => sum + (row.simulatedCostCents ?? 0),
      0,
    );
    if (fromByAgentModel > 0) return fromByAgentModel;

    if (inferenceTokenTotal > 0) {
      // Standard Claude Sonnet simulation (~$3/M input, $15/M output -> avg ~$5/M = 0.0005 cents/token)
      return Math.max(1, Math.round((inferenceTokenTotal / 1_000_000) * 5.0 * 100));
    }
    return 0;
  }, [spendData, inferenceTokenTotal]);

  const billedSpendCents = spendData?.summary.spendCents ?? 0;
  const isSubscriptionOnly = billedSpendCents === 0 && effectiveSimulatedCostCents > 0;

  const [viewModeOverride, setViewModeOverride] = useState<"client" | "operator" | null>(null);
  const [addBudgetOpen, setAddBudgetOpen] = useState<boolean>(false);
  const [addBudgetScopeType, setAddBudgetScopeType] = useState<BudgetScopeType>("company");

  const isCompanyHideInternal = Boolean(spendData?.summary.hideInternalCostFromClient);
  const hideInternal = viewModeOverride !== null
    ? viewModeOverride === "client"
    : isCompanyHideInternal;

  const updateCompanyDefaultMutation = useMutation({
    mutationFn: (hideInternalCostFromClient: boolean) =>
      companiesApi.update(selectedCompanyId!, { hideInternalCostFromClient }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: ["costs", selectedCompanyId!] });
    },
  });

  const effectiveBillableCents = useMemo<number>(() => {
    if ((spendData?.summary.billableCents ?? 0) > 0) {
      return spendData!.summary.billableCents ?? 0;
    }
    const fromByAgent = (spendData?.byAgent ?? []).reduce(
      (sum, row) => sum + (row.billableCents ?? 0),
      0,
    );
    if (fromByAgent > 0) return fromByAgent;
    return effectiveSimulatedCostCents > 0 ? effectiveSimulatedCostCents : billedSpendCents;
  }, [spendData, effectiveSimulatedCostCents, billedSpendCents]);

  const effectiveMarginCents = useMemo<number>(() => {
    if ((spendData?.summary.marginCents ?? 0) !== 0) {
      return spendData!.summary.marginCents ?? 0;
    }
    return effectiveBillableCents - billedSpendCents;
  }, [spendData, effectiveBillableCents, billedSpendCents]);

  const topFinanceEvents = (financeData?.events ?? []) as FinanceEvent[];
  const budgetPolicies = budgetData?.policies ?? [];
  const activeBudgetIncidents = budgetData?.activeIncidents ?? [];
  const budgetPoliciesByScope = useMemo(() => ({
    company: budgetPolicies.filter((policy) => policy.scopeType === "company"),
    agent: budgetPolicies.filter((policy) => policy.scopeType === "agent"),
    project: budgetPolicies.filter((policy) => policy.scopeType === "project"),
  }), [budgetPolicies]);

  const companyBudgetRows = useMemo<BudgetPolicySummary[]>(() => {
    if (budgetPoliciesByScope.company.length > 0) {
      return budgetPoliciesByScope.company;
    }
    const resolvedCompId = selectedCompanyId ?? "";
    const orgLimit = selectedCompany?.budgetMonthlyCents ?? spendData?.summary.budgetCents ?? 0;
    const orgSpend = spendData?.summary.spendCents ?? 0;
    return [{
      policyId: "",
      companyId: resolvedCompId,
      scopeType: "company",
      scopeId: resolvedCompId,
      scopeName: selectedCompany?.name ?? "Organization",
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: orgLimit,
      observedAmount: orgSpend,
      remainingAmount: Math.max(0, orgLimit - orgSpend),
      utilizationPercent: orgLimit > 0 ? Number(((orgSpend / orgLimit) * 100).toFixed(2)) : 0,
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: orgLimit > 0,
      status: orgLimit > 0 && orgSpend >= orgLimit ? "hard_stop" : "ok",
      paused: false,
      pauseReason: null,
      windowStart: new Date(),
      windowEnd: new Date(),
    }];
  }, [budgetPoliciesByScope.company, selectedCompany, spendData, selectedCompanyId]);

  if (!selectedCompanyId) {
    return <EmptyState icon={DollarSign} message="Select an organization to view costs." />;
  }

  const showCustomPrompt = preset === "custom" && !customReady;
  const showOverviewLoading = (spendLoading || financeLoading) && customReady;
  const overviewError = spendError ?? financeError;
  return (
    <div className="space-y-6">
      {showSummaryChrome ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                {embedded ? (
                  <h2 className="text-lg font-semibold text-foreground">Costs</h2>
                ) : (
                  <h1 className="text-3xl font-semibold tracking-tight">Costs</h1>
                )}
                <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-muted/40 text-xs">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer",
                      hideInternal ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setViewModeOverride("client")}
                  >
                    Client View
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer",
                      !hideInternal ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setViewModeOverride("operator")}
                  >
                    Operator View
                  </button>
                </div>
                {hideInternal !== isCompanyHideInternal && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={updateCompanyDefaultMutation.isPending}
                    onClick={() => updateCompanyDefaultMutation.mutate(hideInternal)}
                  >
                    {updateCompanyDefaultMutation.isPending ? "Saving..." : "Save as org default"}
                  </Button>
                )}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Inference spend, platform fees, credits, and live quota windows.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PRESET_KEYS.map((key) => (
                <Button
                  key={key}
                  variant={preset === key ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setPreset(key)}
                  aria-pressed={preset === key}
                >
                  {PRESET_LABELS[key]}
                </Button>
              ))}
            </div>
          </div>

          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 border border-border p-3">
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              />
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-4">
            {hideInternal ? (
              <>
                <MetricTile
                  label="Inference spend"
                  value={formatCents(effectiveBillableCents)}
                  subtitle={`${formatTokens(inferenceTokenTotal)} tokens across billable events`}
                  icon={DollarSign}
                />
                <MetricTile
                  label="Budget"
                  value={activeBudgetIncidents.length > 0 ? String(activeBudgetIncidents.length) : (
                    spendData?.summary.budgetCents && spendData.summary.budgetCents > 0
                      ? `${spendData.summary.utilizationPercent}%`
                      : "Open"
                  )}
                  subtitle={
                    activeBudgetIncidents.length > 0
                      ? `${budgetData?.pausedAgentCount ?? 0} agents paused · ${budgetData?.pausedProjectCount ?? 0} projects paused`
                      : spendData?.summary.budgetCents && spendData.summary.budgetCents > 0
                        ? `${formatCents(effectiveBillableCents)} of ${formatCents(spendData.summary.budgetCents)}`
                        : "No monthly cap configured"
                  }
                  icon={Coins}
                />
                <MetricTile
                  label="Finance net"
                  value={formatCents(financeData?.summary.netCents ?? 0)}
                  subtitle={`${formatCents(financeData?.summary.debitCents ?? 0)} debits · ${formatCents(financeData?.summary.creditCents ?? 0)} credits`}
                  icon={ReceiptText}
                />
                <MetricTile
                  label="Finance events"
                  value={String(financeData?.summary.eventCount ?? 0)}
                  subtitle={`${formatCents(financeData?.summary.estimatedDebitCents ?? 0)} estimated in range`}
                  icon={ArrowUpRight}
                />
              </>
            ) : (
              <>
                <MetricTile
                  label="Client billable"
                  value={formatCents(effectiveBillableCents)}
                  subtitle={`${formatTokens(inferenceTokenTotal)} tokens · Commercial value`}
                  icon={DollarSign}
                />
                <MetricTile
                  label="Net margin / spread"
                  value={`${effectiveMarginCents >= 0 ? "+" : ""}${formatCents(effectiveMarginCents)}`}
                  subtitle={
                    billedSpendCents === 0 && effectiveSimulatedCostCents > 0
                      ? "100% margin (subscription token spread)"
                      : "Commercial billable minus real API spend"
                  }
                  icon={ArrowUpRight}
                />
                <MetricTile
                  label="Real API spend"
                  value={formatCents(billedSpendCents)}
                  subtitle={
                    isSubscriptionOnly
                      ? "Subscription included ($0 marginal spend)"
                      : "Billed invoice cost across metered runs"
                  }
                  icon={ReceiptText}
                />
                <MetricTile
                  label="Simulated benchmark"
                  value={formatCents(effectiveSimulatedCostCents)}
                  subtitle="Standard market API token benchmark"
                  icon={Coins}
                />
              </>
            )}
          </div>
        </div>
      ) : null}

      <Tabs value={mainTab} onValueChange={(value) => setMainTab(value as typeof mainTab)}>
        {!lockTab ? (
          <TabsList variant="line" className="justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {!hideBudgetsTab ? <TabsTrigger value="budgets">Budgets</TabsTrigger> : null}
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="billers">Billers</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
          </TabsList>
        ) : null}

        <TabsContent value="overview" className="mt-4 space-y-4">
          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : showOverviewLoading ? (
            <PageSkeleton variant="costs" />
          ) : overviewError ? (
            <p className="text-sm text-destructive">{(overviewError as Error).message}</p>
          ) : (
            <>
              {activeBudgetIncidents.length > 0 ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {activeBudgetIncidents.slice(0, 2).map((incident) => (
                    <BudgetIncidentCard
                      key={incident.id}
                      incident={incident}
                      isMutating={incidentMutation.isPending}
                      onKeepPaused={() => incidentMutation.mutate({ incidentId: incident.id, action: "keep_paused" })}
                      onRaiseAndResume={(amount) =>
                        incidentMutation.mutate({
                          incidentId: incident.id,
                          action: "raise_budget_and_resume",
                          amount,
                        })}
                    />
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-(--gtc-31)">
                <Card>
                  <CardHeader className="px-5 pt-5 pb-2">
                    <CardTitle className="text-base">Inference ledger</CardTitle>
                    <CardDescription>
                      Request-scoped inference spend for the selected period.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 px-5 pb-5 pt-2">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <div className="text-3xl font-semibold tabular-nums">
                          {hideInternal
                            ? formatCents(effectiveBillableCents)
                            : formatCents(effectiveBillableCents > 0 ? effectiveBillableCents : billedSpendCents)}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {hideInternal ? (
                            spendData?.summary.budgetCents && spendData.summary.budgetCents > 0
                              ? `Budget ${formatCents(spendData.summary.budgetCents)}`
                              : "Unlimited budget"
                          ) : (
                            `Real API spend: ${formatCents(billedSpendCents)} · Margin: ${effectiveMarginCents >= 0 ? "+" : ""}${formatCents(effectiveMarginCents)}`
                          )}
                        </div>
                      </div>
                      <div className="border border-border px-4 py-3 text-right">
                        <div className="text-(length:--text-micro) uppercase tracking-(--tracking-eyebrow) text-muted-foreground">usage</div>
                        <div className="mt-1 text-lg font-medium tabular-nums">
                          {formatTokens(inferenceTokenTotal)}
                        </div>
                        {!hideInternal && effectiveSimulatedCostCents > 0 ? (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Benchmark: {formatCents(effectiveSimulatedCostCents)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {spendData?.summary.budgetCents && spendData.summary.budgetCents > 0 ? (
                      <div className="space-y-2">
                        <div className="h-2 overflow-hidden bg-muted">
                          <div
                            className={cn(
                              "h-full transition-(--tp-width-background-color) duration-150",
                              spendData.summary.utilizationPercent > 90
                                ? "bg-(--status-task-blocked)"
                                : spendData.summary.utilizationPercent > 70
                                  ? "bg-(--status-task-todo)"
                                  : "bg-(--status-task-done)",
                            )}
                            style={{ width: `${Math.min(100, spendData.summary.utilizationPercent)}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {spendData.summary.utilizationPercent}% of monthly budget consumed in this range.
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <FinanceSummaryCard
                  debitCents={financeData?.summary.debitCents ?? 0}
                  creditCents={financeData?.summary.creditCents ?? 0}
                  netCents={financeData?.summary.netCents ?? 0}
                  estimatedDebitCents={financeData?.summary.estimatedDebitCents ?? 0}
                  eventCount={financeData?.summary.eventCount ?? 0}
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-(--gtc-32)">
                <Card>
                  <CardHeader className="px-5 pt-5 pb-2">
                    <CardTitle className="text-base">By agent</CardTitle>
                    <CardDescription>What each agent consumed in the selected period.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 px-5 pb-5 pt-2">
                    {(spendData?.byAgent.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">No cost events yet.</p>
                    ) : (
                      spendData?.byAgent.map((row) => {
                        const modelRows = agentModelRows.get(row.agentId) ?? [];
                        const isExpanded = expandedAgents.has(row.agentId);
                        const hasBreakdown = modelRows.length > 0;
                        return (
                          <div key={row.agentId} className="border border-border px-4 py-3">
                            <div
                              className={cn("flex items-start justify-between gap-3", hasBreakdown ? "cursor-pointer select-none" : "")}
                              onClick={() => hasBreakdown && toggleAgent(row.agentId)}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {hasBreakdown ? (
                                  isExpanded
                                    ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                ) : (
                                  <span className="h-3 w-3 shrink-0" />
                                )}
                                <Identity name={row.agentName ?? row.agentId} size="sm" />
                                {row.agentStatus === "terminated" ? <StatusBadge status="terminated" /> : null}
                              </div>
                              <div className="text-right text-sm tabular-nums">
                                <div className="font-medium">
                                  {formatCents(
                                    (row.billableCents ?? 0) > 0
                                      ? row.billableCents!
                                      : row.costCents > 0
                                        ? row.costCents
                                        : row.simulatedCostCents ?? 0,
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  in {formatTokens(row.inputTokens + row.cachedInputTokens)} · out {formatTokens(row.outputTokens)}
                                </div>
                                {hideInternal ? (
                                  <div className="text-xs text-muted-foreground">
                                    {row.apiRunCount + row.subscriptionRunCount} runs
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">
                                    {row.costCents > 0 ? `API cost: ${formatCents(row.costCents)}` : "API cost: $0.00"}
                                    {" · "}
                                    {row.apiRunCount + row.subscriptionRunCount} runs
                                    {row.subscriptionRunCount > 0 ? ` (${row.subscriptionRunCount} byok)` : ""}
                                  </div>
                                )}
                              </div>
                            </div>

                            {isExpanded && modelRows.length > 0 ? (
                              <div className="mt-3 space-y-2 border-l border-border pl-4">
                                {modelRows.map((modelRow) => {
                                  const sharePct = row.costCents > 0 ? Math.round((modelRow.costCents / row.costCents) * 100) : 0;
                                  return (
                                    <div
                                      key={`${modelRow.provider}:${modelRow.model}:${modelRow.billingType}`}
                                      className="flex items-start justify-between gap-3 text-xs"
                                    >
                                      <div className="min-w-0">
                                        <div className="truncate font-medium text-foreground">
                                          {providerDisplayName(modelRow.provider)}
                                          <span className="mx-1 text-border">/</span>
                                          <span className="font-mono">{modelRow.model}</span>
                                        </div>
                                        <div className="truncate text-muted-foreground">
                                          {providerDisplayName(modelRow.biller)} · {billingTypeDisplayName(modelRow.billingType)}
                                        </div>
                                      </div>
                                      <div className="text-right tabular-nums">
                                        <div className="font-medium">
                                          {formatCents(
                                            (modelRow.billableCents ?? 0) > 0
                                              ? modelRow.billableCents!
                                              : modelRow.costCents > 0
                                                ? modelRow.costCents
                                                : modelRow.simulatedCostCents ?? 0,
                                          )}
                                          {!hideInternal && modelRow.costCents > 0 ? (
                                            <span className="ml-1 font-normal text-muted-foreground">({sharePct}%)</span>
                                          ) : null}
                                        </div>
                                        <div className="text-muted-foreground">
                                          {formatTokens(modelRow.inputTokens + modelRow.cachedInputTokens + modelRow.outputTokens)} tok
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <CardHeader className="px-5 pt-5 pb-2">
                      <CardTitle className="text-base">By project</CardTitle>
                      <CardDescription>Run costs attributed through project-linked tasks.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 px-5 pb-5 pt-2">
                      {(spendData?.byProject.length ?? 0) === 0 ? (
                        <p className="text-sm text-muted-foreground">No project-attributed run costs yet.</p>
                      ) : (
                        spendData?.byProject.map((row, index) => (
                          <div
                            key={row.projectId ?? `unattributed-${index}`}
                            className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-sm"
                          >
                            <span className="truncate">{row.projectName ?? row.projectId ?? "Unattributed"}</span>
                            <span className="font-medium tabular-nums">
                              {formatCents(hideInternal ? (row.billableCents ?? row.costCents) : row.costCents)}
                            </span>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <FinanceTimelineCard rows={topFinanceEvents.slice(0, 6)} emptyMessage="No finance events yet. Add account-level charges once biller invoices or credits land." />
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="budgets" className="mt-4 space-y-4">
          {budgetLoading ? (
            <PageSkeleton variant="costs" />
          ) : budgetError ? (
            <p className="text-sm text-destructive">{(budgetError as Error).message}</p>
          ) : (
            <>
              <Card className="border-border/70 bg-(image:--gradient-extract-2)">
                <CardHeader className="flex flex-row items-start justify-between px-5 pt-5 pb-3">
                  <div>
                    <CardTitle className="text-base">Budget control plane</CardTitle>
                    <CardDescription>
                      Hard-stop spend limits for agents and projects. Provider subscription quota stays separate and appears under Providers.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setAddBudgetScopeType("company");
                      setAddBudgetOpen(true);
                    }}
                    className="gap-1.5 shrink-0"
                  >
                    <Plus className="h-4 w-4" /> Set Budget
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-3 px-5 pb-5 pt-0 md:grid-cols-4">
                  <MetricTile
                    label="Active incidents"
                    value={String(activeBudgetIncidents.length)}
                    subtitle="Open soft or hard threshold crossings"
                    icon={ReceiptText}
                  />
                  <MetricTile
                    label="Pending approvals"
                    value={String(budgetData?.pendingApprovalCount ?? 0)}
                    subtitle="Budget override approvals awaiting board action"
                    icon={ArrowUpRight}
                  />
                  <MetricTile
                    label="Paused agents"
                    value={String(budgetData?.pausedAgentCount ?? 0)}
                    subtitle="Agent heartbeats blocked by budget"
                    icon={Coins}
                  />
                  <MetricTile
                    label="Paused projects"
                    value={String(budgetData?.pausedProjectCount ?? 0)}
                    subtitle="Project execution blocked by budget"
                    icon={DollarSign}
                  />
                </CardContent>
              </Card>

              {activeBudgetIncidents.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold">Active incidents</h2>
                    <p className="text-sm text-muted-foreground">
                      Resolve hard stops here by raising the budget or explicitly keeping the scope paused.
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {activeBudgetIncidents.map((incident) => (
                      <BudgetIncidentCard
                        key={incident.id}
                        incident={incident}
                        isMutating={incidentMutation.isPending}
                        onKeepPaused={() => incidentMutation.mutate({ incidentId: incident.id, action: "keep_paused" })}
                        onRaiseAndResume={(amount) =>
                          incidentMutation.mutate({
                            incidentId: incident.id,
                            action: "raise_budget_and_resume",
                            amount,
                          })}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-6">
                {/* Organization Budgets */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Organization budget</h2>
                      <p className="text-sm text-muted-foreground">Organization-wide monthly policy.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {companyBudgetRows.map((summary) => (
                      <BudgetPolicyCard
                        key={summary.policyId || "org-budget-policy"}
                        summary={summary}
                        isSaving={policyMutation.isPending}
                        onSave={(amount) =>
                          policyMutation.mutate({
                            scopeType: "company",
                            scopeId: selectedCompanyId,
                            amount,
                            windowKind: "calendar_month_utc",
                          })}
                      />
                    ))}
                  </div>
                </section>

                {/* Agent Budgets */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Agent budgets</h2>
                      <p className="text-sm text-muted-foreground">Recurring monthly spend policies for individual agents.</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddBudgetScopeType("agent");
                        setAddBudgetOpen(true);
                      }}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" /> Add Agent Budget
                    </Button>
                  </div>
                  {budgetPoliciesByScope.agent.length === 0 ? (
                    <Card>
                      <CardContent className="flex flex-col items-center justify-center p-6 text-center">
                        <p className="text-sm text-muted-foreground mb-3">No individual agent budget caps configured.</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setAddBudgetScopeType("agent");
                            setAddBudgetOpen(true);
                          }}
                          className="gap-1.5"
                        >
                          <Plus className="h-4 w-4" /> Set an agent budget limit
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {budgetPoliciesByScope.agent.map((summary) => (
                        <BudgetPolicyCard
                          key={summary.policyId}
                          summary={summary}
                          isSaving={policyMutation.isPending}
                          onSave={(amount) =>
                            policyMutation.mutate({
                              scopeType: "agent",
                              scopeId: summary.scopeId,
                              amount,
                              windowKind: summary.windowKind,
                            })}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* Project Budgets */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Project budgets</h2>
                      <p className="text-sm text-muted-foreground">Lifetime spend policies for execution-bound projects.</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddBudgetScopeType("project");
                        setAddBudgetOpen(true);
                      }}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" /> Add Project Budget
                    </Button>
                  </div>
                  {budgetPoliciesByScope.project.length === 0 ? (
                    <Card>
                      <CardContent className="flex flex-col items-center justify-center p-6 text-center">
                        <p className="text-sm text-muted-foreground mb-3">No project spend caps configured.</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setAddBudgetScopeType("project");
                            setAddBudgetOpen(true);
                          }}
                          className="gap-1.5"
                        >
                          <Plus className="h-4 w-4" /> Set a project budget limit
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {budgetPoliciesByScope.project.map((summary) => (
                        <BudgetPolicyCard
                          key={summary.policyId}
                          summary={summary}
                          isSaving={policyMutation.isPending}
                          onSave={(amount) =>
                            policyMutation.mutate({
                              scopeType: "project",
                              scopeId: summary.scopeId,
                              amount,
                              windowKind: summary.windowKind,
                            })}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="providers" className="mt-4 space-y-4">
          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : (
            <>
              <Tabs value={effectiveProvider} onValueChange={setActiveProvider}>
                <PageTabBar items={providerTabItems} value={effectiveProvider} />

                <TabsContent value="all" className="mt-4">
                  {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No cost events in this period.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {providers.map((provider) => (
                        <ProviderQuotaCard
                          key={provider}
                          provider={provider}
                          rows={byProvider.get(provider) ?? []}
                          budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                          totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                          weekSpendCents={weekSpendByProvider.get(provider) ?? 0}
                          windowRows={windowSpendByProvider.get(provider) ?? []}
                          showDeficitNotch={deficitNotchByProvider.get(provider) ?? false}
                          quotaWindows={quotaWindowsByProvider.get(provider) ?? []}
                          quotaError={quotaErrorsByProvider.get(provider) ?? null}
                          quotaSource={quotaSourcesByProvider.get(provider) ?? null}
                          quotaLoading={quotaLoading}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>

                {providers.map((provider) => (
                  <TabsContent key={provider} value={provider} className="mt-4">
                    <ProviderQuotaCard
                      provider={provider}
                      rows={byProvider.get(provider) ?? []}
                      budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                      totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                      weekSpendCents={weekSpendByProvider.get(provider) ?? 0}
                      windowRows={windowSpendByProvider.get(provider) ?? []}
                      showDeficitNotch={deficitNotchByProvider.get(provider) ?? false}
                      quotaWindows={quotaWindowsByProvider.get(provider) ?? []}
                      quotaError={quotaErrorsByProvider.get(provider) ?? null}
                      quotaSource={quotaSourcesByProvider.get(provider) ?? null}
                      quotaLoading={quotaLoading}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </>
          )}
        </TabsContent>

        <TabsContent value="billers" className="mt-4 space-y-4">
          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : (
            <>
              <Tabs value={effectiveBiller} onValueChange={setActiveBiller}>
                <PageTabBar items={billerTabItems} value={effectiveBiller} />

                <TabsContent value="all" className="mt-4">
                  {billers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No billable events in this period.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {billers.map((biller) => {
                        const row = (byBiller.get(biller) ?? [])[0];
                        if (!row) return null;
                        const providerRows = (providerData ?? []).filter((entry) => entry.biller === biller);
                        return (
                          <BillerSpendCard
                            key={biller}
                            row={row}
                            weekSpendCents={weekSpendByBiller.get(biller) ?? 0}
                            budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                            totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                            providerRows={providerRows}
                          />
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                {billers.map((biller) => {
                  const row = (byBiller.get(biller) ?? [])[0];
                  if (!row) return null;
                  const providerRows = (providerData ?? []).filter((entry) => entry.biller === biller);
                  return (
                    <TabsContent key={biller} value={biller} className="mt-4">
                      <BillerSpendCard
                        row={row}
                        weekSpendCents={weekSpendByBiller.get(biller) ?? 0}
                        budgetMonthlyCents={spendData?.summary.budgetCents ?? 0}
                        totalCompanySpendCents={spendData?.summary.spendCents ?? 0}
                        providerRows={providerRows}
                      />
                    </TabsContent>
                  );
                })}
              </Tabs>
            </>
          )}
        </TabsContent>

        <TabsContent value="finance" className="mt-4 space-y-4">
          {showCustomPrompt ? (
            <p className="text-sm text-muted-foreground">Select a start and end date to load data.</p>
          ) : financeLoading ? (
            <PageSkeleton variant="costs" />
          ) : financeError ? (
            <p className="text-sm text-destructive">{(financeError as Error).message}</p>
          ) : (
            <>
              <FinanceSummaryCard
                debitCents={financeData?.summary.debitCents ?? 0}
                creditCents={financeData?.summary.creditCents ?? 0}
                netCents={financeData?.summary.netCents ?? 0}
                estimatedDebitCents={financeData?.summary.estimatedDebitCents ?? 0}
                eventCount={financeData?.summary.eventCount ?? 0}
              />

              <div className="grid gap-4 xl:grid-cols-(--gtc-33)">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="px-5 pt-5 pb-2">
                      <CardTitle className="text-base">By biller</CardTitle>
                      <CardDescription>Account-level financial events grouped by who charged or credited them.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 px-5 pb-5 pt-2 md:grid-cols-2">
                      {(financeData?.byBiller.length ?? 0) === 0 ? (
                        <p className="text-sm text-muted-foreground">No finance events yet.</p>
                      ) : (
                        financeData?.byBiller.map((row) => <FinanceBillerCard key={row.biller} row={row} />)
                      )}
                    </CardContent>
                  </Card>
                  <FinanceTimelineCard rows={topFinanceEvents} />
                </div>

                <FinanceKindCard rows={financeData?.byKind ?? []} />
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <AddBudgetModal
        open={addBudgetOpen}
        onOpenChange={setAddBudgetOpen}
        companyId={selectedCompanyId}
        companyName={selectedCompany?.name ?? "Organization"}
        initialScopeType={addBudgetScopeType}
      />
    </div>
  );
}
