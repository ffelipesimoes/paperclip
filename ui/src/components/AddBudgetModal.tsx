import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BudgetScopeType, BudgetWindowKind } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { budgetsApi } from "../api/budgets";
import { queryKeys } from "../lib/queryKeys";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, ShieldAlert } from "lucide-react";

export function AddBudgetModal({
  open,
  onOpenChange,
  companyId,
  companyName = "Organization",
  initialScopeType = "company",
  initialScopeId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName?: string;
  initialScopeType?: BudgetScopeType;
  initialScopeId?: string;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [scopeType, setScopeType] = useState<BudgetScopeType>(initialScopeType);
  const [scopeId, setScopeId] = useState<string>(initialScopeId ?? companyId);
  const [amountInput, setAmountInput] = useState<string>("50.00");
  const [windowKind, setWindowKind] = useState<BudgetWindowKind>("calendar_month_utc");
  const [warnPercent, setWarnPercent] = useState<number>(80);
  const [hardStopEnabled, setHardStopEnabled] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: open && Boolean(companyId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: queryKeys.projects.all(companyId),
    queryFn: () => projectsApi.list(companyId),
    enabled: open && Boolean(companyId),
  });

  useEffect(() => {
    if (!open) return;
    setScopeType(initialScopeType);
    setFormError(null);
    if (initialScopeType === "company") {
      setScopeId(companyId);
      setWindowKind("calendar_month_utc");
    } else if (initialScopeType === "agent") {
      setScopeId(initialScopeId ?? (agents[0]?.id || ""));
      setWindowKind("calendar_month_utc");
    } else if (initialScopeType === "project") {
      setScopeId(initialScopeId ?? (projects[0]?.id || ""));
      setWindowKind("lifetime");
    }
  }, [open, initialScopeType, initialScopeId, companyId, agents, projects]);

  const handleScopeTypeChange = (newType: BudgetScopeType) => {
    setScopeType(newType);
    if (newType === "company") {
      setScopeId(companyId);
      setWindowKind("calendar_month_utc");
    } else if (newType === "agent") {
      setScopeId(agents[0]?.id || "");
      setWindowKind("calendar_month_utc");
    } else if (newType === "project") {
      setScopeId(projects[0]?.id || "");
      setWindowKind("lifetime");
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = Number(amountInput.trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("Please enter a valid non-negative dollar amount.");
      }
      if (!scopeId) {
        throw new Error("Please select a target for this budget.");
      }
      const amountCents = Math.round(parsed * 100);

      return budgetsApi.upsertPolicy(companyId, {
        scopeType,
        scopeId,
        amount: amountCents,
        windowKind,
        warnPercent,
        hardStopEnabled,
        notifyEnabled: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.overview(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
      if (scopeType === "agent") {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(scopeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      } else if (scopeType === "project") {
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(scopeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(companyId) });
      }
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to create budget policy");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Set Budget Policy
          </DialogTitle>
          <DialogDescription>
            Configure hard-stop spend limits and alerts for your organization, agents, or projects.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Scope Type Selection */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Scope</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["company", "agent", "project"] as const).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={scopeType === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleScopeTypeChange(type)}
                  className="capitalize"
                >
                  {type === "company" ? "Organization" : type}
                </Button>
              ))}
            </div>
          </div>

          {/* Scope Target Selection */}
          {scopeType === "company" ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Target: </span>
              <span className="font-semibold text-foreground">{companyName}</span>
            </div>
          ) : scopeType === "agent" ? (
            <div className="space-y-2">
              <Label htmlFor="budget-agent-select">Agent</Label>
              {agents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No agents found in this organization.</p>
              ) : (
                <select
                  id="budget-agent-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.role})
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="budget-project-select">Project</Label>
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground">No projects found in this organization.</p>
              ) : (
                <select
                  id="budget-project-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Budget Limit Amount */}
          <div className="space-y-2">
            <Label htmlFor="budget-amount-input">Spend Limit (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-muted-foreground">$</span>
              <Input
                id="budget-amount-input"
                type="number"
                min="0"
                step="1"
                placeholder="50.00"
                className="pl-7 font-mono"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              When spend reaches this limit, executions are blocked until the budget is increased.
            </p>
          </div>

          {/* Budget Window */}
          <div className="space-y-2">
            <Label htmlFor="budget-window-select">Budget Window</Label>
            <select
              id="budget-window-select"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
              value={windowKind}
              onChange={(e) => setWindowKind(e.target.value as BudgetWindowKind)}
            >
              <option value="calendar_month_utc">Monthly (resets 1st of each month UTC)</option>
              <option value="lifetime">Lifetime (continuous cumulative cap)</option>
            </select>
          </div>

          {/* Warn & Hard stop */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground">Soft Alert Threshold</div>
              <div className="text-xs text-muted-foreground">Notify when utilization hits {warnPercent}%</div>
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min="10"
                max="99"
                className="w-18 text-center"
                value={warnPercent}
                onChange={(e) => setWarnPercent(Math.max(10, Math.min(99, Number(e.target.value))))}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                Hard Stop Enforced
              </div>
              <div className="text-xs text-muted-foreground">Pause heartbeat runs when limit is reached</div>
            </div>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={hardStopEnabled}
              onChange={(e) => setHardStopEnabled(e.target.checked)}
            />
          </div>

          {formError && <p className="text-xs text-destructive">{formError}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !scopeId}>
            {saveMutation.isPending ? "Saving..." : "Save Budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
