import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
  InstanceObservabilitySummary,
  AgentRunTrace,
} from "@paperclipai/shared";
import { api } from "./client";

export const instanceSettingsApi = {
  get: () =>
    api.get<InstanceSettings>("/instance/settings"),
  update: (patch: PatchInstanceSettings) =>
    api.patch<InstanceSettings>("/instance/settings", patch),
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental", patch),
  getObservability: (window?: string, companyId?: string, privacy?: "sanitized" | "full") => {
    const params = new URLSearchParams();
    if (window) params.set("window", window);
    if (companyId && companyId !== "all") params.set("companyId", companyId);
    if (privacy) params.set("privacy", privacy);
    const qs = params.toString();
    return api.get<InstanceObservabilitySummary>(qs ? `/instance/observability?${qs}` : "/instance/observability");
  },
  getRunTrace: (runId: string, privacy?: "sanitized" | "full") => {
    const qs = privacy ? `?privacy=${encodeURIComponent(privacy)}` : "";
    return api.get<AgentRunTrace>(`/instance/observability/runs/${encodeURIComponent(runId)}/trace${qs}`);
  },
};
