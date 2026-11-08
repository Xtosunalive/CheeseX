import { useState, useMemo } from "react";
import type { TaxonomyNode } from "@/lib/topology-types";
import { useTaxonomyFocus, useNodeHighlight } from "@/lib/dashboard-ui-store";
import { TERM } from "@/constants/term-const";
import {
  SidebarShell,
  SidebarHeader,
  ParentNodeCard,
  LeafNodeRow,
  Pill,
} from "@/components/app-shell/sidebar-primitives";
import { taxonomyDocCountTitle } from "@/features/data-dashboard/data-dashboard-copy";

export function TaxonomySidebar({ tree }: { tree: TaxonomyNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { setHoveredTaxon, setFocusedTaxon, focusedTaxonId } = useTaxonomyFocus();
  const { highlightNodeIds } = useNodeHighlight();

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalEntities = tree.reduce((s, d) => s + (d.children ?? []).reduce((ss, c) => ss + (c.entityCount ?? 0), 0), 0);

  // ── Link-path highlight: when a node is clicked in the topology, highlight the
  // subdomains that the link path (node + neighbors) touches, dim the rest. ──
  // Does NOT filter — only highlights. Auto-expands domains containing path nodes.
  const pathActive = highlightNodeIds !== null && highlightNodeIds.size > 0;

  const subdomainOnPath = useMemo(() => {
    if (!pathActive) return new Set<string>();
    const ids = highlightNodeIds!;
    const touched = new Set<string>();
    function walk(nodes: TaxonomyNode[]) {
      for (const n of nodes) {
        if (n.entityIds?.some((eid) => ids.has(eid))) touched.add(n.id);
        if (n.children) walk(n.children);
      }
    }
    walk(tree);
    return touched;
  }, [pathActive, highlightNodeIds, tree]);

  const domainOnPath = useMemo(() => {
    if (!pathActive) return new Set<string>();
    const touched = new Set<string>();
    for (const d of tree) {
      if ((d.children ?? []).some((c) => subdomainOnPath.has(c.id))) touched.add(d.id);
    }
    return touched;
  }, [pathActive, subdomainOnPath, tree]);

  return (
    <SidebarShell>
      <SidebarHeader
        title={TERM.DOMAIN}
        count={totalEntities}
        accent="blue"
        onClear={focusedTaxonId ? () => setFocusedTaxon(null) : undefined}
      />

      <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5">
        {tree.map(domain => {
          const isCollapsed = collapsed.has(domain.id);
          // Auto-expand domains on the link path so the highlighted subdomain is visible.
          const isOpen = isCollapsed ? pathActive && domainOnPath.has(domain.id) : true;
          const childEntitySum = (domain.children ?? []).reduce((s, c) => s + (c.entityCount ?? 0), 0);
          const activeChild = (domain.children ?? []).find(c => c.id === focusedTaxonId);
          const isFocused = activeChild !== undefined;
          const domainOnPathFlag = pathActive && domainOnPath.has(domain.id);
          const domainDimmed = pathActive && !domainOnPathFlag;

          return (
            <ParentNodeCard
              key={domain.id}
              accent="blue"
              open={isOpen}
              onToggle={() => toggle(domain.id)}
              focused={isFocused}
              onPath={domainOnPathFlag}
              dimmed={domainDimmed}
              label={domain.label}
              badge={childEntitySum > 0 ? <Pill tone="accent">{childEntitySum}</Pill> : undefined}
            >
              {(domain.children ?? []).map(child => {
                const active = focusedTaxonId === child.id;
                const warn = (child.docCount ?? 0) > 0 && (child.entityCount ?? 0) === 0;
                const childOnPath = pathActive && subdomainOnPath.has(child.id);
                const childDimmed = pathActive && !childOnPath;
                return (
                  <LeafNodeRow
                    key={child.id}
                    accent="blue"
                    active={active}
                    onPath={childOnPath}
                    dimmed={childDimmed}
                    warn={warn}
                    onClick={() => setFocusedTaxon(active ? null : child.id)}
                    onMouseEnter={() => setHoveredTaxon(child.id)}
                    onMouseLeave={() => setHoveredTaxon(null)}
                    label={child.label}
                    trailing={
                      <>
                        {(child.entityCount ?? 0) > 0 && <Pill tone="accent">{child.entityCount}</Pill>}
                        {(child.docCount ?? 0) > 0 && <Pill tone="muted" title={taxonomyDocCountTitle(child.docCount ?? 0)}>{child.docCount}D</Pill>}
                      </>
                    }
                  />
                );
              })}
            </ParentNodeCard>
          );
        })}
      </div>
    </SidebarShell>
  );
}
