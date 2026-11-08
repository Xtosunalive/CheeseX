import { useState, useMemo } from "react";
import type { TopoNode } from "@/lib/topology-types";
import { CONTAINERS, assignContainer } from "@/lib/dashboard-containers";
import { useBandFocus, useNodeHighlight } from "@/lib/dashboard-ui-store";
import { useGapItems } from "@/lib/topology-store";
import { TERM } from "@/constants/term-const";
import {
  SidebarShell,
  SidebarHeader,
  ParentNodeCard,
  LeafNodeRow,
  Pill,
  EmptyLeaf,
} from "@/components/app-shell/sidebar-primitives";
import { BAND_STACK_COPY, bandWarnTitle } from "@/features/data-dashboard/data-dashboard-copy";

/**
 * BandStack — the structural axis, visually paired with the taxonomy tree.
 *
 * Left sidebar (TaxonomySidebar) = classification axis (business domain → subdomain → entity).
 * This right sidebar = structural axis (gateway → service → storage → infra → security),
 * ordered by band `order` (top = highest layer). The two axes share the same entity set
 * but partition it two different ways; clicking a band filters the topology graph to that
 * band (intersection with any focused taxon).
 *
 * When a node is clicked in the topology, useNodeHighlight publishes the link-path node set
 * (node + one-hop neighbors). BandStack highlights the bands that path touches and dims the
 * rest — so you can see which layers a link path spans at a glance.
 *
 * The two sidebars share the same physical base (SidebarShell) + card-tree grammar so they
 * render pixel-mirrored. Band colors are demoted from heavy saturated blocks to a leading
 * dot + right-aligned minimalist pills; governance warnings become a pulsing dot + warn pill.
 */
export function BandStack({ nodes }: { nodes: TopoNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { focusedBandId, setFocusedBand, setHoveredBand } = useBandFocus();
  const { highlightNodeIds } = useNodeHighlight();
  const gaps = useGapItems();

  // Per-node warning count (governance gaps), keyed by targetId — mirrors tree-table semantics.
  const warnCountByNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gaps) m.set(g.targetId, (m.get(g.targetId) ?? 0) + 1);
    return m;
  }, [gaps]);

  // Group nodes by container id, keeping CONTAINERS order (gateway → ... → unknown).
  const bands = useMemo(() => {
    const buckets = new Map<string, TopoNode[]>();
    for (const n of nodes) {
      const cid = assignContainer(n);
      const list = buckets.get(cid) ?? [];
      list.push(n);
      buckets.set(cid, list);
    }
    return CONTAINERS.map((c) => ({
      container: c,
      nodes: buckets.get(c.id) ?? [],
    }));
  }, [nodes]);

  const totalEntities = nodes.length;
  const populatedCount = bands.filter((b) => b.nodes.length > 0).length;

  // ── Link-path highlight: which bands does the clicked node's link path touch? ──
  const pathActive = highlightNodeIds !== null && highlightNodeIds.size > 0;
  const bandOnPath = useMemo(() => {
    if (!pathActive) return new Set<string>();
    const ids = highlightNodeIds!;
    const touched = new Set<string>();
    for (const n of nodes) {
      if (ids.has(n.id)) touched.add(assignContainer(n));
    }
    return touched;
  }, [pathActive, highlightNodeIds, nodes]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <SidebarShell>
      <SidebarHeader
        title={TERM.LAYER}
        count={totalEntities}
        accent="green"
        onClear={focusedBandId ? () => setFocusedBand(null) : undefined}
      />

      <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5">
        {bands.map(({ container, nodes: bandNodes }) => {
          const isFocused = focusedBandId === container.id;
          const isCollapsed = collapsed.has(container.id);
          const st = container.styleToken;
          const empty = bandNodes.length === 0;
          const onPath = pathActive && bandOnPath.has(container.id);
          const dimmed = pathActive && !onPath;
          // Warning count for the whole band = sum of its entities' gap counts.
          const bandWarnCount = bandNodes.reduce((s, n) => s + (warnCountByNode.get(n.id) ?? 0), 0);

          return (
            <ParentNodeCard
              key={container.id}
              accent="green"
              open={!isCollapsed}
              onToggle={() => toggle(container.id)}
              onFocus={() => setFocusedBand(isFocused ? null : container.id)}
              focused={isFocused}
              onPath={onPath}
              dimmed={dimmed || (empty && !pathActive)}
              label={
                <span style={{ color: onPath ? "var(--color-chart-4)" : st.labelColor }}>
                  {container.displayName}
                </span>
              }
              badge={
                <>
                  {/* Band order — minimalist right-aligned pill, replaces the colored left-border bar */}
                  <Pill tone="muted" title={BAND_STACK_COPY.ORDER_TITLE}>
                    {container.order >= 99 ? "—" : `band ${container.order}`}
                  </Pill>
                  {bandNodes.length > 0 && <Pill tone="accent">{bandNodes.length}</Pill>}
                  {bandWarnCount > 0 && <Pill tone="warn" title={bandWarnTitle(bandWarnCount)}>{bandWarnCount} {TERM.WARNING}</Pill>}
                </>
              }
            >
              {empty ? (
                <EmptyLeaf />
              ) : (
                bandNodes.map((n) => {
                  const nodeWarn = warnCountByNode.get(n.id) ?? 0;
                  const nodeOnPath = pathActive && highlightNodeIds!.has(n.id);
                  const nodeDimmed = pathActive && !highlightNodeIds!.has(n.id);
                  return (
                    <LeafNodeRow
                      key={n.id}
                      accent="green"
                      onPath={nodeOnPath}
                      dimmed={nodeDimmed}
                      warn={nodeWarn > 0}
                      onMouseEnter={() => setHoveredBand(container.id)}
                      onMouseLeave={() => setHoveredBand(null)}
                      dotColor={nodeOnPath ? "var(--color-chart-4)" : st.labelColor}
                      label={n.label}
                      trailing={
                        nodeWarn > 0 ? (
                          <Pill tone="warn" title={bandWarnTitle(nodeWarn)}>{nodeWarn}</Pill>
                        ) : undefined
                      }
                    />
                  );
                })
              )}
            </ParentNodeCard>
          );
        })}

        {/* Footer hint */}
        <div className="px-3 py-2 mt-1 border-t border-border-thin/50">
          <span className="text-kg-xs font-mono text-text-placeholder">
            {populatedCount}/{bands.length} {BAND_STACK_COPY.FOOTER_SUFFIX}
          </span>
        </div>
      </div>
    </SidebarShell>
  );
}
