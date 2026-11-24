import { useCallback, useEffect, useState } from "react";
import {
  createIndividual,
  fetchIndividualClasses,
  fetchIndividual,
  fetchIndividualConfig,
  fetchIndividualList,
  retireIndividual,
  updateIndividual,
} from "./individuals-api";
import { INDIVIDUALS_COPY } from "./individuals-copy";
import type { ContractActionContext } from "@/lib/contract-renderer";
import type { IndividualListItem, IndividualUiConfig } from "./individuals-types";

export type FormMode = { kind: "create" } | { kind: "edit"; individualId: string; revision: string } | null;

export function useIndividualsController() {
  const [classIdInput, setClassIdInput] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [config, setConfig] = useState<IndividualUiConfig | null>(null);
  const [items, setItems] = useState<IndividualListItem[]>([]);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [detailValues, setDetailValues] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [classOptions, setClassOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchIndividualClasses().then((list) => setClassOptions(list)).catch(() => setClassOptions([]));
  }, []);

  const loadClass = useCallback(async (target: string) => {
    setBusy(true);
    setError(null);
    setConfig(null);
    setItems([]);
    setFormMode(null);
    setDetailValues(null);
    try {
      const configEnv = await fetchIndividualConfig(target);
      if (!configEnv.success) throw new Error(configEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      setConfig(configEnv.data);
      setClassId(target);
      const listEnv = await fetchIndividualList(target);
      if (!listEnv.success) throw new Error(listEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      setItems(listEnv.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  async function refreshList(target: string) {
    setBusy(true);
    setError(null);
    try {
      const listEnv = await fetchIndividualList(target);
      if (!listEnv.success) throw new Error(listEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      setItems(listEnv.data ?? []);
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(item: IndividualListItem) {
    if (!classId || !config) return;
    setBusy(true);
    setError(null);
    setDetailValues(null);
    try {
      const recordEnv = await fetchIndividual(classId, item.individualId);
      if (!recordEnv.success) throw new Error(recordEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      const userFields: Record<string, unknown> = {};
      for (const { name } of config.fields) {
        if (Object.prototype.hasOwnProperty.call(recordEnv.data.fields, name)) userFields[name] = recordEnv.data.fields[name];
      }
      setFormValues(userFields);
      setDetailValues({
        ...recordEnv.data.fields,
        id: recordEnv.data.individualId,
        individualId: recordEnv.data.individualId,
        title: item.title,
        revision: recordEnv.data.revision,
      });
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
      setDetailValues(null);
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
      if (!recordEnv.success) throw new Error(recordEnv.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      const env = await retireIndividual(classId, item.individualId, recordEnv.data.revision);
      if (!env.success) throw new Error(env.error ?? INDIVIDUALS_COPY.NEUTRAL_FALLBACK);
      setDetailValues(null);
      await refreshList(classId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleContractAction({ action, row }: ContractActionContext) {
    if (action.action_id === "individuals.create") {
      setFormValues({});
      setDetailValues(null);
      setFormMode({ kind: "create" });
      return;
    }
    if (action.action_id === "individuals.update" && action.placement === "detail") {
      await handleSave();
      return;
    }
    if (action.action_id === "individuals.update" && row) {
      const item = items.find((candidate) => candidate.individualId === row.id);
      if (item) await handleEdit(item);
      else setError(`${INDIVIDUALS_COPY.UNSUPPORTED_ACTION}${action.action_id}`);
      return;
    }
    if (action.action_id === "individuals.retire" && row) {
      const item = items.find((candidate) => candidate.individualId === row.id);
      if (item) await handleRetire(item);
      else setError(`${INDIVIDUALS_COPY.UNSUPPORTED_ACTION}${action.action_id}`);
      return;
    }
    setError(`${INDIVIDUALS_COPY.UNSUPPORTED_ACTION}${action.action_id}`);
  }

  return {
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
    handleEdit,
    handleSave,
    handleRetire,
    handleContractAction,
  };
}
