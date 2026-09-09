import { Router, type Request } from "express";
import fs from "node:fs";
import os from "node:os";
import { and, asc, count, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companies,
  costEvents,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  patchInstanceSettingsSchema,
  patchInstanceExperimentalSettingsSchema,
  patchInstanceGeneralSettingsSchema,
  startTaskDrainRequestSchema,
  simulateCostCents,
  simulateCacheSavingsCents,
  type AgentComputeUsage,
  type AgentRunTrace,
  type AgentTraceNode,
  type CompanyComputeUsage,
  type ComputeTimelinePoint,
  type CostlyTask,
  type HostComputeResources,
  type InstanceObservabilitySummary,
  type ModelComputeUsage,
  type TaskCostDetail,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { isCloudManagedInstance } from "../services/cloud-instance.js";
import { getHiddenSettings } from "../services/settings-visibility.js";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  heartbeatService,
  instanceSettingsService,
  logActivity,
  publishActivity,
  type ActivityPublication,
} from "../services/index.js";
import { environmentService } from "../services/environments.js";
import { assertEnvironmentSelectionForCompany } from "./environment-selection.js";
import { assertBoardOrgAccess, getActorInfo } from "./authz.js";

function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a)
      && Array.isArray(b)
      && a.length === b.length
      && a.every((value, i) => sameJsonValue(value, b[i]))
    );
  }
  const aKeys = Object.keys(a);
  const bKeys = new Set(Object.keys(b));
  return aKeys.length === bKeys.size && aKeys.every((key) =>
    bKeys.has(key) && sameJsonValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Floor writes to operator-hidden settings. Same-value writes pass so clients
 * that echo a full GET response keep working (the executionMode precedent);
 * only a write that would actually change a hidden setting is rejected.
 */
async function assertNoHiddenSettingChanges(
  body: Record<string, unknown>,
  getCurrent: () => Promise<object>,
  isHiddenField: (field: string) => boolean,
) {
  const hiddenKeys = Object.keys(body).filter(isHiddenField);
  if (hiddenKeys.length === 0) return;
  const current = (await getCurrent()) as Record<string, unknown>;
  for (const key of hiddenKeys) {
    if (sameJsonValue(body[key], current[key])) continue;
    throw forbidden(`${key} is managed by the hosting operator on this instance`, {
      code: "settings_operator_managed",
    });
  }
}

/**
 * Publish activity events for an already-committed mutation. The audit row
 * exists in the database no matter what happens here, so a publish failure
 * must not turn into a route error: that would report the mutation as
 * failed to the caller when it in fact succeeded. Log and swallow instead.
 */
function publishActivitiesBestEffort(publications: ActivityPublication[], action: string) {
  for (const publication of publications) {
    try {
      publishActivity(publication);
    } catch (err) {
      logger.error({ err, action, companyId: publication.companyId }, "failed to publish activity event");
    }
  }
}

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (
    req.actor.source === "local_implicit" ||
    req.actor.isInstanceAdmin ||
    req.actor.memberships?.some((m) => m.membershipRole === "owner" || m.membershipRole === "admin")
  ) {
    return;
  }
  throw forbidden("Instance admin access required");
}

// A task-drain start or stop reads the live drain state, writes an audit
// transaction, and only then mutates the process-local drain state. The
// audit write is an async gap: two overlapping requests can commit their
// transactions in one order but reach the in-memory mutation in the other
// order, so a stale transition would win, the audit log would not match the
// live state, and the response for the newer request would not match what
// actually ended up live. Run each request's whole read-audit-apply
// sequence through this queue so overlapping requests execute one at a
// time, in the order they enter it: audit order and apply order then always
// agree, and each response reports exactly the state its own request
// produced.
let taskDrainTransitionQueue: Promise<void> = Promise.resolve();

