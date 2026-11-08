// DomainSubdomainEditor — master-detail editor for domains and their subdomains
// ADR-008 D1：词条对象形态（{id,label?,description?}）——label 随词条可编辑，写侧产出对象形态。
import { useState } from "react";
import { X, Plus, Trash2, Pencil, Check } from "lucide-react";
import type { DomainMap, SubdomainMap } from "./schema-manager-types";
import type { SubdomainEntry } from "./subdomain-entries";
import { TERM } from "@/constants/term-const";
import { DOMAIN_EDITOR_COPY } from "./schema-manager-copy";

interface DomainSubdomainEditorProps {
  domains: DomainMap;
  subdomains: SubdomainMap;
  categories: string[];
  policies: Record<string, { domain_id: string; allowed_categories: string[] }>;
  onDomainsChange: (domains: DomainMap) => void;
  onSubdomainsChange: (subdomains: SubdomainMap) => void;
  onPoliciesChange: (policies: Record<string, { domain_id: string; allowed_categories: string[] }>) => void;
  onSubdomainRename?: (from: string, to: string) => void;
  disabled?: boolean;
  selectedDomainId?: string;
  selectedSubdomain?: string;
  onSelectedSubdomainChange?: (subdomain?: string) => void;
  showDomainList?: boolean;
  onDomainCreated?: (domainId: string) => void;
}

