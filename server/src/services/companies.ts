import { and, count, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  companies,
  companyLogos,
  assets,
  agents,
  agentApiKeys,
  agentConfigRevisions,
  agentMemberships,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  issues,
  issueApprovals,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueExecutionDecisions,
  issueInboxArchives,
  issuePlanDecompositions,
  issueReadStates,
  issueRecoveryActions,
  issueReferenceMentions,
  issueRelations,
  issueThreadInteractions,
  issueTreeHoldMembers,
  issueTreeHolds,
  issueWatchdogs,
  issueWorkProducts,
  inboxDismissals,
  projects,
  projectGoals,
  projectWorkspaces,
  projectMemberships,
  goals,
  heartbeatRuns,
  heartbeatRunEvents,
  heartbeatRunWatchdogDecisions,
  costEvents,
  financeEvents,
  approvalComments,
  approvals,
  activityLog,
  budgetIncidents,
  budgetPolicies,
  cases,
  caseIssueLinks,
  caseAttachments,
  caseDocuments,
  caseEvents,
  caseLabels,
  companyOnboardingSeeds,
  companySecretBindings,
  companySecretProposals,
  companySecrets,
  companySecretVersions,
  companySecretProviderConfigs,
  companySkillPolicies,
  companySkills,
  companySkillComments,
  companySkillStars,
  companySkillTestInputs,
  companySkillTestRuns,
  companySkillTestRunTemplates,
  companySkillVersions,
  companyTransferRuns,
  companyUserSidebarPreferences,
  completionContracts,
  decisionQueues,
  decisionQueueItems,
  decisionTrainingExamples,
  decisionTargetIssues,
  decisionArchiveNotificationOutbox,
  decisionRetention,
  decisionTriageEvents,
  decisionTriage,
  decisionBundles,
  decisionEffectExecutions,
  decisions,
  documentAnnotationAnchorSnapshots,
  documentAnnotationComments,
  documentAnnotationThreads,
  documentMemberships,
  documentRevisions,
  documents,
  feedbackExports,
  feedbackVotes,
  folders,
  invites,
  joinRequests,
  managedAgentProfiles,
  remoteAgentProfiles,
  nativeRunFinalizations,
  nativeRunResults,
  principalPermissionGrants,
  companyMemberships,
  providerTraceRecords,
  routineDocuments,
  routineRevisions,
  routineRuns,
  routines,
  routineTriggers,
  secretAccessEvents,
  statusDecisionEffects,
  statusDecisions,
  statusCards,
  statusCardUpdates,
  summarySlots,
  workAssessments,
  workspaceRuntimeServices,
  workspaceOperations,
  executionWorkspaceRuntimeLeases,
  executionWorkspaces,
  environmentLeases,
  pluginWebhookDeliveries,
  pluginLogs,
  pluginJobRuns,
  pluginEntities,
  pluginManagedResources,
  pluginConfig,
  pluginCompanySettings,
  pipelineAutomationExecutions,
  pipelineCaseBlockers,
  pipelineCaseDocuments,
  pipelineCaseEvents,
  pipelineCaseIssueLinks,
  pipelineCases,
  pipelineDocuments,
  pipelineTransitions,
  pipelineStages,
  pipelines,
  externalObjectMentions,
  externalObjects,
  smokeRunSteps,
  smokeRuns,
  toolAccessAuditEvents,
  toolCallEvents,
  toolInvocations,
  toolActionRequests,
  toolGatewaySessions,
  toolGatewayRateLimitCounters,
  toolRateLimitCounters,
  toolRuntimeMetricCounters,
  toolRuntimeSlots,
  toolMcpGatewayTokens,
  toolMcpGateways,
  toolOauthStates,
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
  toolConnectionInstalls,
  toolConnections,
  toolCatalogEntries,
  toolApplications,
  toolPolicies,
  toolStdioCommandTemplates,
  connectionEventDeliveries,
  connectionGrantDelegations,
  connectionGrantMembers,
  connectionGrants,
  connectionTokenIssuances,
  labels,
  issueLabels,
  issueCreateIdempotencyKeys,
  issueQuestionResponseDeliveries,
  userInboxAgentPolicies,
  userSecretDeclarations,
  userSecretDefinitions,
  adapterAuthSessions,
  builtInManagedResources,
} from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";
import { isCloudManagedInstance } from "./cloud-instance.js";
import {
  MAX_ISSUE_PREFIX_ATTEMPTS,
  deriveIssuePrefixBase,
  isIssuePrefixConflict,
  issuePrefixSuffixForAttempt,
  pickAvailableIssuePrefix,
  rekeyCompanyIssueIdentifiers,
} from "./issue-prefix.js";
import { environmentService } from "./environments.js";
import { heartbeatService } from "./heartbeat.js";
import { logActivity } from "./activity-log.js";
import { builtInAgentService } from "./built-in-agents.js";
import { simulateCostCents } from "@paperclipai/shared";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CompanyActivityActor {
  actorType: "user" | "agent" | "system" | "plugin";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
}

const SYSTEM_COMPANY_ACTOR: CompanyActivityActor = {
  actorType: "system",
  actorId: "system",
  agentId: null,
  runId: null,
};

