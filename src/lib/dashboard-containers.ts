// Dashboard container definitions & band grouping logic.
// Ported from Obsidian scatter-plot complementary governance layer contract.
//
// Pure business rules only — no geometry. The SVG canvas layout functions
// (computeContainerLayout / computeGravityPositions) were removed when the
// topology view moved to a tree-table renderer. What remains is the
// arch_layer → container assignment rule (single source of truth — Rule 13)
// and the cross-container edge detector, both consumed by the tree table.
import type { TopoNode, TopoEdge, ContainerDef } from "@/features/dashboard/dashboard-types";
import { BAND_DISPLAY_NAMES } from "./lib-copy";
import { ENTITY_CATEGORY } from "./domain/EntityCategory";

/** arch_layer → container assignment map (single source of truth — Rule 13) */
const LAYER_CONTAINER_MAP: Record<string, string> = {
  "gateway-band": "container_gateway",
  gateway: "container_gateway",
  "service-band": "container_service",
  service: "container_service",
  "storage-band": "container_storage",
  storage: "container_storage",
  "infrastructure-band": "container_infra",
  infrastructure: "container_infra",
  "security-band": "container_security",
  "endpoint-band": "container_endpoint",
};

/**
 * Container definitions — one per architecture layer (physical defense zone, not category tag).
 * `order` defines the vertical band sequence (top → bottom) and is used by the tree table
 * for both sorting and reverse-dependency detection (source.order > target.order = reverse).
 */
export const CONTAINERS: ContainerDef[] = [
  {
    id: "container_gateway",
    displayName: BAND_DISPLAY_NAMES.container_gateway,
    order: 1,
    categories: [],
    styleToken: { borderColor: "var(--color-slate-9)", bgColor: "color-mix(in srgb, var(--color-slate-9) 6%, transparent)", labelColor: "var(--color-slate-10)", dashed: true },
  },
  {
    id: "container_service",
    displayName: BAND_DISPLAY_NAMES.container_service,
    order: 2,
    categories: [],
    styleToken: { borderColor: "var(--color-cyan-9)", bgColor: "color-mix(in srgb, var(--color-cyan-9) 6%, transparent)", labelColor: "var(--loading-cyan)", dashed: true },
  },
  {
    id: "container_storage",
    displayName: BAND_DISPLAY_NAMES.container_storage,
    order: 3,
    categories: [],
    styleToken: { borderColor: "var(--color-amber-11)", bgColor: "color-mix(in srgb, var(--color-amber-11) 6%, transparent)", labelColor: "var(--color-amber-10)", dashed: true },
  },
  {
    id: "container_infra",
    displayName: BAND_DISPLAY_NAMES.container_infra,
    order: 4,
    categories: [],
    styleToken: { borderColor: "var(--color-iris-9)", bgColor: "color-mix(in srgb, var(--color-iris-9) 6%, transparent)", labelColor: "var(--color-iris-10)", dashed: true },
  },
  {
    id: "container_security",
    displayName: BAND_DISPLAY_NAMES.container_security,
    order: 5,
    categories: [],
    styleToken: { borderColor: "var(--error-rose)", bgColor: "color-mix(in srgb, var(--error-rose) 4%, transparent)", labelColor: "var(--color-ruby-10)", dashed: true },
  },
  {
    id: "container_unknown",
    displayName: BAND_DISPLAY_NAMES.container_unknown,
    order: 99,
    categories: [],
    styleToken: { borderColor: "var(--color-gray-10)", bgColor: "color-mix(in srgb, var(--color-gray-10) 5%, transparent)", labelColor: "var(--color-gray-10)", dashed: true },
  },
];

const CONTAINER_BY_ID = new Map(CONTAINERS.map((c) => [c.id, c]));

/** Category fallback when arch_layer is missing (legacy entities without arch metadata). */
const CATEGORY_FALLBACK_MAP: Record<string, string> = {
  [ENTITY_CATEGORY.SERVICE]: "service",
  [ENTITY_CATEGORY.STORAGE]: "storage",
  [ENTITY_CATEGORY.INFRASTRUCTURE]: "infrastructure",
  [ENTITY_CATEGORY.SECURITY]: "security",
  [ENTITY_CATEGORY.TERMINAL]: "endpoint",
};

/**
 * Assign a node to its container by arch_layer (physical defense zone).
 * Falls back to category-based matching, then to container_unknown.
 */
export function assignContainer(node: TopoNode): string {
  const layer = (node.properties?.arch_layer as string) || "";
  if (layer && LAYER_CONTAINER_MAP[layer]) return LAYER_CONTAINER_MAP[layer];
  // Fallback: map category to layer, then to container
  const fallbackLayer = CATEGORY_FALLBACK_MAP[node.category] || "";
  if (fallbackLayer && LAYER_CONTAINER_MAP[fallbackLayer]) return LAYER_CONTAINER_MAP[fallbackLayer];
  return "container_unknown";
}

/** Band order for a container id (lower = higher in stack). Unknown → 99. */
export function getContainerOrder(containerId: string): number {
  return CONTAINER_BY_ID.get(containerId)?.order ?? 99;
}

/** Container definition lookup by id. */
export function getContainerDef(containerId: string): ContainerDef | undefined {
  return CONTAINER_BY_ID.get(containerId);
}

/**
 * Group nodes by their assigned container, returning containers in band order
 * (gateway → service → storage → infra → security → unknown). Empty containers
 * are excluded — only bands that actually contain nodes appear in the tree.
 */
export function groupNodesByContainer(nodes: TopoNode[]): Array<{ container: ContainerDef; nodes: TopoNode[] }> {
  const buckets = new Map<string, TopoNode[]>();
  for (const n of nodes) {
    const cid = assignContainer(n);
    const list = buckets.get(cid) ?? [];
    list.push(n);
    buckets.set(cid, list);
  }

  return CONTAINERS.filter((c) => buckets.has(c.id)).map((c) => ({
    container: c,
    nodes: buckets.get(c.id)!,
  }));
}

/**
 * Determine which edges cross container boundaries.
 * A cross-band edge is one whose source and target live in different containers.
 * Used by the tree table to render ↗/↘ direction markers on dependency capsules.
 */
export function computeCrossContainerEdges(
  edges: TopoEdge[],
  nodeContainerMap: Map<string, string>,
): Array<{ source: string; target: string }> {
  return edges
    .filter((e) => {
      const sC = nodeContainerMap.get(e.source);
      const tC = nodeContainerMap.get(e.target);
      return sC && tC && sC !== tC;
    })
    .map((e) => ({ source: e.source, target: e.target }));
}

/** Build nodeId → containerId map */
export function buildNodeContainerMap(nodes: TopoNode[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodes) m.set(n.id, assignContainer(n));
  return m;
}
