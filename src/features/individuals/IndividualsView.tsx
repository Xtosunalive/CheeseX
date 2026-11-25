import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ContractRenderer } from "@/components/contract-renderer/renderer-registry";
import { safeNavigateHash } from "@/lib/navigation";
import type { ContractRow } from "@/lib/contract-renderer";
import { Input } from "@/components/ui/input";
import { CLASS_MANAGEMENT_MAP, INDIVIDUALS_COPY } from "./individuals-copy";
import { useIndividualsController } from "./use-individuals-controller";
import { ClassManagementMap } from "./components/ClassManagementMap";
import type { IndividualUiConfig } from "./individuals-types";

const INDIVIDUAL_HOST_ACTIONS = new Set(["individuals.create", "individuals.update", "individuals.retire"]);

function canHostIndividualContract(config: IndividualUiConfig) {
  const screen = config.screen;
  return Boolean(screen && screen.nav_item === "individuals" && screen.renderer === "generic"
    && screen.buttons.every((button) => INDIVIDUAL_HOST_ACTIONS.has(button.action_id)));
}

function individualHostRoute(config: IndividualUiConfig) {
  const screen = config.screen;
  if (!screen) return "#/individuals";
  if (screen.nav_item === "schema") {
    if (screen.buttons.some((button) => button.action_id === "schema.modules.upsert")) return "#/schema?tab=modules";
    if (screen.buttons.some((button) => button.action_id.startsWith("schema.versions."))) return "#/schema?tab=versions";
    return "#/schema";
  }
  return `#/${screen.nav_item}`;
}

export function IndividualsView() {
  const {
    classIdInput,
    setClassIdInput,
    classId,
    config,
    items,
    formMode,
    setFormMode,
    formValues,
    setFormValues,
    detailValues,
    setDetailValues,
    error,
    setError,
    busy,
    classOptions,
    loadClass,
    refreshList,
    handleContractAction,
  } = useIndividualsController();
  const rows: ContractRow[] = items.map((item) => ({
    id: item.individualId,
    title: item.title,
    revision: item.revision,
    fields: item.fields || {},
  }));

  return (
    <div className="space-y-4 p-4" aria-label={INDIVIDUALS_COPY.VIEW_TITLE}>
      <header>
        <h2 className="text-sm font-medium text-text-main">{INDIVIDUALS_COPY.VIEW_TITLE}</h2>
        <p className="text-xs text-text-hint">{INDIVIDUALS_COPY.VIEW_HINT}</p>
      </header>

      <section>
        <ClassManagementMap groups={CLASS_MANAGEMENT_MAP} />
      </section>

      <section className="flex items-center gap-2">
        <label className="text-kg-xs text-text-hint">
          {INDIVIDUALS_COPY.CLASS_LABEL}
          <Input value={classIdInput} placeholder={INDIVIDUALS_COPY.CLASS_PLACEHOLDER} list="individual-class-options" onChange={(event) => setClassIdInput(event.target.value)} className="ml-2 h-8 w-64" />
          <datalist id="individual-class-options">{classOptions.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <Button type="button" disabled={busy || !classIdInput.trim()} onClick={() => void loadClass(classIdInput.trim())}>{INDIVIDUALS_COPY.LOAD_BUTTON}</Button>
      </section>

      {error && !config?.screen && <Alert variant="error">{error}</Alert>}

      {config && (
        <section>
          {config.screen && !canHostIndividualContract(config) ? (
            <Alert
              variant="warn"
              description={<Button type="button" size="sm" variant="outline" onClick={() => { safeNavigateHash(individualHostRoute(config)); }}>{INDIVIDUALS_COPY.GO_TO_HOST}</Button>}
            >
              {INDIVIDUALS_COPY.MANAGED_ELSEWHERE}
            </Alert>
          ) : (
            <ContractRenderer
              screen={config.screen}
              fields={config.fields}
              rows={rows}
              loading={busy && items.length === 0}
              error={error}
              onRetry={() => classId ? void refreshList(classId).catch((e) => setError(e instanceof Error ? e.message : String(e))) : undefined}
              busy={busy || config.lifecycle_status === "retired"}
              form={formMode ? {
                title: formMode.kind === "create" ? INDIVIDUALS_COPY.CREATE_TITLE : INDIVIDUALS_COPY.EDIT_TITLE,
                values: formValues,
                onChange: (name, value) => setFormValues((prev) => ({ ...prev, [name]: value })),
                onCancel: () => { setFormMode(null); setFormValues({}); setDetailValues(null); },
              } : null}
              detailValues={detailValues}
              forbiddenReason={error && /无权|FORBIDDEN|ROLE/i.test(error) ? error : null}
              retiredMessage={config.lifecycle_status === "retired"
                ? [config.screen?.states.retired.message_cn || INDIVIDUALS_COPY.RETIRED_TYPE, config.screen?.states.retired.replacement_type_id ? `${INDIVIDUALS_COPY.REPLACEMENT_TYPE_PREFIX}${config.screen.states.retired.replacement_type_id}` : null].filter(Boolean).join("；")
                : null}
              ariaLabel={INDIVIDUALS_COPY.LIST_TITLE}
              onAction={(context) => void handleContractAction(context)}
            />
          )}
        </section>
      )}
    </div>
  );
}
