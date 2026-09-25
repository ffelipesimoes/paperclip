import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { hoistModuleGraph } from "./helpers/hoist-module-graph.js";

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(),
  getGeneral: vi.fn(),
  getExperimental: vi.fn(),
  update: vi.fn(),
  updateGeneral: vi.fn(),
  updateExperimental: vi.fn(),
  listCompanyIds: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  computeTaskDrain: vi.fn(),
  applyTaskDrain: vi.fn(),
  stopTaskDrain: vi.fn(),
  getTaskDrainStatus: vi.fn(),
  cancelActiveForAgent: vi.fn(),
}));

const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
  findManagedSandboxEnvironment: vi.fn(),
  update: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}));

const mockCompaniesService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockSecretsService = vi.hoisted(() => ({
  resolveAdapterConfigForRuntime: vi.fn().mockImplementation(async (_companyId, config) => ({
    config: { ...config },
    secretKeys: new Set<string>(),
    manifest: [],
  })),
  resolveEnvBindings: vi.fn().mockResolvedValue({
    env: {},
    secretKeys: new Set<string>(),
    manifest: [],
  }),
  collectMissingRuntimeBindings: vi.fn().mockResolvedValue([]),
  normalizeAdapterConfigForPersistence: vi.fn().mockImplementation(async (_cid, config) => ({ ...config })),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockPublishActivity = vi.hoisted(() => vi.fn());

const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn().mockResolvedValue({ allowed: true }),
  isInstanceAdmin: vi.fn().mockResolvedValue(false),
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../services/index.js")>();
    return {
      ...actual,
      heartbeatService: () => mockHeartbeatService,
      instanceSettingsService: () => mockInstanceSettingsService,
      agentService: () => mockAgentService,
      companiesService: () => mockCompaniesService,
      secretsService: () => mockSecretsService,
      accessService: () => mockAccessService,
      logActivity: mockLogActivity,
      publishActivity: mockPublishActivity,
    };
  });
  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));
}

