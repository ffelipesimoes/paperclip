import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
  InstanceObservabilitySummary,
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
  getObservability: (window?: string) =>
    api.get<InstanceObservabilitySummary>(window ? `/instance/observability?window=${encodeURIComponent(window)}` : "/instance/observability"),
};