function withTaskDrainTransition<T>(run: () => Promise<T>): Promise<T> {
  const turn = taskDrainTransitionQueue.then(run);
  // Normalize to a settled void promise for the next caller in line, so a
  // rejected transition (a failed audit write, for example) cannot wedge
  // every later transition behind it.
  taskDrainTransitionQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

export function instanceSettingsRoutes(db: Db) {
  const router = Router();
  const svc = instanceSettingsService(db);
  const environments = environmentService(db);
  const heartbeat = heartbeatService(db);

  router.get("/instance/settings", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await svc.get());
  });

  router.patch(
    "/instance/settings",
    validate(patchInstanceSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      if (Object.prototype.hasOwnProperty.call(req.body, "defaultEnvironmentId")) {
        await assertEnvironmentSelectionForCompany(
          environments,
          "instance",
          typeof req.body.defaultEnvironmentId === "string" ? req.body.defaultEnvironmentId : null,
        );
      }
      // An explicit tenant write of the instance default reclassifies its
      // attribution: whatever the default becomes — including a deliberate
      // re-selection of the managed sandbox row — it is tenant-chosen, so
      // the reconciliation stamp marker must not survive to let a later
      // managed-sandbox-only mode-off pass mistake the tenant's choice for a
      // stamp and revert it. The marker clear and the settings write commit
      // in ONE transaction, so no partial failure can desync attribution
      // from the default (neither a stale stamp on a tenant choice, nor a
      // reconciliation default that lost its marker and can never revert).
      const writesDefault = Object.prototype.hasOwnProperty.call(req.body, "defaultEnvironmentId");
      const managedSandbox = writesDefault
        ? await environments.findManagedSandboxEnvironment(undefined, { includeArchived: true })
        : null;
      const updated = await db.transaction(async (tx) => {
        if (managedSandbox?.metadata?.managedDefaultStamped === true) {
          const { managedDefaultStamped: _cleared, ...remainingMetadata } = managedSandbox.metadata;
          await environments.update(managedSandbox.id, { metadata: remainingMetadata }, { db: tx });
        }
        return svc.update(req.body, { db: tx });
      });
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "instance.settings.updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              defaultEnvironmentId: updated.defaultEnvironmentId,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated);
    },
  );

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. keyboardShortcuts) are readable by any
    // authenticated org member or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    res.json(await svc.getGeneral());
  });

  router.patch(
    "/instance/settings/general",
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      // Floor: on cloud-managed instances the execution mode is pinned by the
      // platform (the execution-policy bootstrap writes it at boot). No
      // instance admin — including a computed owner-admin — may change it: a
      // forced provider switch would strand runs on a provider the platform
      // never provisioned. Same-value writes pass so settings forms that echo
      // the full general-settings object keep working. Absent and "any" both
      // mean unrestricted, so they compare equal.
      if (
        isCloudManagedInstance() &&
        Object.prototype.hasOwnProperty.call(req.body, "executionMode")
      ) {
        const current = await svc.getGeneral();
        if ((req.body.executionMode ?? "any") !== (current.executionMode ?? "any")) {
          throw forbidden("executionMode is platform-managed on cloud-managed instances", {
            code: "execution_mode_platform_managed",
          });
        }
      }
      const hidden = getHiddenSettings();
      await assertNoHiddenSettingChanges(
        req.body,
        () => svc.getGeneral(),
        (field) => hidden.has(`instance.general.${field}`),
      );
      const updated = await svc.updateGeneral(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: updated.general,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated org member
    // or instance admin. Updating them remains instance-admin only because
    // this payload includes instance-wide operational controls.
    assertBoardOrgAccess(req);
    res.json(await svc.getExperimental());
  });

  router.patch(
    "/instance/settings/experimental",
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      // Hiding the whole Experimental page floors every toggle; otherwise
      // only individually hidden keys are floored.
      const hidden = getHiddenSettings();
      await assertNoHiddenSettingChanges(
        req.body,
        () => svc.getExperimental(),
        (field) =>
          hidden.has("instance.experimental") || hidden.has(`instance.experimental.${field}`),
      );
      const updated = await svc.updateExperimental(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              experimental: updated.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.experimental);
    },
  );

  router.get("/instance/task-drain", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(heartbeat.getTaskDrainStatus());
  });

  router.post(
    "/instance/task-drain",
    validate(startTaskDrainRequestSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      const ttlMs = req.body.ttlMs ?? null;
      // The whole read-audit-apply sequence runs as one queued transition
      // (see withTaskDrainTransition above), so an overlapping start or
      // stop cannot commit its audit row, or apply its live state, out of
      // order against this one. computeTaskDrain runs inside the turn so
      // startedAt reflects the moment this request actually took effect,
      // not the moment it arrived and was queued behind another transition.
      const drain = await withTaskDrainTransition(async () => {
        const computed = heartbeat.computeTaskDrain({ ttlMs });
        // One transaction for every company's audit row, so a write that
        // succeeds for one company and fails for another never leaves a
        // partial activity history behind — either every company gets the
        // record, or none does. The drain mutation below runs only after
        // this transaction commits, so a failed write leaves the live
        // drain untouched and there is no partial state to roll back.
        const postCommitActivityPublications: ActivityPublication[] = [];
        await db.transaction((tx) =>
          Promise.all(
            companyIds.map((companyId) =>
              logActivity(tx as unknown as Db, {
                companyId,
                actorType: actor.actorType,
                actorId: actor.actorId,
                agentId: actor.agentId,
                runId: actor.runId,
                agentApiKeyId: actor.agentApiKeyId,
                action: "instance.task_drain.started",
                entityType: "instance_settings",
                entityId: "default",
                details: {
                  startedAt: computed.startedAt,
                  expiresAt: computed.expiresAt,
                },
              }, postCommitActivityPublications),
            ),
          ),
        );
        heartbeat.applyTaskDrain(computed);
        // The audit record already committed, so a failure to publish it
        // here is not a reason to undo the drain: reverting the in-memory
        // state at this point would desync it from the committed row.
        // Swallow a publish failure so it cannot turn a committed mutation
        // into a false 500.
        publishActivitiesBestEffort(postCommitActivityPublications, "instance.task_drain.started");
        return computed;
      });
      res.json(drain);
    },
  );

  router.delete("/instance/task-drain", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    // See the POST handler above for why the whole read-audit-apply
    // sequence runs inside withTaskDrainTransition: it queues this stop
    // behind any transition already in flight, so it cannot read a status
    // an overlapping request is about to make stale, and its audit row and
    // its live-state mutation always land in the same order as every other
    // queued transition.
    const wasActive = await withTaskDrainTransition(async () => {
      const priorStatus = heartbeat.getTaskDrainStatus();
      // Read wasActive once, here, and use this same value for the audit
      // detail and the response body below. A TTL that expires between two
      // separate reads would otherwise make the two values disagree.
      const wasActive = priorStatus.draining;
      // See the POST handler above for why this is one transaction, and why
      // the drain mutation runs only after it commits.
      const postCommitActivityPublications: ActivityPublication[] = [];
      await db.transaction((tx) =>
        Promise.all(
          companyIds.map((companyId) =>
            logActivity(tx as unknown as Db, {
              companyId,
              actorType: actor.actorType,
              actorId: actor.actorId,
              agentId: actor.agentId,
              runId: actor.runId,
              agentApiKeyId: actor.agentApiKeyId,
              action: "instance.task_drain.stopped",
              entityType: "instance_settings",
              entityId: "default",
              details: {
                wasActive,
              },
            }, postCommitActivityPublications),
          ),
        ),
      );
      heartbeat.stopTaskDrain();
      // See the POST handler above for why a publish failure here is
      // swallowed instead of failing the route: the audit record already
      // committed, so a publish failure here must not undo a drain-stop
      // that is already correct in the database, and must not report the
      // stop as failed when it succeeded.
      publishActivitiesBestEffort(postCommitActivityPublications, "instance.task_drain.stopped");
      return wasActive;
    });
    res.json({ wasActive });
  });

  router.get("/instance/observability", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const windowParam = typeof req.query.window === "string" ? req.query.window.toLowerCase() : "all";
    let since: Date | null = null;
    if (windowParam === "24h") {
      since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (windowParam === "7d") {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (windowParam === "30d") {
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const runConditions = [];
    const costConditions = [];
    if (since) {
      runConditions.push(gte(heartbeatRuns.startedAt, since));
      costConditions.push(gte(costEvents.occurredAt, since));
    }

    const [
      allCompanies,
      agentRows,
      issueRows,
      runRows,
      costRows,
      allAgentsList,
      agentRunRows,
      agentCostRows,
      timelineCostRows,
      timelineRunRows,
      costlyTaskRows,
    ] = await Promise.all([
      db
        .select({
          id: companies.id,
          name: companies.name,
          issuePrefix: companies.issuePrefix,
          status: companies.status,
          createdAt: companies.createdAt,
        })
        .from(companies)
        .orderBy(desc(companies.createdAt)),
      db
        .select({
          companyId: agents.companyId,
          agentCount: count(),
          activeAgentCount: sql<number>`count(case when ${agents.status} not in ('paused', 'terminated', 'pending_approval') then 1 end)::int`,
        })
        .from(agents)
        .groupBy(agents.companyId),
      db
        .select({
          companyId: issues.companyId,
          count: count(),
        })
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
        .where(runConditions.length > 0 ? and(...runConditions) : undefined)
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
        .where(costConditions.length > 0 ? and(...costConditions) : undefined)
        .groupBy(costEvents.companyId, costEvents.model, costEvents.provider, costEvents.billingType),
      db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          status: agents.status,
          companyId: agents.companyId,
          companyName: companies.name,
          companyPrefix: companies.issuePrefix,
        })
        .from(agents)
        .innerJoin(companies, eq(agents.companyId, companies.id)),
      db
        .select({
          agentId: heartbeatRuns.agentId,
          runCount: sql<number>`count(*)::int`,
          activeRunCount: sql<number>`count(case when ${heartbeatRuns.status} = 'running' then 1 end)::int`,
          runtimeMs: sql<number>`coalesce(sum(case when ${heartbeatRuns.startedAt} is not null then extract(epoch from (coalesce(${heartbeatRuns.finishedAt}, now()) - ${heartbeatRuns.startedAt})) * 1000 else 0 end), 0)::double precision`,
        })
        .from(heartbeatRuns)
        .where(runConditions.length > 0 ? and(...runConditions) : undefined)
        .groupBy(heartbeatRuns.agentId),
      db
        .select({
          agentId: costEvents.agentId,
          model: costEvents.model,
          provider: costEvents.provider,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
        })
        .from(costEvents)
        .where(costConditions.length > 0 ? and(...costConditions) : undefined)
        .groupBy(costEvents.agentId, costEvents.model, costEvents.provider),
      db
        .select({
          bucket: sql<string>`to_char(date_trunc(${sql.raw(`'${windowParam === "24h" ? "hour" : "day"}'`)}, ${costEvents.occurredAt}), ${sql.raw(`'${windowParam === "24h" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD"}'`)})`,
          model: costEvents.model,
          provider: costEvents.provider,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
        })
        .from(costEvents)
        .where(costConditions.length > 0 ? and(...costConditions) : undefined)
        .groupBy(sql`1`, costEvents.model, costEvents.provider)
        .orderBy(sql`1 asc`),
      db
        .select({
          bucket: sql<string>`to_char(date_trunc(${sql.raw(`'${windowParam === "24h" ? "hour" : "day"}'`)}, ${heartbeatRuns.startedAt}), ${sql.raw(`'${windowParam === "24h" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD"}'`)})`,
          runCount: sql<number>`count(*)::int`,
          runtimeMs: sql<number>`coalesce(sum(case when ${heartbeatRuns.startedAt} is not null then extract(epoch from (coalesce(${heartbeatRuns.finishedAt}, now()) - ${heartbeatRuns.startedAt})) * 1000 else 0 end), 0)::double precision`,
        })
        .from(heartbeatRuns)
        .where(runConditions.length > 0 ? and(...runConditions) : undefined)
        .groupBy(sql`1`)
        .orderBy(sql`1 asc`),
      db
        .select({
          issueId: costEvents.issueId,
          issueTitle: issues.title,
          issueNumber: issues.issueNumber,
          identifier: issues.identifier,
          status: issues.status,
          priority: issues.priority,
          originKind: issues.originKind,
          createdByUserId: issues.createdByUserId,
          companyId: costEvents.companyId,
          companyName: companies.name,
          companyPrefix: companies.issuePrefix,
          agentName: agents.name,
          model: costEvents.model,
          provider: costEvents.provider,
          runCount: sql<number>`count(distinct ${costEvents.heartbeatRunId})::int`,
          latestRunId: sql<string | null>`coalesce(max(${costEvents.heartbeatRunId}::text), max(${issues.executionRunId}::text), max(${issues.checkoutRunId}::text))`,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
        })
        .from(costEvents)
        .innerJoin(issues, eq(costEvents.issueId, issues.id))
        .innerJoin(companies, eq(costEvents.companyId, companies.id))
        .innerJoin(agents, eq(costEvents.agentId, agents.id))
        .where(costConditions.length > 0 ? and(...costConditions) : undefined)
        .groupBy(
          costEvents.issueId,
          issues.title,
          issues.issueNumber,
          issues.identifier,
          issues.status,
          issues.priority,
          issues.originKind,
          issues.createdByUserId,
          costEvents.companyId,
          companies.name,
          companies.issuePrefix,
          agents.name,
          costEvents.model,
          costEvents.provider,
        ),
    ]);

    const companyMap = new Map<string, CompanyComputeUsage>();
    for (const c of allCompanies) {
      companyMap.set(c.id, {
        companyId: c.id,
        companyName: c.name,
        companyPrefix: c.issuePrefix,
        companyStatus: c.status as "active" | "paused" | "archived",
        createdAt: c.createdAt.toISOString(),
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
      });
    }

    for (const row of agentRows) {
      const item = companyMap.get(row.companyId);
      if (item) {
        item.agentCount = row.agentCount;
        item.activeAgentCount = Number(row.activeAgentCount ?? 0);
      }
    }

    for (const row of issueRows) {
      const item = companyMap.get(row.companyId);
      if (item) {
        item.issueCount = row.count;
      }
    }

    for (const row of runRows) {
      const item = companyMap.get(row.companyId);
      if (item) {
        item.runCount = Number(row.runCount ?? 0);
        item.activeRunCount = Number(row.activeRunCount ?? 0);
        item.runtimeMs = Number(row.runtimeMs ?? 0);
      }
    }

    const modelMap = new Map<string, ModelComputeUsage>();
    let simulatedCacheSavingsCents = 0;

    for (const row of costRows) {
      const item = companyMap.get(row.companyId);
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

      if (item) {
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

      // Model breakdown accumulation
      const modelKey = `${row.provider}:${row.model}`;
      let modelUsage = modelMap.get(modelKey);
      if (!modelUsage) {
        modelUsage = {
          model: row.model,
          provider: row.provider,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costCents: 0,
          simulatedCostCents: 0,
          percentage: 0,
        };
        modelMap.set(modelKey, modelUsage);
      }
      modelUsage.inputTokens += inTok;
      modelUsage.cachedInputTokens += cacheTok;
      modelUsage.outputTokens += outTok;
      modelUsage.totalTokens += inTok + cacheTok + outTok;
      modelUsage.costCents += costC;
      modelUsage.simulatedCostCents += simC;

      // Cache savings accumulation
      simulatedCacheSavingsCents += simulateCacheSavingsCents({
        model: row.model,
        provider: row.provider,
        cachedInputTokens: cacheTok,
      });
    }

    const companyList = Array.from(companyMap.values());
    companyList.sort((a, b) => b.totalTokens - a.totalTokens || b.runtimeMs - a.runtimeMs);

    const agentMap = new Map<string, AgentComputeUsage>();
    for (const a of allAgentsList) {
      agentMap.set(a.id, {
        agentId: a.id,
        agentName: a.name,
        agentRole: a.role,
        agentStatus: a.status,
        companyId: a.companyId,
        companyName: a.companyName,
        companyPrefix: a.companyPrefix,
        runCount: 0,
        activeRunCount: 0,
        runtimeMs: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        simulatedCostCents: 0,
        avgDurationMs: 0,
        tokensPerSecond: 0,
      });
    }

    for (const row of agentRunRows) {
      if (!row.agentId) continue;
      const item = agentMap.get(row.agentId);
      if (item) {
        item.runCount = Number(row.runCount ?? 0);
        item.activeRunCount = Number(row.activeRunCount ?? 0);
        item.runtimeMs = Number(row.runtimeMs ?? 0);
      }
    }

    for (const row of agentCostRows) {
      if (!row.agentId) continue;
      const item = agentMap.get(row.agentId);
      if (item) {
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
      }
    }

    for (const item of agentMap.values()) {
      if (item.runCount > 0) {
        item.avgDurationMs = Math.round(item.runtimeMs / item.runCount);
      }
      if (item.runtimeMs > 0) {
        item.tokensPerSecond = Math.round((item.totalTokens / (item.runtimeMs / 1000)) * 100) / 100;
      }
    }

    const agentList = Array.from(agentMap.values());
    agentList.sort((a, b) => b.totalTokens - a.totalTokens || b.runtimeMs - a.runtimeMs || b.runCount - a.runCount);

    const totalRuns = companyList.reduce((acc, c) => acc + c.runCount, 0);
    const activeRuns = companyList.reduce((acc, c) => acc + c.activeRunCount, 0);
    const totalRuntimeMs = companyList.reduce((acc, c) => acc + c.runtimeMs, 0);
    const totalInputTokens = companyList.reduce((acc, c) => acc + c.inputTokens, 0);
    const totalCachedTokens = companyList.reduce((acc, c) => acc + c.cachedInputTokens, 0);
    const totalOutputTokens = companyList.reduce((acc, c) => acc + c.outputTokens, 0);
    const totalTokens = companyList.reduce((acc, c) => acc + c.totalTokens, 0);
    const avgRunDurationMs = totalRuns > 0 ? Math.round(totalRuntimeMs / totalRuns) : 0;
    const tokensPerSecond = totalRuntimeMs > 0 ? Math.round((totalTokens / (totalRuntimeMs / 1000)) * 100) / 100 : 0;

    const totalInputAndCached = totalInputTokens + totalCachedTokens;
    const cacheHitRate = totalInputAndCached > 0 ? Math.round((totalCachedTokens / totalInputAndCached) * 1000) / 10 : 0;

    const modelList = Array.from(modelMap.values());
    const grandTotalTokens = totalTokens > 0 ? totalTokens : 1;
    for (const m of modelList) {
      m.percentage = Math.round((m.totalTokens / grandTotalTokens) * 1000) / 10;
    }
    modelList.sort((a, b) => b.totalTokens - a.totalTokens);

    // Timeline aggregation
    const timelineMap = new Map<string, ComputeTimelinePoint>();
    for (const row of timelineCostRows) {
      if (!row.bucket) continue;
      let point = timelineMap.get(row.bucket);
      if (!point) {
        point = {
          bucket: row.bucket,
          label: row.bucket.length > 10 ? row.bucket.slice(11) : row.bucket.slice(5),
          runCount: 0,
          runtimeMs: 0,
          tokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          simulatedCostCents: 0,
        };
        timelineMap.set(row.bucket, point);
      }
      const inTok = Number(row.inputTokens ?? 0);
      const cacheTok = Number(row.cachedInputTokens ?? 0);
      const outTok = Number(row.outputTokens ?? 0);
      point.tokens += inTok + cacheTok + outTok;
      point.inputTokens += inTok;
      point.cachedInputTokens += cacheTok;
      point.outputTokens += outTok;
      point.costCents += Number(row.costCents ?? 0);
      point.simulatedCostCents += simulateCostCents({
        model: row.model,
        provider: row.provider,
        inputTokens: inTok,
        cachedInputTokens: cacheTok,
        outputTokens: outTok,
      });
    }

    for (const row of timelineRunRows) {
      if (!row.bucket) continue;
      let point = timelineMap.get(row.bucket);
      if (!point) {
        point = {
          bucket: row.bucket,
          label: row.bucket.length > 10 ? row.bucket.slice(11) : row.bucket.slice(5),
          runCount: 0,
          runtimeMs: 0,
          tokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          simulatedCostCents: 0,
        };
        timelineMap.set(row.bucket, point);
      }
      point.runCount += Number(row.runCount ?? 0);
      point.runtimeMs += Number(row.runtimeMs ?? 0);
    }

    const timeline = Array.from(timelineMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

    // Top Costly Tasks & Granular Task Costs
    const taskMap = new Map<string, TaskCostDetail>();
    for (const row of costlyTaskRows) {
      if (!row.issueId) continue;
      let task = taskMap.get(row.issueId);
      if (!task) {
        task = {
          issueId: row.issueId,
          issueTitle: row.issueTitle ?? "Untitled task",
          issueNumber: row.issueNumber ?? null,
          identifier: row.identifier ?? null,
          companyId: row.companyId,
          companyName: row.companyName,
          companyPrefix: row.companyPrefix,
          status: row.status ?? "backlog",
          priority: row.priority ?? "medium",
          originKind: row.originKind ?? "manual",
          createdByUserId: row.createdByUserId ?? null,
          agentName: row.agentName,
          runCount: Number(row.runCount ?? 1),
          runtimeMs: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheHitRate: 0,
          costCents: 0,
          simulatedCostCents: 0,
          latestRunId: row.latestRunId ?? null,
        };
        taskMap.set(row.issueId, task);
      }
      const inTok = Number(row.inputTokens ?? 0);
      const cacheTok = Number(row.cachedInputTokens ?? 0);
      const outTok = Number(row.outputTokens ?? 0);
      task.inputTokens += inTok;
      task.cachedInputTokens += cacheTok;
      task.outputTokens += outTok;
      task.totalTokens += inTok + cacheTok + outTok;
      task.costCents += Number(row.costCents ?? 0);
      task.simulatedCostCents += simulateCostCents({
        model: row.model,
        provider: row.provider,
        inputTokens: inTok,
        cachedInputTokens: cacheTok,
        outputTokens: outTok,
      });
      if (row.latestRunId && !task.latestRunId) {
        task.latestRunId = row.latestRunId;
      }
    }

    for (const t of taskMap.values()) {
      const inAndCache = t.inputTokens + t.cachedInputTokens;
      t.cacheHitRate = inAndCache > 0 ? Math.round((t.cachedInputTokens / inAndCache) * 1000) / 10 : 0;
    }

    const allTasks: TaskCostDetail[] = Array.from(taskMap.values())
      .sort((a, b) => b.simulatedCostCents - a.simulatedCostCents || b.totalTokens - a.totalTokens);

    const costlyTasks: CostlyTask[] = allTasks.slice(0, 5).map((t) => ({
      issueId: t.issueId,
      issueTitle: t.issueTitle,
      companyName: t.companyName,
      companyPrefix: t.companyPrefix,
      agentName: t.agentName ?? "Unknown agent",
      totalTokens: t.totalTokens,
      simulatedCostCents: t.simulatedCostCents,
      latestRunId: t.latestRunId,
    }));

    const cpus = os.cpus();
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
    const loadAvg = os.loadavg() as [number, number, number];
    const memUsage = process.memoryUsage();

    let diskTotalBytes: number | undefined;
    let diskFreeBytes: number | undefined;
    let diskUsedBytes: number | undefined;
    try {
      const stats = fs.statfsSync(process.cwd());
      diskTotalBytes = Number(stats.bsize) * Number(stats.blocks);
      diskFreeBytes = Number(stats.bsize) * Number(stats.bavail);
      diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
    } catch {
      // Ignored if unsupported
    }

    const host: HostComputeResources = {
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model,
      loadAvg,
      totalMemBytes,
      freeMemBytes,
      usedMemBytes,
      processRssBytes: memUsage.rss,
      processHeapUsedBytes: memUsage.heapUsed,
      processHeapTotalBytes: memUsage.heapTotal,
      uptimeSeconds: Math.round(process.uptime()),
      hostUptimeSeconds: Math.round(os.uptime()),
      activeWorkers: activeRuns,
      diskTotalBytes,
      diskFreeBytes,
      diskUsedBytes,
    };

    const summary: InstanceObservabilitySummary = {
      window: windowParam,
      totalCompanies: allCompanies.length,
      activeCompanies: allCompanies.filter((c) => c.status === "active").length,
      totalAgents: companyList.reduce((acc, c) => acc + c.agentCount, 0),
      activeAgents: companyList.reduce((acc, c) => acc + c.activeAgentCount, 0),
      totalIssues: companyList.reduce((acc, c) => acc + c.issueCount, 0),
      totalRuns,
      activeRuns,
      totalRuntimeMs,
      avgRunDurationMs,
      tokensPerSecond,
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      cacheHitRate,
      simulatedCacheSavingsCents,
      billedCostCents: companyList.reduce((acc, c) => acc + c.costCents, 0),
      simulatedCostCents: companyList.reduce((acc, c) => acc + c.simulatedCostCents, 0),
      subscriptionTokens: companyList.reduce((acc, c) => acc + c.subscriptionTokens, 0),
      subscriptionRunCount: companyList.reduce((acc, c) => acc + c.subscriptionRunCount, 0),
      host,
      models: modelList,
      timeline,
      costlyTasks,
      tasks: allTasks,
      agents: agentList,
      companies: companyList,
    };

    res.json(summary);
  });

  router.get("/instance/observability/runs/:runId/trace", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const { runId } = req.params;

    const [run] = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        agentName: agents.name,
        companyId: heartbeatRuns.companyId,
        companyPrefix: companies.issuePrefix,
        issueId: issues.id,
        issueTitle: issues.title,
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        error: heartbeatRuns.error,
        stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
        stderrExcerpt: heartbeatRuns.stderrExcerpt,
        usageJson: heartbeatRuns.usageJson,
        resultJson: heartbeatRuns.resultJson,
      })
      .from(heartbeatRuns)
      .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .innerJoin(companies, eq(heartbeatRuns.companyId, companies.id))
      .leftJoin(issues, eq(heartbeatRuns.nativeIssueId, issues.id))
      .where(or(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.nativeIssueId, runId)))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const [events, runCostEvents] = await Promise.all([
      db
        .select()
        .from(heartbeatRunEvents)
        .where(eq(heartbeatRunEvents.runId, run.id))
        .orderBy(asc(heartbeatRunEvents.seq)),
      db
        .select()
        .from(costEvents)
        .where(eq(costEvents.heartbeatRunId, run.id)),
    ]);

    let totalTokens = 0;
    let simulatedCostCents = 0;
    for (const c of runCostEvents) {
      const inTok = Number(c.inputTokens ?? 0);
      const cacheTok = Number(c.cachedInputTokens ?? 0);
      const outTok = Number(c.outputTokens ?? 0);
      totalTokens += inTok + cacheTok + outTok;
      simulatedCostCents += simulateCostCents({
        model: c.model,
        provider: c.provider,
        inputTokens: inTok,
        cachedInputTokens: cacheTok,
        outputTokens: outTok,
      });
    }

    if (totalTokens === 0 && run.usageJson) {
      const u = run.usageJson as Record<string, unknown>;
      const inTok = Number(u.inputTokens ?? u.input_tokens ?? 0);
      const cacheTok = Number(u.cachedInputTokens ?? u.cached_input_tokens ?? 0);
      const outTok = Number(u.outputTokens ?? u.output_tokens ?? 0);
      totalTokens = inTok + cacheTok + outTok;
    }

    const durationMs = run.startedAt
      ? Math.max(0, (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime())
      : 0;

    const rawNodes: AgentTraceNode[] = [];
    for (const ev of events) {
      const payload = (ev.payload ?? {}) as Record<string, any>;
      const evType = (ev.eventType || "").toLowerCase();
      const msg = ev.message || "";

      let kind: AgentTraceNode["kind"] = "lifecycle";
      let title = msg || evType;
      let name: string | undefined;
      let status: "success" | "running" | "error" = "success";
      let nodeDurationMs: number | undefined;
      let input: unknown;
      let output: unknown;

      if (evType.includes("thought") || evType.includes("thinking") || payload.thought) {
        kind = "thought";
        title = "Raciocínio (Chain-of-Thought)";
        output = payload.thought ?? payload.content ?? msg;
      } else if (
        evType.includes("tool") ||
        evType.startsWith("call_") ||
        evType.includes("workspace.") ||
        payload.toolName ||
        payload.tool_name ||
        payload.tool
      ) {
        kind = "tool_call";
        name = payload.toolName || payload.tool_name || payload.tool || (msg.split(" ")[0] || "tool");
        title = `Ferramenta: ${name}`;
        input = payload.input ?? payload.args ?? payload.parameters;
        output = payload.output ?? payload.result ?? payload.response ?? payload.diff;
        if (typeof payload.durationMs === "number") nodeDurationMs = payload.durationMs;
        if (evType.includes("fail") || payload.error) status = "error";
      } else if (evType.includes("subagent") || payload.subagent || payload.subagentRole) {
        kind = "subagent";
        name = payload.subagentRole || payload.subagentType || payload.agentName || "Sub-agente";
        title = `Sub-agente: ${name}`;
        input = payload.prompt ?? payload.input;
        output = payload.result ?? payload.output;
        if (evType.includes("fail") || payload.error) status = "error";
      } else if (evType.includes("message") || evType === "item.completed") {
        kind = "message";
        title = "Resposta do Agente";
        output = payload.content ?? payload.text ?? msg;
      } else if (evType.includes("error") || ev.level === "error" || payload.error) {
        kind = "error";
        status = "error";
        title = "Erro na Execução";
        output = payload.error || msg;
      } else if (evType === "run.phase.timing" || evType === "run.startup.step" || evType === "lifecycle") {
        kind = "lifecycle";
        if (payload.phase) {
          title = `Fase: ${payload.phase}`;
        } else if (payload.step) {
          title = `Startup: ${payload.step}`;
        } else {
          title = msg || "Ciclo de Vida";
        }
        if (typeof payload.durationMs === "number") nodeDurationMs = payload.durationMs;
        if (payload.outcome === "failed") status = "error";
      }

      rawNodes.push({
        id: `node-${ev.seq}`,
        seq: Number(ev.seq),
        kind,
        title,
        name,
        status,
        durationMs: nodeDurationMs,
        input,
        output,
        startedAt: ev.createdAt.toISOString(),
      });
    }

    if (rawNodes.length === 0) {
      rawNodes.push({
        id: "node-start",
        seq: 1,
        kind: "lifecycle",
        title: "Início do Ciclo de Execução (Heartbeat)",
        status: "success",
        startedAt: run.startedAt?.toISOString() ?? new Date().toISOString(),
      });

      if (totalTokens > 0) {
        rawNodes.push({
          id: "node-llm",
          seq: 2,
          kind: "thought",
          title: "Processamento do Agente & Modelo LLM",
          status: run.status === "failed" ? "error" : "success",
          durationMs: durationMs > 0 ? durationMs : undefined,
          tokens: {
            input: runCostEvents.reduce((a, b) => a + (b.inputTokens ?? 0), 0),
            cached: runCostEvents.reduce((a, b) => a + (b.cachedInputTokens ?? 0), 0),
            output: runCostEvents.reduce((a, b) => a + (b.outputTokens ?? 0), 0),
          },
          output: run.resultJson ?? "Processamento de inferência concluído",
          startedAt: run.startedAt?.toISOString() ?? new Date().toISOString(),
        });
      }

      if (run.stdoutExcerpt) {
        rawNodes.push({
          id: "node-stdout",
          seq: 3,
          kind: "tool_call",
          title: "Execução de Processos / Ferramentas",
          name: "runner_output",
          status: "success",
          output: run.stdoutExcerpt,
          startedAt: run.startedAt?.toISOString() ?? new Date().toISOString(),
        });
      }

      if (run.error || run.stderrExcerpt) {
        rawNodes.push({
          id: "node-error",
          seq: 4,
          kind: "error",
          title: "Falha na Execução",
          status: "error",
          output: run.error || run.stderrExcerpt,
          startedAt: run.finishedAt?.toISOString() ?? new Date().toISOString(),
        });
      }

      rawNodes.push({
        id: "node-end",
        seq: 5,
        kind: "lifecycle",
        title: `Término da Execução (${run.status})`,
        status: run.status === "failed" ? "error" : "success",
        durationMs,
        startedAt: run.finishedAt?.toISOString() ?? new Date().toISOString(),
      });
    }

    // Build hierarchical call tree
    const nodes: AgentTraceNode[] = [];
    let currentParent: AgentTraceNode | null = null;
    for (const node of rawNodes) {
      if (node.kind === "lifecycle" && (node.title.startsWith("Fase:") || node.title.startsWith("Startup:"))) {
        currentParent = { ...node, children: [] };
        nodes.push(currentParent);
      } else if (node.kind === "thought") {
        const thoughtNode: AgentTraceNode = { ...node, children: [] };
        if (currentParent && currentParent.children) {
          currentParent.children.push(thoughtNode);
        } else {
          nodes.push(thoughtNode);
        }
        currentParent = thoughtNode;
      } else if (node.kind === "tool_call" || node.kind === "subagent") {
        if (currentParent && currentParent.children) {
          currentParent.children.push(node);
        } else {
          nodes.push(node);
        }
      } else {
        if (currentParent && currentParent.children && (node.kind === "error" || node.kind === "message")) {
          currentParent.children.push(node);
        } else {
          currentParent = null;
          nodes.push(node);
        }
      }
    }

    const trace: AgentRunTrace = {
      runId: run.id,
      agentId: run.agentId,
      agentName: run.agentName ?? "Agent",
      issueId: run.issueId ?? null,
      issueTitle: run.issueTitle ?? null,
      companyPrefix: run.companyPrefix ?? null,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? new Date().toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      durationMs,
      totalTokens,
      simulatedCostCents,
      nodes: nodes.length > 0 ? nodes : rawNodes,
    };

    res.json(trace);
  });

  return router;
}