describe("Security Audit Remediation", () => {
  const routeModules = hoistModuleGraph(registerModuleMocks, async () => {
    const [
      { errorHandler },
      { instanceSettingsRoutes },
      { agentRoutes },
      { companyRoutes },
      { agentInstructionsService },
      { resolveExecutionRunAdapterConfig, ConfigurationIncompleteFailure },
    ] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/instance-settings.js")>("../routes/instance-settings.js"),
      vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
      vi.importActual<typeof import("../routes/companies.js")>("../routes/companies.js"),
      vi.importActual<typeof import("../services/agent-instructions.js")>("../services/agent-instructions.js"),
      vi.importActual<typeof import("../services/heartbeat.js")>("../services/heartbeat.js"),
    ]);
    return {
      errorHandler,
      instanceSettingsRoutes,
      agentRoutes,
      companyRoutes,
      agentInstructionsService,
      resolveExecutionRunAdapterConfig,
      ConfigurationIncompleteFailure,
    };
  });

  const testCompanyId = "11111111-1111-4111-8111-111111111111";
  const testAgentId = "22222222-2222-4222-8222-222222222222";

  const companyAdminActor = {
    type: "board",
    userId: "guest-company-admin",
    userName: "Guest Admin",
    source: "session",
    isInstanceAdmin: false,
    companyIds: [testCompanyId],
    memberships: [
      {
        companyId: testCompanyId,
        membershipRole: "admin",
        status: "active",
      },
    ],
  };

  const companyOwnerActor = {
    type: "board",
    userId: "guest-company-owner",
    userName: "Guest Owner",
    source: "session",
    isInstanceAdmin: false,
    companyIds: [testCompanyId],
    memberships: [
      {
        companyId: testCompanyId,
        membershipRole: "owner",
        status: "active",
      },
    ],
  };

  const instanceAdminActor = {
    type: "board",
    userId: "true-instance-admin",
    userName: "Instance Admin",
    source: "session",
    isInstanceAdmin: true,
    companyIds: [testCompanyId],
    memberships: [],
  };

  function createTestApp(actor: Record<string, unknown>) {
    const { errorHandler, instanceSettingsRoutes, agentRoutes, companyRoutes } = routeModules.value;
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json());
    app.use((req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("X-XSS-Protection", "0");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'self'; object-src 'none'; base-uri 'self';",
      );
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      if (req.secure || req.headers["x-forwarded-proto"] === "https") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      }
      next();
    });
    app.use((req, _res, next) => {
      (req as any).actor = {
        ...actor,
        companyIds: Array.isArray(actor.companyIds) ? [...actor.companyIds] : [],
      };
      next();
    });
    const mockDb = {
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      select: () => ({
        from: () => ({
          where: () => ({
            then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
            limit: () => ({
              then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
            }),
          }),
        }),
      }),
    };
    app.use("/api", instanceSettingsRoutes(mockDb as any));
    app.use("/api", agentRoutes(mockDb as any));
    app.use("/api/companies", companyRoutes(mockDb as any));
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Item 1: Instance Settings Authorization Enforcement & Precedence", () => {
    it("rejects PATCH /api/instance/settings from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch("/api/instance/settings")
        .send({ logRetentionDays: 30 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Instance admin access required");
      expect(mockInstanceSettingsService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/instance/settings even with invalid payload with 403 (auth precedes validation)", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch("/api/instance/settings")
        .send({ completelyInvalidField: "should_not_reach_validation", logRetentionDays: "invalid" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Instance admin access required");
      expect(mockInstanceSettingsService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/instance/settings/general from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch("/api/instance/settings/general")
        .send({ defaultAgentPauseGracePeriodSec: 45 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Instance admin access required");
      expect(mockInstanceSettingsService.updateGeneral).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/instance/settings/experimental from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch("/api/instance/settings/experimental")
        .send({ enableExperimentalFeatures: false });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Instance admin access required");
      expect(mockInstanceSettingsService.updateExperimental).not.toHaveBeenCalled();
    });

    it("allows PATCH /api/instance/settings from genuine instance admin", async () => {
      mockInstanceSettingsService.update.mockResolvedValue({ id: "settings-1" });
      mockInstanceSettingsService.listCompanyIds.mockResolvedValue([]);
      const app = createTestApp(instanceAdminActor);
      const res = await request(app)
        .patch("/api/instance/settings")
        .send({ defaultEnvironmentId: null });

      expect(res.status).toBe(200);
      expect(mockInstanceSettingsService.update).toHaveBeenCalled();
    });
  });

  describe("Item 2: Agent & Company Host-Managed Fields Guard (Role Allowlist)", () => {
    const existingAgent = {
      id: testAgentId,
      companyId: testCompanyId,
      name: "Engineering Agent",
      role: "general",
      title: "Senior Engineer",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 5000,
      spentMonthlyCents: 1200,
      defaultEnvironmentId: null,
      status: "idle",
      permissions: {},
    };

    beforeEach(() => {
      mockAgentService.getById.mockResolvedValue(existingAgent);
      mockAgentService.update.mockResolvedValue({ ...existingAgent });
    });

    it("rejects PATCH /api/agents/:id with budgetMonthlyCents from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/agents/${testAgentId}`)
        .send({ budgetMonthlyCents: 99999 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only instance admins can modify host-managed agent fields (budgetMonthlyCents)");
      expect(mockAgentService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/agents/:id with adapterConfig from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/agents/${testAgentId}`)
        .send({ adapterConfig: { graceSec: 60 } });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only instance admins can modify host-managed agent fields (adapterConfig)");
      expect(mockAgentService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/agents/:id with adapterType from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/agents/${testAgentId}`)
        .send({ adapterType: "claude_local" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only instance admins can modify host-managed agent fields (adapterType)");
      expect(mockAgentService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/agents/:id with runtimeConfig from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/agents/${testAgentId}`)
        .send({ runtimeConfig: { heartbeats: { intervalSec: 10 } } });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only instance admins can modify host-managed agent fields (runtimeConfig)");
      expect(mockAgentService.update).not.toHaveBeenCalled();
    });

    it("allows PATCH /api/agents/:id with safe tenant fields (name, title, status) from company admin", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/agents/${testAgentId}`)
        .send({ name: "Updated Name", title: "Staff Engineer", status: "paused" });

      expect(res.status).toBe(200);
      expect(mockAgentService.update).toHaveBeenCalledWith(
        testAgentId,
        expect.objectContaining({ name: "Updated Name", title: "Staff Engineer", status: "paused" }),
        expect.anything(),
      );
    });

    it("rejects PATCH /api/companies/:companyId billing/budget changes from company admin with 403 Forbidden", async () => {
      mockCompaniesService.getById.mockResolvedValue({
        id: testCompanyId,
        name: "Test Co",
        status: "active",
        budgetMonthlyCents: 5000,
        billingPricingMode: "passthrough",
      });

      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/companies/${testCompanyId}`)
        .send({ budgetMonthlyCents: 20000 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only instance admins can modify company budget and billing settings");
      expect(mockCompaniesService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/companies/:companyId billingPricingMode changes from company admin with 403 Forbidden", async () => {
      mockCompaniesService.getById.mockResolvedValue({
        id: testCompanyId,
        name: "Test Co",
        status: "active",
      });

      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch(`/api/companies/${testCompanyId}`)
        .send({ billingPricingMode: "byok_fee", requireByok: true });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Only instance admins can modify company budget and billing settings");
      expect(mockCompaniesService.update).not.toHaveBeenCalled();
    });
  });

  describe("Item 3: Path Traversal & Instructions Boundary Sanitization", () => {
    it("disallows null bytes in relative instructions file paths", async () => {
      const svc = routeModules.value.agentInstructionsService();
      const agent = {
        id: testAgentId,
        companyId: testCompanyId,
        name: "Test Agent",
        adapterConfig: {
          instructionsBundleMode: "external",
          instructionsRootPath: "/tmp",
          instructionsEntryFile: "AGENTS.md",
        },
      };

      await expect(svc.readFile(agent, "AGENTS\0.md")).rejects.toThrow("null bytes");
    });

    it("detects and blocks symlink escape outside the bundle root", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-symlink-test-"));
      try {
        const bundleRoot = path.join(tempDir, "bundle");
        const outsideDir = path.join(tempDir, "outside");
        await fs.mkdir(bundleRoot, { recursive: true });
        await fs.mkdir(outsideDir, { recursive: true });

        const outsideSecretFile = path.join(outsideDir, "secret.txt");
        await fs.writeFile(outsideSecretFile, "top_secret_data", "utf8");

        // Create symlink pointing outside bundle root
        const maliciousSymlink = path.join(bundleRoot, "malicious_link.txt");
        await fs.symlink(outsideSecretFile, maliciousSymlink);

        const svc = routeModules.value.agentInstructionsService();
        const agent = {
          id: testAgentId,
          companyId: testCompanyId,
          name: "Test Agent",
          adapterConfig: {
            instructionsBundleMode: "external",
            instructionsRootPath: bundleRoot,
            instructionsEntryFile: "AGENTS.md",
          },
        };

        await expect(svc.readFile(agent, "malicious_link.txt")).rejects.toThrow(
          "Instructions file path escapes bundle root via symlink",
        );
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe("Item 4: BYOK Policy Fail-Closed Pre-Dispatch Gate", () => {
    it("throws ConfigurationIncompleteFailure when requireByok is true and codex_local lacks OPENAI_API_KEY", async () => {
      const { resolveExecutionRunAdapterConfig } = routeModules.value;
      await expect(
        resolveExecutionRunAdapterConfig({
          companyId: testCompanyId,
          agentId: testAgentId,
          adapterType: "codex_local",
          executionRunConfig: { env: {} },
          projectEnv: null,
          routineEnv: null,
          secretsSvc: mockSecretsService as any,
          requireByok: true,
        }),
      ).rejects.toThrow("BYOK policy enforced: company requires Bring-Your-Own-Key. No OPENAI_API_KEY configured for agent");
    });

    it("throws ConfigurationIncompleteFailure when requireByok is true and claude_local lacks ANTHROPIC_API_KEY", async () => {
      const { resolveExecutionRunAdapterConfig } = routeModules.value;
      await expect(
        resolveExecutionRunAdapterConfig({
          companyId: testCompanyId,
          agentId: testAgentId,
          adapterType: "claude_local",
          executionRunConfig: { env: {} },
          projectEnv: null,
          routineEnv: null,
          secretsSvc: mockSecretsService as any,
          requireByok: true,
        }),
      ).rejects.toThrow("BYOK policy enforced: company requires Bring-Your-Own-Key. No ANTHROPIC_API_KEY configured for agent");
    });

    it("resolves config successfully when requireByok is true and agent supplies its own OPENAI_API_KEY", async () => {
      const { resolveExecutionRunAdapterConfig } = routeModules.value;
      const result = await resolveExecutionRunAdapterConfig({
        companyId: testCompanyId,
        agentId: testAgentId,
        adapterType: "codex_local",
        executionRunConfig: { env: { OPENAI_API_KEY: "sk-tenant-key-12345" } },
        projectEnv: null,
        routineEnv: null,
        secretsSvc: mockSecretsService as any,
        requireByok: true,
      });

      expect(result.resolvedConfig).toBeDefined();
    });
  });

  describe("Item 5: HTTP Security Headers", () => {
    it("returns all 6 security hardening headers and removes X-Powered-By", async () => {
      const app = createTestApp({
        type: "board",
        userId: "user-1",
        source: "session",
        isInstanceAdmin: true,
      });

      const res = await request(app)
        .get("/api/instance/settings")
        .set("X-Forwarded-Proto", "https");

      expect(res.headers["x-powered-by"]).toBeUndefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
      expect(res.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    });
  });
});
