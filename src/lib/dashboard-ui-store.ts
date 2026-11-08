// Dashboard UI-only stores — taxonomy focus, band focus, node highlight.
// Migrated from dashboard-store.ts (Phase 0 store breakup).
// These are pure UI interaction state and do NOT hold business data.

import { create } from "zustand";

// ── Taxonomy focus state (left sidebar → right graph) ──
interface TaxonomyFocusStore {
  hoveredTaxonId: string | null;
  focusedTaxonId: string | null;
  setHoveredTaxon: (id: string | null) => void;
  setFocusedTaxon: (id: string | null) => void;
}
export const useTaxonomyFocus = create<TaxonomyFocusStore>((set) => ({
  hoveredTaxonId: null,
  focusedTaxonId: null,
  setHoveredTaxon: (id) => set({ hoveredTaxonId: id }),
  setFocusedTaxon: (id) => set({ focusedTaxonId: id }),
}));

// ── Band focus state (right sidebar → graph) — structural axis, orthogonal to taxonomy ──
// Both axes use the SAME semantics for symmetry:
//   - HOVER (hoveredTaxonId / hoveredBandId): temporary preview, dims non-matching entities
//     but does NOT remove them from the topology.
//   - FOCUS/CLICK (focusedTaxonId / focusedBandId): real filter, removes non-matching entities
//     from displayNodes entirely.
// When both axes have a focus, displayNodes is the INTERSECTION (entities in the focused
// taxon AND the focused band). Hover overlays on top of whatever is displayed.
interface BandFocusStore {
  hoveredBandId: string | null;
  focusedBandId: string | null;
  setHoveredBand: (id: string | null) => void;
  setFocusedBand: (id: string | null) => void;
}
export const useBandFocus = create<BandFocusStore>((set) => ({
  hoveredBandId: null,
  focusedBandId: null,
  setHoveredBand: (id) => set({ hoveredBandId: id }),
  setFocusedBand: (id) => set({ focusedBandId: id }),
}));

// ── Node highlight (topology graph → sidebars) — link/path highlight ──
// When a node is clicked in the topology graph, this holds the clicked node + its one-hop
// neighbors (the "link path"). The sidebars read this to highlight which taxon subdomains
// and which bands the link path touches, dimming the rest. This is a third dimension,
// independent of the taxonomy/band hover/focus filters — it does NOT filter displayNodes,
// it only highlights. Cleared when the node is clicked again (toggle off).
interface NodeHighlightStore {
  highlightNodeIds: Set<string> | null;
  setHighlightNodeIds: (ids: Set<string> | null) => void;
}
export const useNodeHighlight = create<NodeHighlightStore>((set) => ({
  highlightNodeIds: null,
  setHighlightNodeIds: (ids) => set({ highlightNodeIds: ids }),
}));

// ── Selectors ──

export function useHighlightNodeIds() {
  return useNodeHighlight((s) => s.highlightNodeIds);
}

export function useSetHighlightNodeIds() {
  return useNodeHighlight((s) => s.setHighlightNodeIds);
}