export function DomainSubdomainEditor({
  domains,
  subdomains,
  categories,
  policies,
  onDomainsChange,
  onSubdomainsChange,
  onPoliciesChange,
  onSubdomainRename,
  disabled,
  selectedDomainId,
  selectedSubdomain,
  onSelectedSubdomainChange,
  showDomainList = true,
  onDomainCreated,
}: DomainSubdomainEditorProps) {
  const domainIds = Object.keys(domains);
  const [internalDomainId, setInternalDomainId] = useState<string>(domainIds[0] ?? "");
  const fallbackDomainId = domains[internalDomainId] ? internalDomainId : (domainIds[0] ?? "");
  const activeDomainId = selectedDomainId && domains[selectedDomainId]
    ? selectedDomainId
    : fallbackDomainId;
  const [newDomainId, setNewDomainId] = useState("");
  const [newDomainLabel, setNewDomainLabel] = useState("");
  const [newSubdomain, setNewSubdomain] = useState("");
  const [newSubdomainLabel, setNewSubdomainLabel] = useState("");

  // ── Domain editing state ──
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null);
  const [editDomainLabel, setEditDomainLabel] = useState("");

  // ── Subdomain editing state（id 与 label 两栏） ──
  const [editingSubIndex, setEditingSubIndex] = useState<number | null>(null);
  const [editSubValue, setEditSubValue] = useState("");
  const [editSubLabel, setEditSubLabel] = useState("");

  const addDomain = () => {
    const id = newDomainId.trim();
    const label = newDomainLabel.trim();
    if (!id || !label || domains[id]) return;
    onDomainsChange({ ...domains, [id]: label });
    onSubdomainsChange({ ...subdomains, [id]: [] });
    setInternalDomainId(id);
    onDomainCreated?.(id);
    setNewDomainId("");
    setNewDomainLabel("");
  };

  const removeDomain = (id: string) => {
    const next = { ...domains };
    delete next[id];
    onDomainsChange(next);
    const nextSub = { ...subdomains };
    delete nextSub[id];
    onSubdomainsChange(nextSub);
    if (internalDomainId === id) {
      const remaining = Object.keys(next);
      setInternalDomainId(remaining[0] ?? "");
    }
  };

  // ── Domain rename ──
  const startEditDomain = (id: string) => {
    setEditingDomainId(id);
    setEditDomainLabel(domains[id] ?? "");
  };

  const commitEditDomain = (id: string) => {
    const trimmed = editDomainLabel.trim();
    if (trimmed && trimmed !== domains[id]) {
      onDomainsChange({ ...domains, [id]: trimmed });
    }
    setEditingDomainId(null);
    setEditDomainLabel("");
  };

  const cancelEditDomain = () => {
    setEditingDomainId(null);
    setEditDomainLabel("");
  };

  // ── Subdomain rename（id 改名＋label 编辑同栏提交；label 独立变更不触发 rename 回调） ──
  const startEditSubdomain = (index: number) => {
    if (!activeDomainId) return;
    const entry = (subdomains[activeDomainId] ?? [])[index];
    if (!entry) return;
    setEditingSubIndex(index);
    setEditSubValue(entry.id);
    setEditSubLabel(entry.label ?? "");
  };

  const commitEditSubdomain = (index: number) => {
    if (!activeDomainId) return;
    const trimmedId = editSubValue.trim();
    const trimmedLabel = editSubLabel.trim();
    const current = [...(subdomains[activeDomainId] ?? [])];
    const previousEntry: SubdomainEntry | undefined = current[index];
    const previousValue = previousEntry?.id;
    if (!trimmedId || !previousEntry) return;
    const changedId = trimmedId !== previousEntry.id;
    if (changedId || trimmedLabel !== (previousEntry.label ?? "")) {
      current[index] = { ...previousEntry, id: trimmedId, ...(trimmedLabel ? { label: trimmedLabel } : {}) };
      if (!trimmedLabel) delete (current[index] as Partial<SubdomainEntry>).label;
      onSubdomainsChange({ ...subdomains, [activeDomainId]: current });
      if (changedId && previousValue) {
        onSubdomainRename?.(previousValue, trimmedId);
        if (selectedSubdomain === previousValue) onSelectedSubdomainChange?.(trimmedId);
      }
    }
    setEditingSubIndex(null);
    setEditSubValue("");
    setEditSubLabel("");
  };

  const cancelEditSubdomain = () => {
    setEditingSubIndex(null);
    setEditSubValue("");
    setEditSubLabel("");
  };

  const addSubdomain = () => {
    const trimmed = newSubdomain.trim();
    const trimmedLabel = newSubdomainLabel.trim();
    if (!trimmed || !activeDomainId) return;
    const current = subdomains[activeDomainId] ?? [];
    if (current.some((entry) => entry.id === trimmed)) return;
    onSubdomainsChange({ ...subdomains, [activeDomainId]: [...current, { id: trimmed, ...(trimmedLabel ? { label: trimmedLabel } : {}) }] });
    setNewSubdomain("");
    setNewSubdomainLabel("");
  };

  const removeSubdomain = (index: number) => {
    if (!activeDomainId) return;
    const current = subdomains[activeDomainId] ?? [];
    const removedSubdomain = current[index]?.id;
    onSubdomainsChange({
      ...subdomains,
      [activeDomainId]: current.filter((_, i) => i !== index),
    });
    if (selectedSubdomain === removedSubdomain) onSelectedSubdomainChange?.();
  };

  const currentSubs = activeDomainId ? (subdomains[activeDomainId] ?? []) : [];
  const selectedSubdomainIndex = selectedSubdomain ? currentSubs.findIndex((entry) => entry.id === selectedSubdomain) : -1;
  const visibleSubs = selectedSubdomainIndex >= 0
    ? [{ entry: currentSubs[selectedSubdomainIndex], index: selectedSubdomainIndex }]
    : currentSubs.map((entry, index) => ({ entry, index }));
  const policySubdomain = selectedSubdomainIndex >= 0 ? currentSubs[selectedSubdomainIndex]?.id : undefined;
  const normalizedPolicies = policies || {};
  const activePolicy = policySubdomain ? (normalizedPolicies[policySubdomain] || { domain_id: activeDomainId, allowed_categories: [] }) : null;
  const toggleCategory = (category: string) => {
    if (!policySubdomain || !activePolicy) return;
    const allowed = activePolicy.allowed_categories.includes(category)
      ? activePolicy.allowed_categories.filter((item) => item !== category)
      : [...activePolicy.allowed_categories, category];
    onPoliciesChange({ ...normalizedPolicies, [policySubdomain]: { domain_id: activeDomainId, allowed_categories: allowed } });
  };

  return (
    <section aria-label={DOMAIN_EDITOR_COPY.SECTION_ARIA} className="space-y-3">
      <div className="flex gap-4">
        {/* Left: Domain list */}
        {showDomainList && <div className="w-56 shrink-0 space-y-2">
          {domainIds.map((id) => (
            <div
              key={id}
              className={`group rounded-lg ring-1 ring-border-thin transition-colors ${
                activeDomainId === id
                  ? "bg-accent-bg ring-1 ring-accent-base/30"
                  : "ring-1 ring-border-thin hover:bg-surface-hover/70"
              }`}
            >
              {editingDomainId === id ? (
                // ── Domain edit mode ──
                <div className="flex items-center gap-1 p-2">
                  <input
                    type="text"
                    value={editDomainLabel}
                    onChange={(e) => setEditDomainLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEditDomain(id);
                      if (e.key === "Escape") cancelEditDomain();
                    }}
                    autoFocus
                    disabled={disabled}
                    className="flex-1 rounded ring-1 ring-accent-base bg-surface-card px-2 py-1 text-sm text-text-main focus:outline-none"
                  />
                  <button
                    onClick={() => commitEditDomain(id)}
                    disabled={disabled || !editDomainLabel.trim()}
                    className="text-status-fact hover:text-jade-11"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={cancelEditDomain} className="text-text-hint hover:text-text-sub">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                // ── Domain display mode ──
                <button
                  onClick={() => setInternalDomainId(id)}
                  className="w-full px-3 py-2 text-left text-sm"
                >
                  <div
                    className={`font-medium ${
                      activeDomainId === id ? "text-accent-base" : "text-text-sub group-hover:text-text-main/80"
                    }`}
                  >
                    {domains[id]}
                  </div>
                  <div className="text-xs text-text-hint">{id}</div>
                </button>
              )}
              {/* Actions — always visible in active state, hover in inactive */}
              {!disabled && editingDomainId !== id && (
                <div
                  className={`flex items-center justify-end gap-1 px-2 pb-2 ${
                    activeDomainId === id ? "" : "opacity-0 group-hover:opacity-100"
                  } transition-opacity`}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); startEditDomain(id); }}
                    className="text-text-hint hover:text-text-main/80"
                    title={DOMAIN_EDITOR_COPY.RENAME_TITLE}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeDomain(id); }}
                    className="text-text-hint hover:text-red-11"
                    title={DOMAIN_EDITOR_COPY.DELETE_DOMAIN_TITLE}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {!disabled && (
            <div className="space-y-2 rounded-lg border border-dashed border-border-thin bg-surface-card/80 p-3">
              <input
                type="text"
                value={newDomainId}
                onChange={(e) => setNewDomainId(e.target.value)}
                placeholder={DOMAIN_EDITOR_COPY.NEW_DOMAIN_ID_PLACEHOLDER}
                disabled={disabled}
                className="w-full rounded-lg ring-1 ring-border-thin bg-surface-card px-3 py-2 text-sm text-text-main placeholder:text-text-placeholder focus:ring-1 focus:ring-accent-base focus:outline-none"
              />
              <input
                type="text"
                value={newDomainLabel}
                onChange={(e) => setNewDomainLabel(e.target.value)}
                placeholder={DOMAIN_EDITOR_COPY.NEW_DOMAIN_LABEL_PLACEHOLDER}
                disabled={disabled}
                onKeyDown={(e) => { if (e.key === "Enter") addDomain(); }}
                className="w-full rounded-lg ring-1 ring-border-thin bg-surface-card px-3 py-2 text-sm text-text-main placeholder:text-text-placeholder focus:ring-1 focus:ring-accent-base focus:outline-none"
              />
              <button
                onClick={addDomain}
                disabled={disabled || !newDomainId.trim() || !newDomainLabel.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-main/80 hover:bg-surface-root disabled:opacity-40 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {DOMAIN_EDITOR_COPY.ADD_DOMAIN}
              </button>
            </div>
          )}
        </div>}

        {/* Right: Subdomain detail */}
        <div className="flex-1 space-y-3">
          {activeDomainId ? (
            <>
              {!showDomainList && (
                <div className="rounded-lg bg-surface-root/40 p-4 ring-1 ring-border-thin">
                  {editingDomainId === activeDomainId ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editDomainLabel}
                        onChange={(event) => setEditDomainLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitEditDomain(activeDomainId);
                          if (event.key === "Escape") cancelEditDomain();
                        }}
                        autoFocus
                        className="flex-1 rounded-md bg-surface-card px-3 py-2 text-sm text-text-main ring-1 ring-accent-base focus:outline-none"
                      />
                      <button onClick={() => commitEditDomain(activeDomainId)} title={DOMAIN_EDITOR_COPY.CONFIRM_RENAME_TITLE} className="text-status-fact"><Check className="h-4 w-4" /></button>
                      <button onClick={cancelEditDomain} title={DOMAIN_EDITOR_COPY.CANCEL_RENAME_TITLE} className="text-text-hint"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-text-main">{domains[activeDomainId]}</div>
                        <div className="text-xs text-text-hint">{activeDomainId}</div>
                      </div>
                      {!disabled && <div className="flex items-center gap-2">
                        <button onClick={() => startEditDomain(activeDomainId)} title={DOMAIN_EDITOR_COPY.RENAME_CATEGORY_TITLE} className="text-text-hint hover:text-text-main"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => removeDomain(activeDomainId)} title={DOMAIN_EDITOR_COPY.DELETE_CATEGORY_TITLE} className="text-text-hint hover:text-red-11"><Trash2 className="h-4 w-4" /></button>
                      </div>}
                    </div>
                  )}
                </div>
              )}
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-hint">
                {DOMAIN_EDITOR_COPY.SUBDOMAIN_HEADER}{domains[activeDomainId]} <span className="text-text-placeholder">({activeDomainId})</span>
              </h4>
              <div className="flex flex-col gap-1">
                {visibleSubs.map(({ entry: sub, index: i }) =>
                  editingSubIndex === i ? (
                    // ── Subdomain edit mode（id＋label 双栏） ──
                    <div
                      key={`edit-${i}`}
                      className="flex items-center gap-2 rounded-lg ring-1 ring-accent-base bg-surface-card px-3 py-2"
                    >
                      <input
                        type="text"
                        value={editSubValue}
                        onChange={(e) => setEditSubValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEditSubdomain(i);
                          if (e.key === "Escape") cancelEditSubdomain();
                        }}
                        autoFocus
                        disabled={disabled}
                        aria-label={DOMAIN_EDITOR_COPY.SUBDOMAIN_ID_ARIA}
                        className="w-40 bg-transparent text-sm text-text-main focus:outline-none"
                      />
                      <input
                        type="text"
                        value={editSubLabel}
                        onChange={(e) => setEditSubLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEditSubdomain(i);
                          if (e.key === "Escape") cancelEditSubdomain();
                        }}
                        disabled={disabled}
                        aria-label={DOMAIN_EDITOR_COPY.SUBDOMAIN_LABEL_ARIA}
                        placeholder={DOMAIN_EDITOR_COPY.SUBDOMAIN_LABEL_PLACEHOLDER}
                        className="flex-1 bg-transparent text-sm text-text-sub placeholder:text-text-placeholder focus:outline-none"
                      />
                      <button
                        onClick={() => commitEditSubdomain(i)}
                        disabled={disabled || !editSubValue.trim()}
                        className="text-status-fact hover:text-jade-11 shrink-0"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={cancelEditSubdomain} className="text-text-hint hover:text-text-sub shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    // ── Subdomain display mode（label 缺省回落 id；无 label 时提示补齐） ──
                    <div
                      key={`${sub.id}-${i}`}
                      className="group flex items-center justify-between rounded-lg ring-1 ring-border-thin bg-surface-card/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover transition-colors"
                    >
                      <span className="truncate">
                        {sub.label ? (
                          <>{sub.label} <span className="text-xs text-text-hint">{sub.id}</span></>
                        ) : (
                          <>{sub.id} <span className="text-xs text-text-placeholder">{DOMAIN_EDITOR_COPY.MISSING_LABEL_HINT}</span></>
                        )}
                      </span>
                      {!disabled && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
                          <button
                            onClick={() => startEditSubdomain(i)}
                            className="text-text-placeholder hover:text-text-sub"
                            title={DOMAIN_EDITOR_COPY.EDIT_TITLE}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => removeSubdomain(i)}
                            className="text-text-hint hover:text-red-11"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ),
                )}
                {visibleSubs.length === 0 && (
                  <p className="text-sm text-text-placeholder py-2">{TERM.EMPTY_SUBDOMAIN}</p>
                )}
              </div>
              {policySubdomain && activePolicy && (
                <fieldset className="rounded-md bg-surface-root/40 p-3 ring-1 ring-border-thin">
                  <legend className="px-1 text-xs font-medium text-text-sub">{DOMAIN_EDITOR_COPY.POLICY_LEGEND}</legend>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {categories.map((category) => <label key={category} className="flex items-center gap-1.5 text-xs text-text-main"><input type="checkbox" checked={activePolicy.allowed_categories.includes(category)} disabled={disabled} onChange={() => toggleCategory(category)} />{category}</label>)}
                  </div>
                  {categories.length === 0 && <p className="text-xs text-text-hint">{DOMAIN_EDITOR_COPY.POLICY_EMPTY_HINT}</p>}
                </fieldset>
              )}
              {!disabled && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newSubdomain}
                    onChange={(e) => setNewSubdomain(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addSubdomain(); }}
                    placeholder={DOMAIN_EDITOR_COPY.NEW_SUBDOMAIN_ID_PLACEHOLDER}
                    disabled={disabled}
                    className="w-40 rounded-lg ring-1 ring-border-thin bg-surface-card px-3 py-2 text-sm text-text-main placeholder:text-text-placeholder focus:ring-1 focus:ring-accent-base focus:outline-none"
                  />
                  <input
                    type="text"
                    value={newSubdomainLabel}
                    onChange={(e) => setNewSubdomainLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addSubdomain(); }}
                    placeholder={DOMAIN_EDITOR_COPY.SUBDOMAIN_LABEL_PLACEHOLDER}
                    disabled={disabled}
                    className="w-48 rounded-lg ring-1 ring-border-thin bg-surface-card px-3 py-2 text-sm text-text-sub placeholder:text-text-placeholder focus:ring-1 focus:ring-accent-base focus:outline-none"
                  />
                  <button
                    onClick={addSubdomain}
                    disabled={disabled || !newSubdomain.trim()}
                    className="flex items-center gap-1.5 rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-main/80 hover:bg-surface-root disabled:opacity-40 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    {DOMAIN_EDITOR_COPY.ADD_ACTION}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-text-placeholder">{DOMAIN_EDITOR_COPY.EMPTY_DOMAIN_HINT}</p>
          )}
        </div>
      </div>
    </section>
  );
}
