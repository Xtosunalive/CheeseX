import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContractRenderer } from "@/components/contract-renderer/renderer-registry";
import type { ContractActionContext, ContractRow } from "@/lib/contract-renderer";
import { TERM } from "@/constants/term-const";
import { fetchIndividualConfig } from "@/features/individuals/individuals-api";
import type { IndividualUiConfig } from "@/features/individuals/individuals-types";
import { appendModuleProduct, upsertModule } from "../schema-write-api";
import { appendProductLabel, editModuleTitle, MODULES_COPY } from "../schema-manager-copy";
import type { ModuleDefinition, ModuleRegistry } from "../schema-manager-types";

interface Props {
  modules: ModuleRegistry;
  revision: string;
  disabled: boolean;
  fallback: ReactNode;
  onWritten: () => Promise<void>;
}

type FormMode = { kind: "create" } | { kind: "edit"; moduleId: string } | null;

const EDITABLE_FIELDS = ["name", "system", "subdomain", "parent_id", "since", "until", "products", "description"] as const;

function definitionValues(moduleId: string, definition?: ModuleDefinition): Record<string, unknown> {
  return {
    name: moduleId,
    system: definition?.system ?? "",
    subdomain: definition?.subdomain ?? "",
    parent_id: definition?.parent_id ?? "",
    since: definition?.since ?? "",
    until: definition?.until ?? "",
    products: definition?.products ?? [],
    description: definition?.description ?? "",
  };
}

export function ModuleContractView({ modules, revision, disabled, fallback, onWritten }: Props) {
  const [config, setConfig] = useState<IndividualUiConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [appendTarget, setAppendTarget] = useState<string | null>(null);
  const [appendValue, setAppendValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchIndividualConfig("Module")
      .then((value) => { if (alive) setConfig(value.success ? value.data : null); })
      .catch((reason) => { if (alive) setConfigError(reason instanceof Error ? reason.message : MODULES_COPY.CONTRACT_UNAVAILABLE); });
    return () => { alive = false; };
  }, []);

  const rows = useMemo<ContractRow[]>(() => Object.entries(modules).map(([moduleId, definition]) => ({
    id: moduleId,
    title: moduleId,
    revision,
    fields: { id: moduleId, name: moduleId, ...definition },
  })), [modules, revision]);

  const saveModule = async () => {
    const moduleId = String(formValues.name ?? "").trim();
    if (!moduleId) {
      setError(MODULES_COPY.MODULE_ID_REQUIRED);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const definition = Object.fromEntries(EDITABLE_FIELDS
        .filter((field) => field !== "name")
        .map((field) => [field, formValues[field] ?? (field === "products" ? [] : "")]));
      await upsertModule(moduleId, definition, revision);
      await onWritten();
      setFormMode(null);
      setFormValues({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : MODULES_COPY.SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const appendProduct = async () => {
    if (!appendTarget) return;
    setBusy(true);
    setError(null);
    try {
      await appendModuleProduct(appendTarget, appendValue.trim(), revision);
      await onWritten();
      setAppendTarget(null);
      setAppendValue("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : MODULES_COPY.APPEND_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const handleAction = async ({ action, row }: ContractActionContext) => {
    setError(null);
    if (action.action_id === "schema.modules.upsert" && action.placement === "toolbar") {
      setFormValues(definitionValues(""));
      setFormMode({ kind: "create" });
      setAppendTarget(null);
      return;
    }
    if (action.action_id === "schema.modules.upsert" && action.placement === "detail") {
      await saveModule();
      return;
    }
    if (action.action_id === "schema.modules.upsert" && row) {
      setFormValues(definitionValues(row.id, modules[row.id]));
      setFormMode({ kind: "edit", moduleId: row.id });
      setAppendTarget(null);
      return;
    }
    if (action.action_id === "schema.enums.append" && row) {
      setAppendTarget(row.id);
      setAppendValue("");
      setFormMode(null);
    }
  };

  if (!config?.screen) {
    return (
      <div className="space-y-3">
        {configError ? <Alert variant="warn">{`${MODULES_COPY.CONTRACT_FALLBACK_PREFIX}${configError}`}</Alert> : null}
        {fallback}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ContractRenderer
        screen={config.screen}
        fields={config.fields}
        rows={rows}
        error={error}
        onRetry={() => void onWritten().catch((reason) => setError(reason instanceof Error ? reason.message : MODULES_COPY.SAVE_FAILED))}
        busy={busy || disabled || config.lifecycle_status === "retired"}
        form={formMode ? {
          title: formMode.kind === "create" ? MODULES_COPY.CREATE_TITLE : editModuleTitle(formMode.moduleId),
          values: formValues,
          onChange: (name, value) => setFormValues((current) => ({ ...current, [name]: value })),
          onCancel: () => { setFormMode(null); setFormValues({}); },
          readOnlyFields: formMode.kind === "edit" ? ["name"] : [],
        } : null}
        forbiddenReason={error && /无权|FORBIDDEN|ROLE/i.test(error) ? error : null}
        retiredMessage={config.lifecycle_status === "retired" ? config.screen.states.retired.message_cn : null}
        ariaLabel={MODULES_COPY.CONTRACT_ARIA}
        onAction={(context) => void handleAction(context)}
      />
      {appendTarget ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-root p-3 ring-1 ring-border-thin">
          <label className="block text-kg-xs text-text-hint">
            {appendProductLabel(appendTarget)}
            <Input
              className="mt-1 h-8 max-w-md"
              value={appendValue}
              disabled={busy || disabled}
              onChange={(event) => setAppendValue(event.target.value)}
            />
          </label>
          <Button type="button" size="sm" disabled={busy || disabled || !appendValue.trim()} onClick={() => void appendProduct()}>{MODULES_COPY.CONFIRM_APPEND}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setAppendTarget(null); setAppendValue(""); }}>{TERM.CANCEL_ACTION}</Button>
        </div>
      ) : null}
    </div>
  );
}
