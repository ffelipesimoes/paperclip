import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, formatDurationMs, formatTokens, relativeTime } from "../lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { Company } from "@paperclipai/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Pencil,
  Check,
  X,
  Plus,
  MoreHorizontal,
  Trash2,
  Users,
  CircleDot,
  DollarSign,
  Calendar,
  ArchiveRestore,
  Activity,
  Cpu,
  Zap,
  Settings2,
} from "lucide-react";

export function Companies() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    loading,
    error,
  } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  // A cloud stack holds exactly one company; creating another is a 403 floor
  // server-side, so the wizard entry point is hidden rather than dead-ending.
  const isCloud = Boolean(useCloudInstance());

  const { data: stats } = useQuery({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
  });

  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
  });
  const isInstanceAdmin =
    Boolean(boardAccess?.isInstanceAdmin) ||
    boardAccess?.source === "local_implicit";

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dialogCompany, setDialogCompany] = useState<Company | null>(null);

  const editMutation = useMutation({
    mutationFn: ({ id, newName }: { id: string; newName: string }) =>
      companiesApi.update(id, { name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setEditingId(null);
    },
  });

  const fullEditMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof companiesApi.update>[1];
    }) => companiesApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
      setDialogCompany(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => companiesApi.remove(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
      setConfirmDeleteId(null);
      if (selectedCompanyId === deletedId) {
        const remaining = companies.filter((c) => c.id !== deletedId);
        setSelectedCompanyId(remaining[0]?.id ?? null);
      }
    },
  });

  // Unarchiving previously had no UI at all: archiving happens in company
  // settings, but an archived company disappears from the sidebar switcher,
  // so its settings page — and with it any way back — was only reachable by
  // hand-typed URL. This list is the one place that still shows archived
  // companies, so restoration lives here.
  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => companiesApi.update(id, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Organizations" }]);
  }, [setBreadcrumbs]);

  function startEdit(companyId: string, currentName: string) {
    setEditingId(companyId);
    setEditName(currentName);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    editMutation.mutate({ id: editingId, newName: editName.trim() });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        {isInstanceAdmin ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/company/settings/instance/observability">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Instance Observability
            </Link>
          </Button>
        ) : null}
        {isCloud ? null : (
          <Button size="sm" onClick={() => openOnboarding()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Organization
          </Button>
        )}
      </div>

      <div className="h-6">
        {loading && <p className="text-sm text-muted-foreground">Loading organizations...</p>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
      </div>

      <div className="grid gap-4">
        {companies.map((company) => {
          const selected = company.id === selectedCompanyId;
          const isEditing = editingId === company.id;
          const isConfirmingDelete = confirmDeleteId === company.id;
          const companyStats = stats?.[company.id];
          const agentCount = companyStats?.agentCount ?? 0;
          const issueCount = companyStats?.issueCount ?? 0;
          const budgetPct =
            company.budgetMonthlyCents > 0
              ? Math.round(
                  (company.spentMonthlyCents / company.budgetMonthlyCents) * 100,
                )
              : 0;

          return (
            <Card
              key={company.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedCompanyId(company.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedCompanyId(company.id);
                }
              }}
              interactive
              className={`block group text-left p-5 ${
                selected ? "border-primary ring-1 ring-primary hover:border-primary" : ""
              }`}
            >
              {/* Header row: name + menu */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={saveEdit}
                        disabled={editMutation.isPending}
                      >
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base">{company.name}</h3>
                      <Badge variant="ghost"
                        className={`text-(length:--text-micro) ${
                          company.status === "active"
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : company.status === "paused"
                              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {company.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(company.id, company.name);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {company.description && !isEditing && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {company.description}
                    </p>
                  )}
                </div>

                {/* Three-dot menu */}
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setDialogCompany(company)}
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        Edit Organization
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => startEdit(company.id, company.name)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      {company.status === "archived" && (
                        <DropdownMenuItem
                          disabled={unarchiveMutation.isPending}
                          onClick={() => unarchiveMutation.mutate(company.id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Unarchive
                        </DropdownMenuItem>
                      )}
                      {isInstanceAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setConfirmDeleteId(company.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete Organization
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 sm:gap-5 mt-4 text-sm text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  <span>
                    {agentCount} {agentCount === 1 ? "agent" : "agents"}
                    {(companyStats?.activeAgentCount ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({companyStats?.activeAgentCount} active)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CircleDot className="h-3.5 w-3.5" />
                  <span>
                    {issueCount} {issueCount === 1 ? "task" : "tasks"}
                  </span>
                </div>
                {(companyStats?.runCount ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" />
                    <span>
                      {companyStats?.runCount} {companyStats?.runCount === 1 ? "run" : "runs"}
                      {(companyStats?.activeRunCount ?? 0) > 0 && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium ml-1">
                          ({companyStats?.activeRunCount} active)
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {(companyStats?.runtimeMs ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>{formatDurationMs(companyStats?.runtimeMs ?? 0)} compute</span>
                  </div>
                )}
                {(companyStats?.totalTokens ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    <span>{formatTokens(companyStats?.totalTokens ?? 0)} tok</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 tabular-nums">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>
                    {formatCents(
                      company.spentMonthlyCents > 0
                        ? company.spentMonthlyCents
                        : (companyStats?.simulatedCostCents ?? 0),
                    )}
                    {company.budgetMonthlyCents > 0
                      ? <> / {formatCents(company.budgetMonthlyCents)} <span className="text-xs">({budgetPct}%)</span></>
                      : <span className="text-xs ml-1">Unlimited budget</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created {relativeTime(company.createdAt)}</span>
                </div>
              </div>

              {/* Delete confirmation */}
              {isConfirmingDelete && (
                <div
                  className="mt-4 flex items-center justify-between bg-destructive/5 border border-destructive/20 rounded-md px-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm text-destructive font-medium">
                    Delete this organization and all its data? This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(company.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <EditCompanyModal
        company={dialogCompany}
        open={Boolean(dialogCompany)}
        onOpenChange={(open) => {
          if (!open) setDialogCompany(null);
        }}
        onSave={({ name, description, status, budgetMonthlyCents }) => {
          if (!dialogCompany) return;
          fullEditMutation.mutate({
            id: dialogCompany.id,
            payload: { name, description, status, budgetMonthlyCents },
          });
        }}
        isPending={fullEditMutation.isPending}
        error={fullEditMutation.error instanceof Error ? fullEditMutation.error : null}
      />
    </div>
  );
}

function EditCompanyModal({
  company,
  open,
  onOpenChange,
  onSave,
  isPending,
  error,
}: {
  company: Company | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: {
    name: string;
    description: string | null;
    status: "active" | "paused" | "archived";
    budgetMonthlyCents: number;
  }) => void;
  isPending: boolean;
  error?: Error | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "archived">("active");
  const [budgetDollars, setBudgetDollars] = useState("");

  useEffect(() => {
    if (company) {
      setName(company.name ?? "");
      setDescription(company.description ?? "");
      setStatus(company.status as "active" | "paused" | "archived");
      setBudgetDollars(company.budgetMonthlyCents > 0 ? (company.budgetMonthlyCents / 100).toFixed(2) : "");
    }
  }, [company]);

  if (!company) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const parsedBudget = parseFloat(budgetDollars);
    const budgetMonthlyCents = isNaN(parsedBudget) || parsedBudget < 0 ? 0 : Math.round(parsedBudget * 100);
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      status,
      budgetMonthlyCents,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update organization settings for {company.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Organization name"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "paused" | "archived")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Monthly Budget ($)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unlimited (0.00)"
                value={budgetDollars}
                onChange={(e) => setBudgetDollars(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-xs text-destructive">{error.message}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
