// SkeletonSidebar — 骨架管理页面内嵌业务目录
import { useState, useCallback } from "react";
import { SKELETON_COPY } from "./schema-manager-copy";
import { ChevronDown } from "lucide-react";
import type { ClassificationSelection } from "./skeleton-sidebar-types";
import type { DomainMap, SubdomainMap } from "./schema-manager-types";

interface Props {
  activeSelection: ClassificationSelection;
  domains: DomainMap;
  subdomains: SubdomainMap;
  onSelect: (selection: ClassificationSelection) => void;
  onAddDomain: (id: string, label: string) => void;
  disabled?: boolean;
}

export function SkeletonSidebar({ activeSelection, domains, subdomains, onSelect, onAddDomain, disabled }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newDomainId, setNewDomainId] = useState("");
  const [newDomainLabel, setNewDomainLabel] = useState("");
  const toggle = useCallback((n: string) => setCollapsed(p => ({ ...p, [n]: !p[n] })), []);
  const addDomain = () => {
    const id = newDomainId.trim();
    const label = newDomainLabel.trim();
    if (!id || !label || domains[id]) return;
    onAddDomain(id, label);
    setNewDomainId("");
    setNewDomainLabel("");
  };

  return (
    <aside
      aria-label={SKELETON_COPY.NAV_ARIA}
      data-testid="schema-local-sidebar"
      className="w-[220px] shrink-0 flex flex-col bg-surface-root/40 border-r border-border-thin overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-4">
        <div className="px-2 py-1 space-y-3">
          {Object.entries(domains).map(([domainId, domainLabel]) => {
            const c = collapsed[domainId] ?? false;
            const domainActive = activeSelection.domainId === domainId && !activeSelection.subdomain;
            return (
              <div key={domainId}>
                <button
                  onClick={() => {
                    onSelect({ domainId });
                    toggle(domainId);
                  }}
                  className={`w-full flex items-center gap-1 px-3 py-0.5 text-left ${domainActive ? "text-text-main font-medium" : ""}`}
                >
                  <ChevronDown className={`h-3 w-3 text-text-hint shrink-0 transition-transform duration-[var(--duration-base)] ${c ? "-rotate-90" : "rotate-0"}`} />
                  <span className="text-xs font-medium text-text-placeholder uppercase tracking-wider">{domainLabel}</span>
                </button>
                {!c && (
                  <div className="mt-0.5 space-y-0.5">
                    {(subdomains[domainId] ?? []).map(entry => {
                      // ADR-008 D1：词条对象（label 缺省回落 id）
                      const subdomain = entry.id;
                      const active = activeSelection.domainId === domainId && activeSelection.subdomain === subdomain;
                      return (
                        <button key={subdomain} onClick={() => onSelect({ domainId, subdomain })}
                          className={`w-full px-3 py-1.5 rounded-r-lg text-sm text-left transition-all duration-[var(--duration-base)] ${
                            active ? "bg-surface-hover text-text-main border-l border-l-accent-base pl-[11px]"
                                   : "text-text-sub hover:bg-surface-hover hover:text-text-main hover:-translate-y-px"
                          }`}
                        >{entry.label || subdomain}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-border-thin p-3">
        <div className="mb-2 text-xs font-medium text-text-hint">{SKELETON_COPY.ADD_GROUP_TITLE}</div>
        <div className="space-y-2">
          <input value={newDomainId} onChange={(event) => setNewDomainId(event.target.value)} placeholder={SKELETON_COPY.NEW_ID_PLACEHOLDER} disabled={disabled} className="w-full rounded-md bg-surface-card px-2 py-1.5 text-xs text-text-main ring-1 ring-border-thin placeholder:text-text-hint focus:outline-none focus:ring-accent-base" />
          <input value={newDomainLabel} onChange={(event) => setNewDomainLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addDomain(); }} placeholder={SKELETON_COPY.NEW_LABEL_PLACEHOLDER} disabled={disabled} className="w-full rounded-md bg-surface-card px-2 py-1.5 text-xs text-text-main ring-1 ring-border-thin placeholder:text-text-hint focus:outline-none focus:ring-accent-base" />
          <button onClick={addDomain} disabled={disabled || !newDomainId.trim() || !newDomainLabel.trim()} className="flex w-full items-center justify-center rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-sub transition-colors hover:text-text-main disabled:opacity-40">{SKELETON_COPY.ADD_DOMAIN_ACTION}</button>
        </div>
      </div>
    </aside>
  );
}
