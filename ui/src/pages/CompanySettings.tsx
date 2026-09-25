import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type InteractionResolverGovernance,
  type IssueThreadInteractionKind,
  type BillingPricingMode,
} from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { companiesApi } from "../api/companies";
import { assetsApi } from "../api/assets";
import { budgetsApi } from "../api/budgets";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import {
  InteractionGovernancePanel,
  applyGovernanceChange,
  type GovernanceField,
  type GovernanceSelectValue,
} from "../components/InteractionGovernancePanel";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  Field,
  ToggleField,
} from "../components/agent-config-primitives";
import { InstanceGeneralSettings } from "./InstanceGeneralSettings";

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
  });
  const isInstanceAdmin =
    Boolean(boardAccess?.isInstanceAdmin) ||
    boardAccess?.source === "local_implicit";
  // Managed instances derive the task ID prefix from the company name, so a
  // rename here also renumbers the existing task IDs.
  const isCloudManaged = Boolean(useCloudInstance());
  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [budgetMonthly, setBudgetMonthly] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<InteractionResolverGovernance>({});

  // Client billing & monetization local state
  const [billingPricingMode, setBillingPricingMode] = useState<BillingPricingMode>("passthrough");
  const [billingMarkupPercent, setBillingMarkupPercent] = useState<number>(0);
  const [billingByokFeePerMillionCents, setBillingByokFeePerMillionCents] = useState<number>(0);
  const [hideInternalCostFromClient, setHideInternalCostFromClient] = useState<boolean>(false);
  const [requireByok, setRequireByok] = useState<boolean>(false);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBudgetMonthly(
      selectedCompany.budgetMonthlyCents && selectedCompany.budgetMonthlyCents > 0
        ? (selectedCompany.budgetMonthlyCents / 100).toFixed(2)
        : "",
    );
    setLogoUrl(selectedCompany.logoUrl ?? "");
    setGovernance(selectedCompany.interactionResolverGovernance ?? {});
    setBillingPricingMode((selectedCompany.billingPricingMode as BillingPricingMode) ?? "passthrough");
    setBillingMarkupPercent(selectedCompany.billingMarkupPercent ?? 0);
    setBillingByokFeePerMillionCents(selectedCompany.billingByokFeePerMillionCents ?? 0);
    setHideInternalCostFromClient(Boolean(selectedCompany.hideInternalCostFromClient));
    setRequireByok(Boolean(selectedCompany.requireByok));
  }, [selectedCompany]);

  const parsedBudgetMonthlyCents = Math.max(0, Math.round(Number(budgetMonthly || 0) * 100));
  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      parsedBudgetMonthlyCents !== (selectedCompany.budgetMonthlyCents ?? 0));

  const billingDirty =
    !!selectedCompany &&
    (billingPricingMode !== (selectedCompany.billingPricingMode ?? "passthrough") ||
      billingMarkupPercent !== (selectedCompany.billingMarkupPercent ?? 0) ||
      billingByokFeePerMillionCents !== (selectedCompany.billingByokFeePerMillionCents ?? 0) ||
      hideInternalCostFromClient !== Boolean(selectedCompany.hideInternalCostFromClient) ||
      requireByok !== Boolean(selectedCompany.requireByok));

  const billingMutation = useMutation({
    mutationFn: (data: {
      billingPricingMode?: BillingPricingMode;
      billingMarkupPercent?: number;
      billingByokFeePerMillionCents?: number;
      hideInternalCostFromClient?: boolean;
      requireByok?: boolean;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  function handleSaveBilling() {
    billingMutation.mutate({
      billingPricingMode,
      billingMarkupPercent,
      billingByokFeePerMillionCents,
      hideInternalCostFromClient,
      requireByok,
    });
  }

  const generalMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description: string | null;
      budgetMonthlyCents: number;
    }) => {
      const updated = await companiesApi.update(selectedCompanyId!, data);
      await budgetsApi.upsertPolicy(selectedCompanyId!, {
        scopeType: "company",
        scopeId: selectedCompanyId!,
        amount: data.budgetMonthlyCents,
        windowKind: "calendar_month_utc",
      });
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.budgets.overview(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) });
      }
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const governanceMutation = useMutation({
    mutationFn: (next: InteractionResolverGovernance) =>
      companiesApi.update(selectedCompanyId!, { interactionResolverGovernance: next }),
    onSuccess: (company) => {
      setGovernance(company.interactionResolverGovernance ?? {});
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  function handleGovernanceChange(
    kind: IssueThreadInteractionKind,
    field: GovernanceField,
    value: GovernanceSelectValue,
  ) {
    const next = applyGovernanceChange(governance, kind, field, value);
    setGovernance(next);
    governanceMutation.mutate(next);
  }

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (companyId: string) => companiesApi.remove(companyId),
    onSuccess: async (_, deletedId) => {
      const remaining = companies.filter((c) => c.id !== deletedId);
      const nextId = remaining[0]?.id ?? null;
      setSelectedCompanyId(nextId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats,
      });
      if (nextId) {
        navigate("/company/settings");
      } else {
        navigate("/dashboard");
      }
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No organization selected. Select an organization from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      budgetMonthlyCents: Math.max(0, Math.round(Number(budgetMonthly || 0) * 100)),
    });
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">General</h1>
      </div>

      {/* General */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3">
          <Field label="Organization name" hint="The display name for your organization.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
            {isCloudManaged && (
              <p className="mt-1 text-xs text-muted-foreground">
                Renaming can change this company's task ID prefix. Existing task IDs are
                renumbered and old task links stop resolving.
              </p>
            )}
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the organization profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional organization description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Monthly Spend Budget ($)"
            hint="Organization-wide monthly spend limit. Leave empty or 0.00 for unlimited. When reached, agent heartbeats and project executions are paused to prevent budget overruns."
          >
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                className="w-36 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={budgetMonthly}
                onChange={(e) => setBudgetMonthly(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">/ month</span>
            </div>
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                className="rounded-(--rad-14)"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : "Logo upload failed")}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="max-w-2xl space-y-4" data-testid="company-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div>
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="company-settings-team-approval-toggle"
          />
        </div>
      </div>

      {/* Interaction governance */}
      <InteractionGovernancePanel
        governance={governance}
        onChange={handleGovernanceChange}
        isPending={governanceMutation.isPending}
        errorMessage={
          governanceMutation.isError
            ? governanceMutation.error instanceof Error
              ? governanceMutation.error.message
              : "Failed to save interaction governance"
            : null
        }
      />

      {/* Client Billing & Monetization */}
      <div className="max-w-2xl space-y-4" data-testid="company-settings-billing-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Client Billing & Monetization
        </div>
        <div className="space-y-4 border border-border p-4">
          <Field
            label="Pricing Mode"
            hint="Determines how client billable amounts are calculated for agent inference and token runs."
          >
            <select
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={billingPricingMode}
              onChange={(e) => setBillingPricingMode(e.target.value as BillingPricingMode)}
            >
              <option value="passthrough" className="bg-background text-foreground">
                Direct Cost Passthrough (at cost)
              </option>
              <option value="simulated_markup" className="bg-background text-foreground">
                Simulated Market Value Markup (Recommended for subscriptions / BYOT spread)
              </option>
              <option value="fixed_markup" className="bg-background text-foreground">
                Direct Spend Markup (% added to real biller spend)
              </option>
              <option value="byok_fee" className="bg-background text-foreground">
                Bring Your Own Key Platform Fee (Flat fee per million tokens)
              </option>
            </select>
          </Field>

          {(billingPricingMode === "simulated_markup" || billingPricingMode === "fixed_markup") && (
            <Field
              label="Markup Percentage (%)"
              hint={
                billingPricingMode === "simulated_markup"
                  ? "Commercial markup added on top of the simulated market token rate. E.g. 30 adds 30% to benchmark value."
                  : "Markup added on top of actual billed API costs. E.g. 20 adds 20% to cost."
              }
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="1"
                  className="w-32 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                  value={billingMarkupPercent}
                  onChange={(e) => setBillingMarkupPercent(Math.max(0, Number(e.target.value)))}
                />
                <span className="text-sm text-muted-foreground">% markup</span>
              </div>
            </Field>
          )}

          {billingPricingMode === "byok_fee" && (
            <Field
              label="Platform Fee per Million Tokens ($)"
              hint="Fee charged to the client for every million tokens processed, regardless of provider or key origin."
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.05"
                  className="w-32 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                  value={(billingByokFeePerMillionCents / 100).toFixed(2)}
                  onChange={(e) =>
                    setBillingByokFeePerMillionCents(Math.max(0, Math.round(Number(e.target.value) * 100)))
                  }
                />
                <span className="text-sm text-muted-foreground">/ 1M tokens</span>
              </div>
            </Field>
          )}

          <div className="pt-2 border-t border-border flex flex-col gap-3">
            <ToggleField
              label="Require Bring-Your-Own-Key (BYOK)"
              hint="When enabled, agents must have their own API keys bound (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY). Agents cannot fall back to host subscriptions or credentials."
              checked={requireByok}
              onChange={setRequireByok}
              toggleTestId="company-settings-require-byok-toggle"
            />
            <ToggleField
              label="Hide Internal Costs & Spread from Client"
              hint="When enabled, client-facing views only show billable commercial amounts and total token usage. Internal API costs, $0 subscription costs, and your margin spread are completely hidden."
              checked={hideInternalCostFromClient}
              onChange={setHideInternalCostFromClient}
              toggleTestId="company-settings-hide-internal-cost-toggle"
            />
          </div>

          {billingDirty && (
            <div className="flex items-center gap-2 pt-2">
              <Button
                size="sm"
                onClick={handleSaveBilling}
                disabled={billingMutation.isPending}
              >
                {billingMutation.isPending ? "Saving..." : "Save billing settings"}
              </Button>
              {billingMutation.isSuccess && (
                <span className="text-xs text-muted-foreground">Saved</span>
              )}
              {billingMutation.isError && (
                <span className="text-xs text-destructive">
                  {billingMutation.error instanceof Error
                    ? billingMutation.error.message
                    : "Failed to save billing settings"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <InstanceGeneralSettings embedded />

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this organization to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive organization "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive organization"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive organization"}
              </span>
            )}
          </div>

          {isInstanceAdmin && (
            <div className="pt-4 border-t border-destructive/20 space-y-3">
              <p className="text-sm text-muted-foreground">
                Permanently delete this organization and all its data (agents, tasks, runs, and secrets). This action cannot be undone.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (!selectedCompanyId) return;
                    const confirmed = window.confirm(
                      `Permanently delete organization "${selectedCompany.name}" and all its data? THIS CANNOT BE UNDONE.`
                    );
                    if (!confirmed) return;
                    deleteMutation.mutate(selectedCompanyId);
                  }}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete organization"}
                </Button>
                {deleteMutation.isError && (
                  <span className="text-xs text-destructive">
                    {deleteMutation.error instanceof Error
                      ? deleteMutation.error.message
                      : "Failed to delete organization"}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
