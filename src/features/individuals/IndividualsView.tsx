// WP-210（SPEC-100 批 4）：个体派生面视图——类选择→config 动态渲染表单/清单→创建/编辑/退役
// 全链路走批 2 generic:* 通用面（单一执法点：后端按类绑定校验，前端只转述）。
import { useCallback, useState } from "react";
import {
  createIndividual,
  fetchIndividual,
  fetchIndividualConfig,
  fetchIndividualList,
  retireIndividual,
  updateIndividual,
} from "./individuals-api";
import { INDIVIDUALS_COPY } from "./individuals-copy";
import type { IndividualListItem, IndividualUiConfig } from "./individuals-types";
import { DerivedFieldForm } from "./components/DerivedFieldForm";
import { DerivedIndividualsTable } from "./components/DerivedIndividualsTable";

type FormMode = { kind: "create" } | { kind: "edit"; individualId: string; revision: string } | null;

export function IndividualsView() {
  const [classIdInput, setClassIdInput] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [config, setConfig] = useState<IndividualUiConfig | null>(null);
  const [items, setItems] = useState<IndividualListItem[]>([]);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadClass = useCallback(async (target: string) => {
    setBusy(true);
    setError(null);
    setFormMode(null);
    try {
      const configEnv = await fetchIndividualConfig(target);
      if (!configEnv.success) throw new Error(configEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      setConfig(configEnv.data);
      setClassId(target);
      const listEnv = await fetchIndividualList(target);
      setItems(listEnv.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  async function refreshList(target: string) {
    const listEnv = await fetchIndividualList(target);
    setItems(listEnv.data ?? []);
  }


  async function handleEdit(item: IndividualListItem) {
    if (!classId) return;
    setBusy(true);
    setError(null);
    try {
      const recordEnv = await fetchIndividual(classId, item.individualId);
      if (!recordEnv.success) throw new Error(recordEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      const systemKeys = new Set(["class_id", "individual_id", "lifecycle_status", "created", "updated", "retired"]);
      const userFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(recordEnv.data.fields)) if (!systemKeys.has(k)) userFields[k] = v;
      setFormValues(userFields);
      setFormMode({ kind: "edit", individualId: item.individualId, revision: recordEnv.data.revision });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!classId || !formMode) return;
    setBusy(true);
    setError(null);
    try {
      if (formMode.kind === "create") {
        const env = await createIndividual(classId, formValues);
        if (!env.success) throw new Error(env.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      } else {
        const env = await updateIndividual(classId, formMode.individualId, formValues, formMode.revision);
        if (!env.success) throw new Error(env.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      }
      setFormValues({});
      setFormMode(null);
      await refreshList(classId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRetire(item: IndividualListItem) {
    if (!classId) return;
    setBusy(true);
    setError(null);
    try {
      const recordEnv = await fetchIndividual(classId, item.individualId);
      const env = await retireIndividual(classId, item.individualId, recordEnv.data.revision);
      if (!env.success) throw new Error(env.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      await refreshList(classId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-4" aria-label={INDIVIDUALS_COPY.VIEW_TITLE}>
      <div>
        <h2 className="text-sm font-medium text-text-main">{INDIVIDUALS_COPY.VIEW_TITLE}</h2>
        <p className="text-xs text-text-hint">{INDIVIDUALS_COPY.VIEW_HINT}</p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-kg-xs text-text-hint">
          {INDIVIDUALS_COPY.CLASS_LABEL}
          <input
            value={classIdInput}
            placeholder={INDIVIDUALS_COPY.CLASS_PLACEHOLDER}
            onChange={(event) => setClassIdInput(event.target.value)}
            className="ml-2 h-8 w-64 rounded bg-surface-root px-3 text-xs text-text-main ring-1 ring-border-thin outline-none focus:ring-border-focus"
          />
        </label>
        <button type="button" disabled={busy || !classIdInput.trim()} onClick={() => void loadClass(classIdInput.trim())} className="h-8 rounded px-3 text-xs ring-1 ring-border-thin">
          {INDIVIDUALS_COPY.LOAD_BUTTON}
        </button>
      </div>

      {error && <p role="alert" className="whitespace-pre-line rounded-md bg-status-error-2 px-3 py-2 text-xs text-status-error ring-1 ring-status-error-6">{error}</p>}

      {config && (
        <div className="space-y-4">
          {formMode && (
            <div className="rounded-lg bg-surface-root p-3 ring-1 ring-border-thin">
              <p className="mb-2 text-xs font-medium">{formMode.kind === "create" ? INDIVIDUALS_COPY.CREATE_TITLE : INDIVIDUALS_COPY.EDIT_TITLE}</p>
              <DerivedFieldForm fields={config.fields} values={formValues} onChange={(name, value) => setFormValues((prev) => ({ ...prev, [name]: value }))} disabled={busy} />
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void handleSave()} className="h-8 rounded bg-accent-bg px-3 text-xs">{INDIVIDUALS_COPY.SAVE_BUTTON}</button>
                <button type="button" disabled={busy} onClick={() => { setFormMode(null); setFormValues({}); }} className="h-8 rounded px-3 text-xs ring-1 ring-border-thin">{INDIVIDUALS_COPY.CANCEL_BUTTON}</button>
              </div>
            </div>
          )}

          {!formMode && (
            <div>
              <button type="button" disabled={busy} onClick={() => { setFormValues({}); setFormMode({ kind: "create" }); }} className="h-8 rounded bg-accent-bg px-3 text-xs">{INDIVIDUALS_COPY.CREATE_BUTTON}</button>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium">{INDIVIDUALS_COPY.LIST_TITLE}</p>
            <DerivedIndividualsTable items={items} onEdit={(item) => void handleEdit(item)} onRetire={(item) => void handleRetire(item)} busy={busy} />
          </div>
        </div>
      )}
    </div>
  );
}
