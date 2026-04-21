import type { AdapterConfigFieldsProps } from "../types";
import { Field, DraftInput } from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

const PLACEHOLDER_BASE_URL = "https://llm.w3du.com/v1";

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readExtras(values: AdapterConfigFieldsProps["values"]): Record<string, unknown> {
  return (values?.adapterSchemaValues as Record<string, unknown> | undefined) ?? {};
}

export function W3duLocalConfigFields(props: AdapterConfigFieldsProps) {
  const { isCreate, values, set, config, eff, mark } = props;

  const currentBaseUrl = isCreate
    ? readString(values?.url)
    : eff("adapterConfig", "baseUrl", readString(config.baseUrl));
  const extras = readExtras(values);
  const currentApiKey = isCreate
    ? readString(extras.apiKey)
    : eff("adapterConfig", "apiKey", readString(config.apiKey));

  const updateExtras = (patch: Record<string, unknown>) => {
    if (!set || !values) return;
    set({ adapterSchemaValues: { ...extras, ...patch } });
  };

  return (
    <>
      <Field
        label="Gateway base URL"
        hint="OpenAI-compatible endpoint root of the W3DU gateway."
      >
        <DraftInput
          value={currentBaseUrl}
          onCommit={(v) =>
            isCreate
              ? set!({ url: v })
              : mark("adapterConfig", "baseUrl", v.trim().length > 0 ? v.trim() : undefined)
          }
          immediate
          className={inputClass}
          placeholder={PLACEHOLDER_BASE_URL}
        />
      </Field>

      <Field label="API key" hint="Bearer token for the W3DU gateway (w3du_sk_...).">
        <DraftInput
          value={currentApiKey}
          onCommit={(v) =>
            isCreate
              ? updateExtras({ apiKey: v })
              : mark("adapterConfig", "apiKey", v.trim().length > 0 ? v.trim() : undefined)
          }
          immediate
          className={inputClass}
          placeholder="w3du_sk_..."
        />
      </Field>
    </>
  );
}
