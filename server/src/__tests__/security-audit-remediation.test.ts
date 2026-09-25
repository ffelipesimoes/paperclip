import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
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
}));

const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
  findManagedSandboxEnvironment: vi.fn(),
  update: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockPublishActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    heartbeatService: () => mockHeartbeatService,
    instanceSettingsService: () => mockInstanceSettingsService,
    logActivity: mockLogActivity,
    publishActivity: mockPublishActivity,
  }));
  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));
}

describe("Security Audit Remediation", () => {
  const routeModules = hoistModuleGraph(registerModuleMocks, async () => {
    const [{ errorHandler }, { instanceSettingsRoutes }] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/instance-settings.js")>("../routes/instance-settings.js"),
    ]);
    return { errorHandler, instanceSettingsRoutes };
  });

  function createTestApp(actor: Record<string, unknown>) {
    const { errorHandler, instanceSettingsRoutes } = routeModules.value;
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json());
    app.use((req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("X-XSS-Protection", "0");
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
    };
    app.use("/api", instanceSettingsRoutes(mockDb as any));
    app.use(errorHandler);
    return app;
  }

  describe("F2: Instance Settings Authorization Enforcement", () => {
    const companyAdminActor = {
      type: "board",
      userId: "guest-company-admin",
      userName: "Guest Admin",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-123"],
      memberships: [
        {
          companyId: "company-123",
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
      companyIds: ["company-123"],
      memberships: [
        {
          companyId: "company-123",
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
      companyIds: ["company-123"],
      memberships: [],
    };

    it("rejects PATCH /api/instance/settings from company admin with 403 Forbidden", async () => {
      const app = createTestApp(companyAdminActor);
      const res = await request(app)
        .patch("/api/instance/settings")
        .send({ logRetentionDays: 30 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Instance admin access required");
      expect(mockInstanceSettingsService.update).not.toHaveBeenCalled();
    });

    it("rejects PATCH /api/instance/settings from company owner with 403 Forbidden", async () => {
      const app = createTestApp(companyOwnerActor);
      const res = await request(app)
        .patch("/api/instance/settings")
        .send({ logRetentionDays: 30 });

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

  describe("F3: HTTP Security Headers", () => {
    it("includes standard security hardening headers and removes X-Powered-By", async () => {
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
      expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    });
  });
});