export function companyService(db: Db) {
  const environmentsSvc = environmentService(db);
  const heartbeat = heartbeatService(db);
  const builtInAgents = builtInAgentService(db);

  type CompanyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  async function applyArchiveCascadeInTx(tx: CompanyTx, id: string) {
    const pausedAgentRows = await tx
      .update(agents)
      .set({
        status: "paused",
        pauseReason: "company_archived",
        pausedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(agents.companyId, id),
        notInArray(agents.status, ["paused", "terminated", "pending_approval"]),
      ))
      .returning({ id: agents.id });

    const activeRunIds = await tx
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.companyId, id),
        inArray(heartbeatRuns.status, ["queued", "running"]),
      ))
      .then((rows) => rows.map((row) => row.id));

    await tx
      .update(agentWakeupRequests)
      .set({
        status: "cancelled",
        error: "Cancelled because the company was archived",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentWakeupRequests.companyId, id),
        inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution", "claimed"]),
        isNull(agentWakeupRequests.runId),
      ));

    return { agentsPaused: pausedAgentRows.length, activeRunIds };
  }

  async function finalizeArchive(
    id: string,
    actor: CompanyActivityActor,
    cascade: { agentsPaused: number; activeRunIds: string[] },
  ) {
    for (const runId of cascade.activeRunIds) {
      await heartbeat.cancelRun(runId, "Cancelled because the company was archived");
    }

    await logActivity(db, {
      companyId: id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action: "company.archived",
      entityType: "company",
      entityId: id,
      details: {
        agentsPaused: cascade.agentsPaused,
        runsCancelled: cascade.activeRunIds.length,
      },
    });
  }

  const companySelection = {
    id: companies.id,
    name: companies.name,
    description: companies.description,
    status: companies.status,
    issuePrefix: companies.issuePrefix,
    issueCounter: companies.issueCounter,
    budgetMonthlyCents: companies.budgetMonthlyCents,
    spentMonthlyCents: companies.spentMonthlyCents,
    billingPricingMode: companies.billingPricingMode,
    billingMarkupPercent: companies.billingMarkupPercent,
    billingByokFeePerMillionCents: companies.billingByokFeePerMillionCents,
    hideInternalCostFromClient: companies.hideInternalCostFromClient,
    defaultResponsibleUserId: companies.defaultResponsibleUserId,
    requireBoardApprovalForNewAgents: companies.requireBoardApprovalForNewAgents,
    interactionResolverGovernance: companies.interactionResolverGovernance,
    feedbackDataSharingEnabled: companies.feedbackDataSharingEnabled,
    feedbackDataSharingConsentAt: companies.feedbackDataSharingConsentAt,
    feedbackDataSharingConsentByUserId: companies.feedbackDataSharingConsentByUserId,
    feedbackDataSharingTermsVersion: companies.feedbackDataSharingTermsVersion,
    logoAssetId: companyLogos.assetId,
    createdAt: companies.createdAt,
    updatedAt: companies.updatedAt,
  };

  function enrichCompany<T extends { logoAssetId: string | null }>(company: T) {
    return {
      ...company,
      logoUrl: company.logoAssetId ? `/api/assets/${company.logoAssetId}/content` : null,
    };
  }

  function currentUtcMonthWindow(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
  }

  async function getMonthlySpendByCompanyIds(
    companyIds: string[],
    database: Pick<Db, "select"> = db,
  ) {
    if (companyIds.length === 0) return new Map<string, number>();
    const { start, end } = currentUtcMonthWindow();
    const rows = await database
      .select({
        companyId: costEvents.companyId,
        model: costEvents.model,
        provider: costEvents.provider,
        billingType: costEvents.billingType,
        costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
        cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
        outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
        spentMonthlyCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, start),
          lt(costEvents.occurredAt, end),
        ),
      )
      .groupBy(costEvents.companyId, costEvents.model, costEvents.provider, costEvents.billingType);

    const result = new Map<string, { billed: number; subscriptionSim: number; sim: number }>();
    for (const row of rows as any[]) {
      if (row.spentMonthlyCents !== undefined && row.inputTokens === undefined && row.model === undefined) {
        return new Map((rows as any[]).map((r) => [r.companyId, Number(r.spentMonthlyCents ?? 0)]));
      }
      const existing = result.get(row.companyId) ?? { billed: 0, subscriptionSim: 0, sim: 0 };
      const costC = Number(row.costCents ?? row.spentMonthlyCents ?? 0);
      const inTok = Number(row.inputTokens ?? 0);
      const cacheTok = Number(row.cachedInputTokens ?? 0);
      const outTok = Number(row.outputTokens ?? 0);
      const simC = simulateCostCents({
        model: row.model,
        provider: row.provider,
        inputTokens: inTok,
        cachedInputTokens: cacheTok,
        outputTokens: outTok,
      });
      existing.billed += costC;
      existing.sim += simC;
      if (row.billingType !== "metered_api") {
        existing.subscriptionSim += simC;
      }
      result.set(row.companyId, existing);
    }
    return new Map(
      Array.from(result.entries()).map(([cid, data]) => {
        const effective = data.billed > 0 ? (data.billed + data.subscriptionSim) : data.sim;
        return [cid, Math.round(effective)];
      }),
    );
  }

  async function hydrateCompanySpend<T extends { id: string; spentMonthlyCents: number }>(
    rows: T[],
    database: Pick<Db, "select"> = db,
  ) {
    const spendByCompanyId = await getMonthlySpendByCompanyIds(rows.map((row) => row.id), database);
    return rows.map((row) => ({
      ...row,
      spentMonthlyCents: spendByCompanyId.get(row.id) ?? 0,
    }));
  }

  function getCompanyQuery(database: Pick<Db, "select">) {
    return database
      .select(companySelection)
      .from(companies)
      .leftJoin(companyLogos, eq(companyLogos.companyId, companies.id));
  }

  /**
   * Decides whether a rename must move the company onto a new issue prefix, and
   * returns the exact prefix pair to re-key.
   *
   * Self-hosted companies pick their prefix from the name at creation and keep
   * it, so a rename leaves the prefix alone. On a hosted/managed instance the
   * company is provisioned for the operator, so the name is the only prefix
   * source the operator ever chose — a rename re-derives it. Returns null when
   * the current prefix is already correct or when the suffix space is
   * exhausted.
   */
  async function resolveRenamedIssuePrefix(
    tx: CompanyTx,
    companyId: string,
    companyPatch: Partial<typeof companies.$inferInsert>,
  ): Promise<{ fromPrefix: string; toPrefix: string } | null> {
    // Only patch and environment facts gate the lock. Every comparison against
    // the company's own name or prefix happens below, under the lock.
    // An explicit prefix in the patch is the caller's decision; never override it.
    if (companyPatch.issuePrefix !== undefined) return null;
    const nextName = companyPatch.name;
    if (typeof nextName !== "string" || nextName.trim().length === 0) return null;
    if (!isCloudManagedInstance()) return null;

    // Lock the company row before comparing anything against it. Two concurrent
    // updates would otherwise each decide from the row they read before either
    // committed, and both ways of getting that wrong end with a company whose
    // prefix disagrees with its own identifiers:
    //
    //   - Two renames: the second re-keys from the prefix it read, finds the
    //     identifiers the first already moved, and leaves them on the first
    //     rename's prefix while the row carries the second one's.
    //   - A rename plus a stale form that resubmits the original name: the
    //     second sees a name equal to the one it read, skips re-derivation, and
    //     restores the old name on top of the first rename's prefix.
    //
    // Reading the row under the lock makes the second transaction decide from
    // what the first actually committed. Only a managed instance takes this
    // lock, and only for an update that carries a name.
    const locked = await tx
      .select({ name: companies.name, issuePrefix: companies.issuePrefix })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("update")
      .then((rows) => rows[0] ?? null);
    if (!locked || nextName === locked.name) return null;

    const nextBase = deriveIssuePrefixBase(nextName);
    // A rename that keeps the same base keeps the current prefix, including
    // any disambiguating suffix it was allocated.
    if (nextBase === deriveIssuePrefixBase(locked.name)) return null;
    if (nextBase === locked.issuePrefix) return null;

    const candidate = await pickAvailableIssuePrefix(tx, nextBase);
    if (!candidate || candidate === locked.issuePrefix) return null;
    return { fromPrefix: locked.issuePrefix, toPrefix: candidate };
  }

  async function createCompanyWithUniquePrefix(data: typeof companies.$inferInsert) {
    const base = deriveIssuePrefixBase(data.name);
    let suffix = 1;
    while (suffix <= MAX_ISSUE_PREFIX_ATTEMPTS) {
      const candidate = `${base}${issuePrefixSuffixForAttempt(suffix)}`;
      try {
        const rows = await db
          .insert(companies)
          .values({ ...data, issuePrefix: candidate })
          .returning();
        return rows[0];
      } catch (error) {
        if (!isIssuePrefixConflict(error)) throw error;
      }
      suffix += 1;
    }
    throw new Error("Unable to allocate unique issue prefix");
  }

  return {
    list: async () => {
      const rows = await getCompanyQuery(db);
      const hydrated = await hydrateCompanySpend(rows);
      return hydrated.map((row) => enrichCompany(row));
    },

    getById: async (id: string) => {
      // Non-UUID refs previously reached the uuid-typed query and threw a
      // DrizzleQueryError ("invalid input syntax for type uuid"), surfacing
      // as HTTP 500 from GET /api/companies/:companyId. Treat them as
      // not-found so the route returns 404.
      if (!UUID_RE.test(id)) return null;
      const row = await getCompanyQuery(db)
        .where(eq(companies.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [hydrated] = await hydrateCompanySpend([row], db);
      return enrichCompany(hydrated);
    },

    create: async (data: typeof companies.$inferInsert) => {
      const created = await createCompanyWithUniquePrefix(data);
      await environmentsSvc.ensureLocalEnvironment(created.id);
      await builtInAgents.autoProvisionBundledAgents(created.id);
      const row = await getCompanyQuery(db)
        .where(eq(companies.id, created.id))
        .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Company not found after creation");
      const [hydrated] = await hydrateCompanySpend([row], db);
      return enrichCompany(hydrated);
    },

    update: async (
      id: string,
      data: Partial<typeof companies.$inferInsert> & { logoAssetId?: string | null },
      actor: CompanyActivityActor = SYSTEM_COMPANY_ACTOR,
    ) => {
      const result = await db.transaction(async (tx) => {
        const existing = await getCompanyQuery(tx)
          .where(eq(companies.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        const { logoAssetId, ...companyPatch } = data;
        const willReactivate = existing.status !== "active" && companyPatch.status === "active";
        const willArchive = existing.status !== "archived" && companyPatch.status === "archived";

        if (logoAssetId !== undefined && logoAssetId !== null) {
          const nextLogoAsset = await tx
            .select({ id: assets.id, companyId: assets.companyId })
            .from(assets)
            .where(eq(assets.id, logoAssetId))
            .then((rows) => rows[0] ?? null);
          if (!nextLogoAsset) throw notFound("Logo asset not found");
          if (nextLogoAsset.companyId !== existing.id) {
            throw unprocessable("Logo asset must belong to the same company");
          }
        }

        const renamedPrefix = await resolveRenamedIssuePrefix(tx, id, companyPatch);

        const updated = await tx
          .update(companies)
          .set({
            ...companyPatch,
            ...(renamedPrefix ? { issuePrefix: renamedPrefix.toPrefix } : {}),
            updatedAt: new Date(),
          })
          .where(eq(companies.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;

        let issuePrefixRederived: {
          previousIssuePrefix: string;
          issuePrefix: string;
          issuesRekeyed: number;
          casesRekeyed: number;
        } | null = null;
        if (renamedPrefix) {
          const rekeyed = await rekeyCompanyIssueIdentifiers(tx, {
            companyId: id,
            fromPrefix: renamedPrefix.fromPrefix,
            toPrefix: renamedPrefix.toPrefix,
          });
          issuePrefixRederived = {
            previousIssuePrefix: renamedPrefix.fromPrefix,
            issuePrefix: renamedPrefix.toPrefix,
            issuesRekeyed: rekeyed.issues,
            casesRekeyed: rekeyed.cases,
          };
        }

        let agentsRestored = 0;
        if (willReactivate) {
          const restoredRows = await tx
            .update(agents)
            .set({
              status: "idle",
              pauseReason: null,
              pausedAt: null,
              updatedAt: new Date(),
            })
            .where(and(
              eq(agents.companyId, id),
              eq(agents.status, "paused"),
              eq(agents.pauseReason, "company_archived"),
            ))
            .returning({ id: agents.id });
          agentsRestored = restoredRows.length;
        }

        const archiveCascade = willArchive ? await applyArchiveCascadeInTx(tx, id) : null;

        if (logoAssetId === null) {
          await tx.delete(companyLogos).where(eq(companyLogos.companyId, id));
        } else if (logoAssetId !== undefined) {
          await tx
            .insert(companyLogos)
            .values({
              companyId: id,
              assetId: logoAssetId,
            })
            .onConflictDoUpdate({
              target: companyLogos.companyId,
              set: {
                assetId: logoAssetId,
                updatedAt: new Date(),
              },
            });
        }

        if (logoAssetId !== undefined && existing.logoAssetId && existing.logoAssetId !== logoAssetId) {
          await tx.delete(assets).where(eq(assets.id, existing.logoAssetId));
        }

        const [hydrated] = await hydrateCompanySpend([{
          ...updated,
          logoAssetId: logoAssetId === undefined ? existing.logoAssetId : logoAssetId,
        }], tx);

        const shouldLogReactivation = willReactivate &&
          (existing.status === "archived" || agentsRestored > 0);

        return {
          company: enrichCompany(hydrated),
          reactivated: shouldLogReactivation ? { agentsRestored } : null,
          archiveCascade,
          issuePrefixRederived,
        };
      });
      if (!result) return null;
      if (result.issuePrefixRederived) {
        await logActivity(db, {
          companyId: id,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          action: "company.updated",
          entityType: "company",
          entityId: id,
          details: {
            source: "company_rename",
            reason: "issue_prefix_rederived",
            ...result.issuePrefixRederived,
          },
        });
      }
      if (result.reactivated) {
        await logActivity(db, {
          companyId: id,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          action: "company.reactivated",
          entityType: "company",
          entityId: id,
          details: { agentsRestored: result.reactivated.agentsRestored },
        });
      }
      if (result.archiveCascade) {
        await finalizeArchive(id, actor, result.archiveCascade);
      }
      return result.company;
    },

    archive: async (id: string, actor: CompanyActivityActor = SYSTEM_COMPANY_ACTOR) => {
      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ status: companies.status })
          .from(companies)
          .where(eq(companies.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        const wasAlreadyArchived = existing.status === "archived";

        if (!wasAlreadyArchived) {
          await tx
            .update(companies)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(companies.id, id));
        }

        const cascade = wasAlreadyArchived ? null : await applyArchiveCascadeInTx(tx, id);

        const row = await getCompanyQuery(tx)
          .where(eq(companies.id, id))
          .then((rows) => rows[0] ?? null);
        if (!row) return null;
        const [hydrated] = await hydrateCompanySpend([row], tx);
        return {
          company: enrichCompany(hydrated),
          cascade,
        };
      });
      if (!result) return null;

      if (result.cascade) {
        await finalizeArchive(id, actor, result.cascade);
      }

      return result.company;
    },

    remove: (id: string) =>
      db.transaction(async (tx) => {
        // 1. Break self-referential / inter-entity FKs to prevent constraint checks failing during delete
        await tx
          .update(issues)
          .set({
            parentId: null,
            projectId: null,
            projectWorkspaceId: null,
            goalId: null,
            assigneeAgentId: null,
            createdByAgentId: null,
            checkoutRunId: null,
            executionRunId: null,
            lastStatusDecisionId: null,
            executionWorkspaceId: null,
          })
          .where(eq(issues.companyId, id));

        await tx.update(heartbeatRuns).set({ retryOfRunId: null }).where(eq(heartbeatRuns.companyId, id));
        await tx.update(agents).set({ reportsTo: null }).where(eq(agents.companyId, id));
        await tx.update(goals).set({ parentId: null, ownerAgentId: null }).where(eq(goals.companyId, id));
        await tx.update(projects).set({ goalId: null, leadAgentId: null }).where(eq(projects.companyId, id));
        await tx.update(folders).set({ parentId: null }).where(eq(folders.companyId, id));
        await tx.update(cases).set({ parentCaseId: null }).where(eq(cases.companyId, id));
        await tx
          .update(companySkills)
          .set({
            currentVersionId: null,
            forkedFromSkillId: null,
            forkedFromCompanyId: null,
            folderId: null,
          })
          .where(eq(companySkills.companyId, id));
        await tx.update(companySkillComments).set({ parentCommentId: null }).where(eq(companySkillComments.companyId, id));
        await tx.update(routineRevisions).set({ restoredFromRevisionId: null }).where(eq(routineRevisions.companyId, id));
        await tx.update(statusDecisions).set({ supersedesDecisionId: null }).where(eq(statusDecisions.companyId, id));
        await tx.update(workAssessments).set({ priorDecisionId: null, supersedesAssessmentId: null }).where(eq(workAssessments.companyId, id));
        await tx.update(completionContracts).set({ supersedesContractId: null }).where(eq(completionContracts.companyId, id));
        await tx.update(companySecretProposals).set({ secretProposalId: null }).where(eq(companySecretProposals.companyId, id));
        await tx.update(executionWorkspaces).set({ derivedFromExecutionWorkspaceId: null }).where(eq(executionWorkspaces.companyId, id));
        await tx.update(pipelineCases).set({ parentCaseId: null }).where(eq(pipelineCases.companyId, id));

        // 2. Decisions, Triage, and Queues
        const companyDecisionIds = await tx
          .select({ id: decisions.id })
          .from(decisions)
          .where(eq(decisions.companyId, id));
        if (companyDecisionIds.length > 0) {
          await tx
            .delete(decisionEffectExecutions)
            .where(inArray(decisionEffectExecutions.decisionId, companyDecisionIds.map((d) => d.id)));
        }
        await tx.delete(decisionTrainingExamples).where(eq(decisionTrainingExamples.companyId, id));
        await tx.delete(decisionTargetIssues).where(eq(decisionTargetIssues.companyId, id));
        await tx.delete(decisionArchiveNotificationOutbox).where(eq(decisionArchiveNotificationOutbox.companyId, id));
        await tx.delete(decisionRetention).where(eq(decisionRetention.companyId, id));
        await tx.delete(decisionTriageEvents).where(eq(decisionTriageEvents.companyId, id));
        await tx.delete(decisionTriage).where(eq(decisionTriage.companyId, id));
        await tx.delete(decisionQueueItems).where(eq(decisionQueueItems.companyId, id));
        await tx.delete(decisionQueues).where(eq(decisionQueues.companyId, id));
        await tx.delete(decisionBundles).where(eq(decisionBundles.companyId, id));
        await tx.delete(decisions).where(eq(decisions.companyId, id));

        // 3. Status Cards & Summary Slots
        const companyCardIds = await tx
          .select({ id: statusCards.id })
          .from(statusCards)
          .where(eq(statusCards.companyId, id));
        if (companyCardIds.length > 0) {
          await tx
            .delete(statusCardUpdates)
            .where(inArray(statusCardUpdates.cardId, companyCardIds.map((c) => c.id)));
        }
        await tx.delete(statusCards).where(eq(statusCards.companyId, id));
        await tx.delete(summarySlots).where(eq(summarySlots.companyId, id));

        // 4. Status Decisions, Run Finalizations, Assessments, Contracts
        await tx.delete(statusDecisionEffects).where(eq(statusDecisionEffects.companyId, id));
        await tx.delete(statusDecisions).where(eq(statusDecisions.companyId, id));
        await tx.delete(nativeRunFinalizations).where(eq(nativeRunFinalizations.companyId, id));
        await tx.delete(workAssessments).where(eq(workAssessments.companyId, id));
        await tx.delete(nativeRunResults).where(eq(nativeRunResults.companyId, id));
        await tx.delete(completionContracts).where(eq(completionContracts.companyId, id));

        // 5. Tool Access, Gateways, Connections, Applications, Grants
        await tx.delete(toolAccessAuditEvents).where(eq(toolAccessAuditEvents.companyId, id));
        await tx.delete(toolCallEvents).where(eq(toolCallEvents.companyId, id));
        await tx.delete(toolInvocations).where(eq(toolInvocations.companyId, id));
        await tx.delete(toolActionRequests).where(eq(toolActionRequests.companyId, id));
        await tx.delete(toolGatewaySessions).where(eq(toolGatewaySessions.companyId, id));
        await tx.delete(toolGatewayRateLimitCounters).where(eq(toolGatewayRateLimitCounters.companyId, id));
        await tx.delete(toolRateLimitCounters).where(eq(toolRateLimitCounters.companyId, id));
        await tx.delete(toolRuntimeMetricCounters).where(eq(toolRuntimeMetricCounters.companyId, id));
        await tx.delete(toolRuntimeSlots).where(eq(toolRuntimeSlots.companyId, id));
        await tx.delete(toolMcpGatewayTokens).where(eq(toolMcpGatewayTokens.companyId, id));
        await tx.delete(toolMcpGateways).where(eq(toolMcpGateways.companyId, id));
        await tx.delete(toolOauthStates).where(eq(toolOauthStates.companyId, id));
        await tx.delete(toolProfileBindings).where(eq(toolProfileBindings.companyId, id));
        await tx.delete(toolProfileEntries).where(eq(toolProfileEntries.companyId, id));
        await tx.delete(toolProfiles).where(eq(toolProfiles.companyId, id));
        await tx.delete(toolConnectionInstalls).where(eq(toolConnectionInstalls.companyId, id));
        await tx.delete(toolConnections).where(eq(toolConnections.companyId, id));
        await tx.delete(toolCatalogEntries).where(eq(toolCatalogEntries.companyId, id));
        await tx.delete(toolApplications).where(eq(toolApplications.companyId, id));
        await tx.delete(toolPolicies).where(eq(toolPolicies.companyId, id));
        await tx.delete(toolStdioCommandTemplates).where(eq(toolStdioCommandTemplates.companyId, id));
        await tx.delete(connectionEventDeliveries).where(eq(connectionEventDeliveries.companyId, id));
        await tx.delete(connectionGrantDelegations).where(eq(connectionGrantDelegations.companyId, id));
        await tx.delete(connectionGrantMembers).where(eq(connectionGrantMembers.companyId, id));
        await tx.delete(connectionGrants).where(eq(connectionGrants.companyId, id));
        await tx.delete(connectionTokenIssuances).where(eq(connectionTokenIssuances.companyId, id));

        // 6. Workspaces, Runtime Services, Leases
        await tx.delete(workspaceOperations).where(eq(workspaceOperations.companyId, id));
        await tx.delete(workspaceRuntimeServices).where(eq(workspaceRuntimeServices.companyId, id));
        await tx.delete(executionWorkspaceRuntimeLeases).where(eq(executionWorkspaceRuntimeLeases.companyId, id));
        await tx.delete(executionWorkspaces).where(eq(executionWorkspaces.companyId, id));
        await tx.delete(environmentLeases).where(eq(environmentLeases.companyId, id));

        // 7. Plugins
        await tx.delete(pluginWebhookDeliveries).where(eq(pluginWebhookDeliveries.companyId, id));
        await tx.delete(pluginLogs).where(eq(pluginLogs.companyId, id));
        await tx.delete(pluginJobRuns).where(eq(pluginJobRuns.companyId, id));
        await tx.delete(pluginEntities).where(eq(pluginEntities.companyId, id));
        await tx.delete(pluginManagedResources).where(eq(pluginManagedResources.companyId, id));
        await tx.delete(pluginConfig).where(eq(pluginConfig.companyId, id));
        await tx.delete(pluginCompanySettings).where(eq(pluginCompanySettings.companyId, id));

        // 8. Pipelines & Cases
        await tx.delete(pipelineAutomationExecutions).where(eq(pipelineAutomationExecutions.companyId, id));
        await tx.delete(pipelineCaseBlockers).where(eq(pipelineCaseBlockers.companyId, id));
        await tx.delete(pipelineCaseDocuments).where(eq(pipelineCaseDocuments.companyId, id));
        await tx.delete(pipelineCaseEvents).where(eq(pipelineCaseEvents.companyId, id));
        await tx.delete(pipelineCaseIssueLinks).where(eq(pipelineCaseIssueLinks.companyId, id));
        await tx.delete(pipelineCases).where(eq(pipelineCases.companyId, id));
        await tx.delete(pipelineDocuments).where(eq(pipelineDocuments.companyId, id));
        const companyPipelineIds = await tx
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(eq(pipelines.companyId, id));
        if (companyPipelineIds.length > 0) {
          const pIds = companyPipelineIds.map((p) => p.id);
          await tx.delete(pipelineTransitions).where(inArray(pipelineTransitions.pipelineId, pIds));
          await tx.delete(pipelineStages).where(inArray(pipelineStages.pipelineId, pIds));
        }
        await tx.delete(pipelines).where(eq(pipelines.companyId, id));

        await tx.delete(caseIssueLinks).where(eq(caseIssueLinks.companyId, id));
        await tx.delete(caseAttachments).where(eq(caseAttachments.companyId, id));
        await tx.delete(caseDocuments).where(eq(caseDocuments.companyId, id));
        await tx.delete(caseEvents).where(eq(caseEvents.companyId, id));
        await tx.delete(caseLabels).where(eq(caseLabels.companyId, id));
        await tx.delete(cases).where(eq(cases.companyId, id));

        // 9. External Objects
        await tx.delete(externalObjectMentions).where(eq(externalObjectMentions.companyId, id));
        await tx.delete(externalObjects).where(eq(externalObjects.companyId, id));

        // 10. Feedback, Traces, Smoke Runs
        await tx.delete(feedbackExports).where(eq(feedbackExports.companyId, id));
        await tx.delete(feedbackVotes).where(eq(feedbackVotes.companyId, id));
        await tx.delete(providerTraceRecords).where(eq(providerTraceRecords.companyId, id));
        await tx.delete(smokeRunSteps).where(eq(smokeRunSteps.companyId, id));
        await tx.delete(smokeRuns).where(eq(smokeRuns.companyId, id));

        // 11. Routines
        await tx.delete(routineDocuments).where(eq(routineDocuments.companyId, id));
        await tx.delete(routineRuns).where(eq(routineRuns.companyId, id));
        await tx.delete(routineTriggers).where(eq(routineTriggers.companyId, id));
        await tx.delete(routineRevisions).where(eq(routineRevisions.companyId, id));
        await tx.delete(routines).where(eq(routines.companyId, id));

        // 12. Secrets & User Secrets
        await tx.delete(secretAccessEvents).where(eq(secretAccessEvents.companyId, id));
        await tx.delete(userSecretDeclarations).where(eq(userSecretDeclarations.companyId, id));
        await tx.delete(userSecretDefinitions).where(eq(userSecretDefinitions.companyId, id));
        const companySecretIds = await tx
          .select({ id: companySecrets.id })
          .from(companySecrets)
          .where(eq(companySecrets.companyId, id));
        if (companySecretIds.length > 0) {
          await tx
            .delete(companySecretVersions)
            .where(inArray(companySecretVersions.secretId, companySecretIds.map((s) => s.id)));
        }
        await tx.delete(companySecretBindings).where(eq(companySecretBindings.companyId, id));
        await tx.delete(companySecretProposals).where(eq(companySecretProposals.companyId, id));
        await tx.delete(companySecretProviderConfigs).where(eq(companySecretProviderConfigs.companyId, id));
        await tx.delete(companySecrets).where(eq(companySecrets.companyId, id));

        // 13. Budget
        await tx.delete(budgetIncidents).where(eq(budgetIncidents.companyId, id));
        await tx.delete(budgetPolicies).where(eq(budgetPolicies.companyId, id));

        // 14. Company Skills (must be deleted before issues due to company_skills.issue_id FK)
        await tx.delete(companySkillComments).where(eq(companySkillComments.companyId, id));
        await tx.delete(companySkillStars).where(eq(companySkillStars.companyId, id));
        await tx.delete(companySkillTestInputs).where(eq(companySkillTestInputs.companyId, id));
        await tx.delete(companySkillTestRuns).where(eq(companySkillTestRuns.companyId, id));
        await tx.delete(companySkillTestRunTemplates).where(eq(companySkillTestRunTemplates.companyId, id));
        await tx.delete(companySkillVersions).where(eq(companySkillVersions.companyId, id));
        await tx.delete(companySkillPolicies).where(eq(companySkillPolicies.companyId, id));
        await tx.delete(companySkills).where(eq(companySkills.companyId, id));

        // 15. Documents & Folders
        await tx.delete(documentAnnotationAnchorSnapshots).where(eq(documentAnnotationAnchorSnapshots.companyId, id));
        await tx.delete(documentAnnotationComments).where(eq(documentAnnotationComments.companyId, id));
        await tx.delete(documentAnnotationThreads).where(eq(documentAnnotationThreads.companyId, id));
        await tx.delete(documentMemberships).where(eq(documentMemberships.companyId, id));
        await tx.delete(documentRevisions).where(eq(documentRevisions.companyId, id));
        await tx.delete(documents).where(eq(documents.companyId, id));
        await tx.delete(folders).where(eq(folders.companyId, id));

        // 16. Issue children & Approvals & Labels (must be deleted before issues)
        await tx.delete(issueApprovals).where(eq(issueApprovals.companyId, id));
        await tx.delete(approvalComments).where(eq(approvalComments.companyId, id));
        await tx.delete(approvals).where(eq(approvals.companyId, id));
        await tx.delete(issueExecutionDecisions).where(eq(issueExecutionDecisions.companyId, id));
        await tx.delete(issueRecoveryActions).where(eq(issueRecoveryActions.companyId, id));
        await tx.delete(issueWatchdogs).where(eq(issueWatchdogs.companyId, id));
        await tx.delete(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, id));
        await tx.delete(issueWorkProducts).where(eq(issueWorkProducts.companyId, id));
        await tx.delete(issueAttachments).where(eq(issueAttachments.companyId, id));
        await tx.delete(issueReferenceMentions).where(eq(issueReferenceMentions.companyId, id));
        await tx.delete(issueTreeHoldMembers).where(eq(issueTreeHoldMembers.companyId, id));
        await tx.delete(issueTreeHolds).where(eq(issueTreeHolds.companyId, id));
        await tx.delete(issuePlanDecompositions).where(eq(issuePlanDecompositions.companyId, id));
        await tx.delete(issueDocuments).where(eq(issueDocuments.companyId, id));
        await tx.delete(issueInboxArchives).where(eq(issueInboxArchives.companyId, id));
        await tx.delete(inboxDismissals).where(eq(inboxDismissals.companyId, id));
        await tx.delete(issueRelations).where(eq(issueRelations.companyId, id));
        await tx.delete(issueComments).where(eq(issueComments.companyId, id));
        await tx.delete(issueReadStates).where(eq(issueReadStates.companyId, id));
        await tx.delete(issueCreateIdempotencyKeys).where(eq(issueCreateIdempotencyKeys.companyId, id));
        await tx.delete(issueQuestionResponseDeliveries).where(eq(issueQuestionResponseDeliveries.companyId, id));
        await tx.delete(issueLabels).where(eq(issueLabels.companyId, id));
        await tx.delete(labels).where(eq(labels.companyId, id));

        // 17. Heartbeat Runs, Events, Sessions
        const companyRunIds = await tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.companyId, id));

        await tx.delete(heartbeatRunWatchdogDecisions).where(eq(heartbeatRunWatchdogDecisions.companyId, id));
        await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.companyId, id));
        if (companyRunIds.length > 0) {
          await tx
            .delete(heartbeatRunEvents)
            .where(inArray(heartbeatRunEvents.runId, companyRunIds.map((run) => run.id)));
        }
        await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.companyId, id));
        await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.companyId, id));
        await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, id));

        // 18. Cost, Finance, Activity
        await tx.delete(financeEvents).where(eq(financeEvents.companyId, id));
        await tx.delete(costEvents).where(eq(costEvents.companyId, id));
        await tx.delete(activityLog).where(eq(activityLog.companyId, id));

        // 19. Issues
        await tx.delete(issues).where(eq(issues.companyId, id));

        // 20. Projects & Goals
        await tx.delete(projectWorkspaces).where(eq(projectWorkspaces.companyId, id));
        await tx.delete(projectGoals).where(eq(projectGoals.companyId, id));
        await tx.delete(projectMemberships).where(eq(projectMemberships.companyId, id));
        await tx.delete(projects).where(eq(projects.companyId, id));
        await tx.delete(goals).where(eq(goals.companyId, id));

        // 21. Agent configurations, keys, profiles, state
        await tx.delete(adapterAuthSessions).where(eq(adapterAuthSessions.companyId, id));
        await tx.delete(agentConfigRevisions).where(eq(agentConfigRevisions.companyId, id));
        await tx.delete(agentApiKeys).where(eq(agentApiKeys.companyId, id));
        await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.companyId, id));
        await tx.delete(agentMemberships).where(eq(agentMemberships.companyId, id));
        await tx.delete(managedAgentProfiles).where(eq(managedAgentProfiles.companyId, id));
        await tx.delete(remoteAgentProfiles).where(eq(remoteAgentProfiles.companyId, id));
        await tx.delete(userInboxAgentPolicies).where(eq(userInboxAgentPolicies.companyId, id));

        // 22. Memberships, Onboarding, Invites, Preferences, Grants
        await tx.delete(joinRequests).where(eq(joinRequests.companyId, id));
        await tx.delete(invites).where(eq(invites.companyId, id));
        await tx.delete(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, id));
        await tx.delete(companyMemberships).where(eq(companyMemberships.companyId, id));
        await tx.delete(companyOnboardingSeeds).where(eq(companyOnboardingSeeds.companyId, id));
        await tx.delete(companyTransferRuns).where(eq(companyTransferRuns.companyId, id));
        await tx.delete(companyUserSidebarPreferences).where(eq(companyUserSidebarPreferences.companyId, id));

        // 23. Agents, Logos, Assets, Built-in Resources
        await tx.delete(agents).where(eq(agents.companyId, id));
        await tx.delete(companyLogos).where(eq(companyLogos.companyId, id));
        await tx.delete(assets).where(eq(assets.companyId, id));
        await tx.delete(builtInManagedResources).where(eq(builtInManagedResources.companyId, id));

        // 24. Finally, delete the company itself
        const rows = await tx
          .delete(companies)
          .where(eq(companies.id, id))
          .returning();
        return rows[0] ?? null;
      }),

    stats: async () => {
      const [agentRows, issueRows, runRows, costRows] = await Promise.all([
        db
          .select({
            companyId: agents.companyId,
            agentCount: count(),
            activeAgentCount: sql<number>`count(case when ${agents.status} not in ('paused', 'terminated', 'pending_approval') then 1 end)::int`,
          })
          .from(agents)
          .groupBy(agents.companyId),
        db
          .select({ companyId: issues.companyId, count: count() })
          .from(issues)
          .where(isNull(issues.hiddenAt))
          .groupBy(issues.companyId),
        db
          .select({
            companyId: heartbeatRuns.companyId,
            runCount: sql<number>`count(*)::int`,
            activeRunCount: sql<number>`count(case when ${heartbeatRuns.status} = 'running' then 1 end)::int`,
            runtimeMs: sql<number>`coalesce(sum(case when ${heartbeatRuns.startedAt} is not null then extract(epoch from (coalesce(${heartbeatRuns.finishedAt}, now()) - ${heartbeatRuns.startedAt})) * 1000 else 0 end), 0)::double precision`,
          })
          .from(heartbeatRuns)
          .groupBy(heartbeatRuns.companyId),
        db
          .select({
            companyId: costEvents.companyId,
            model: costEvents.model,
            provider: costEvents.provider,
            billingType: costEvents.billingType,
            costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
            inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
            cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
            outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
            subscriptionRunCount: sql<number>`count(distinct case when ${costEvents.billingType} in ('subscription_included', 'subscription_overage') then ${costEvents.heartbeatRunId} end)::int`,
          })
          .from(costEvents)
          .groupBy(costEvents.companyId, costEvents.model, costEvents.provider, costEvents.billingType),
      ]);

      const result: Record<
        string,
        {
          agentCount: number;
          activeAgentCount: number;
          issueCount: number;
          runCount: number;
          activeRunCount: number;
          runtimeMs: number;
          inputTokens: number;
          cachedInputTokens: number;
          outputTokens: number;
          totalTokens: number;
          costCents: number;
          simulatedCostCents: number;
          subscriptionTokens: number;
          subscriptionRunCount: number;
        }
      > = {};

      const getOrCreate = (companyId: string) => {
        if (!result[companyId]) {
          result[companyId] = {
            agentCount: 0,
            activeAgentCount: 0,
            issueCount: 0,
            runCount: 0,
            activeRunCount: 0,
            runtimeMs: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costCents: 0,
            simulatedCostCents: 0,
            subscriptionTokens: 0,
            subscriptionRunCount: 0,
          };
        }
        return result[companyId];
      };

      for (const row of agentRows) {
        const item = getOrCreate(row.companyId);
        item.agentCount = row.agentCount;
        item.activeAgentCount = Number(row.activeAgentCount ?? 0);
      }

      for (const row of issueRows) {
        const item = getOrCreate(row.companyId);
        item.issueCount = row.count;
      }

      for (const row of runRows) {
        const item = getOrCreate(row.companyId);
        item.runCount = Number(row.runCount ?? 0);
        item.activeRunCount = Number(row.activeRunCount ?? 0);
        item.runtimeMs = Number(row.runtimeMs ?? 0);
      }

      for (const row of costRows) {
        const item = getOrCreate(row.companyId);
        const inTok = Number(row.inputTokens ?? 0);
        const cacheTok = Number(row.cachedInputTokens ?? 0);
        const outTok = Number(row.outputTokens ?? 0);
        const costC = Number(row.costCents ?? 0);
        const simC = simulateCostCents({
          model: row.model,
          provider: row.provider,
          inputTokens: inTok,
          cachedInputTokens: cacheTok,
          outputTokens: outTok,
        });

        item.inputTokens += inTok;
        item.cachedInputTokens += cacheTok;
        item.outputTokens += outTok;
        item.totalTokens += inTok + cacheTok + outTok;
        item.costCents += costC;
        item.simulatedCostCents += simC;
        if (row.billingType !== "metered_api") {
          item.subscriptionTokens += inTok + cacheTok + outTok;
        }
        item.subscriptionRunCount += Number(row.subscriptionRunCount ?? 0);
      }

      return result;
    },
  };
}
