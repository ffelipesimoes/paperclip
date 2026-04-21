import type { UIAdapterModule } from "../types";
import { parseW3duStdoutLine } from "./parse-stdout";
import { W3duLocalConfigFields } from "./config-fields";
import { buildW3duLocalConfig } from "./build-config";

export const w3duLocalUIAdapter: UIAdapterModule = {
  type: "w3du_local",
  label: "W3DU (local)",
  parseStdoutLine: parseW3duStdoutLine,
  ConfigFields: W3duLocalConfigFields,
  buildAdapterConfig: buildW3duLocalConfig
};
