// Topology data store — single source of truth for graph topology, stats, gaps, and active entity.
// Migrated from features/dashboard/dashboard-store.ts (Phase 0 store breakup).
// Import from here instead of @/features/dashboard/dashboard-store for data selectors.

import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { DashboardApiError, fetchTopology } from "@/features/dashboard/dashboard-api";
import { GraphAdmissionService } from "@/lib/domain";
import type { TopoNode, TopoEdge, ScopeMode, TopologyStats } from "./topology-types";
import type { GapItem } from "@/features/gap-engine/gap-types";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { LIB_REQUEST_COPY } from "./lib-copy";

interface TopologyStore {
  // Scope
  scope: ScopeMode;
  setScope: (s: ScopeMode) => void;

  // Filtered data (post-admission — only ArchitectureComponent / Module nodes)
  admittedNodes: TopoNode[];
  admittedEdges: TopoEdge[];

  // Full knowledge graph data (includes Document nodes and DOCUMENTS/REFERENCES edges)
  knowledgeNodes: TopoNode[];
  knowledgeEdges: TopoEdge[];

  // Raw stats from API response (totalNodes, dataFreshness, etc.)
  stats: TopologyStats | null;


  // Governance gaps from gap-engine.cjs (backend already filters resolved/ignored)
  gaps: GapItem[];

  // 实体全景使用的全局当前实体上下文
  activeEntityId: string | null;
  setActiveEntityId: (id: string | null) => void;

  // Meta（主请求＝拓扑加载；errorCode 为 error 的伴生码，随 requestFailed 同笔 set）
  status: RequestStatus;
  error: string | null;
  errorCode: string | null;

  // Action
  load: () => Promise<void>;
  /** Optimistic remove after resolve/ignore — removes gap from local state */
  removeGap: (gapId: string) => void;
}

export const useTopologyStore = create<TopologyStore>((set, get) => ({
  scope: "full",
  admittedNodes: [],
  admittedEdges: [],
  knowledgeNodes: [],
  knowledgeEdges: [],
  stats: null,
  gaps: [],
  activeEntityId: null,
  status: "idle",
  error: null,
  errorCode: null,

  setScope: (scope) => {
    set({ scope });
    get().load();
  },

  setActiveEntityId: (id) => set({ activeEntityId: id }),

  load: async () => {
    const { scope } = get();
    // 聚焦跟随重拉（Master 2026-10-29「图随文件变」）：已有数据时的后台刷新不闪加载态——
    // loading 翻转会让画布声明式重建（力导向重排闪跳）；仅首拉（无数据）走完整 loading
    const hasData = get().admittedNodes.length > 0 || get().knowledgeNodes.length > 0;
    if (!hasData) set({ ...requestLoading(), errorCode: null });
    try {
      const d = await fetchTopology(scope);
      if (!d.success) {
        set({ ...requestFailed(null, LIB_REQUEST_COPY.TOPOLOGY_INVALID_RESPONSE), errorCode: "INVALID_RESPONSE" });
        return;
      }

      // Defense-in-depth: re-filter nodes (backend filters, but verify in frontend)
      const rawNodes = d.data.topology.nodes;
      const admittedNodes = GraphAdmissionService.filterTopoNodes(rawNodes);
      const admittedIds = new Set(admittedNodes.map((n) => n.id));

      // Co-accession: filter edges to admitted endpoints only
      const rawEdges = d.data.topology.edges;
      const admittedEdges = GraphAdmissionService.filterTopologyEdges(rawEdges, admittedIds);

      // Knowledge topology: all nodes and edges (including Document, DOCUMENTS, REFERENCES)
      const kt = d.data.knowledgeTopology;
      const knowledgeNodes = kt?.nodes ?? [];
      const knowledgeEdges = kt?.edges ?? [];

      // Governance gaps — backend already filters resolved/ignored, so these are all "unresolved"
      const gaps = d.data.gaps || [];

      // 未变守卫：数据与现值一致时保留旧数组引用——selector Object.is 命中、组件零重渲染
      // （聚焦重拉每次数组都是新实例，不守卫则图每次聚焦都重排）。数据量与图上限同量级，序列化比对成本可忽略。
      const cur = get();
      const sameArray = <T>(next: T[], prev: T[]) =>
        next === prev || (next.length === prev.length && JSON.stringify(next) === JSON.stringify(prev));
      set({
        admittedNodes: sameArray(admittedNodes, cur.admittedNodes) ? cur.admittedNodes : admittedNodes,
        admittedEdges: sameArray(admittedEdges, cur.admittedEdges) ? cur.admittedEdges : admittedEdges,
        knowledgeNodes: sameArray(knowledgeNodes, cur.knowledgeNodes) ? cur.knowledgeNodes : knowledgeNodes,
        knowledgeEdges: sameArray(knowledgeEdges, cur.knowledgeEdges) ? cur.knowledgeEdges : knowledgeEdges,
        stats: JSON.stringify(d.data) === JSON.stringify(cur.stats) ? cur.stats : d.data,
        gaps: sameArray(gaps, cur.gaps) ? cur.gaps : gaps,
        ...requestSettled(admittedNodes.length === 0),
      });
    } catch (e) {
      set({
        ...requestFailed(e, TERM.API_UNREACHABLE),
        errorCode: e instanceof DashboardApiError ? e.errorCode : "NETWORK_ERROR",
      });
    }
  },

  /** Optimistic remove after resolve/ignore — removes gap from local state immediately */
  removeGap: (gapId) => {
    set((state) => ({
      gaps: state.gaps.filter((g) => g.id !== gapId),
    }));
  },
}));

// ── Atomic selectors ──

export function useAdmittedNodes() {
  return useTopologyStore((s) => s.admittedNodes);
}

export function useAdmittedEdges() {
  return useTopologyStore((s) => s.admittedEdges);
}

export function useKnowledgeNodes() {
  return useTopologyStore((s) => s.knowledgeNodes);
}

export function useKnowledgeEdges() {
  return useTopologyStore((s) => s.knowledgeEdges);
}

export function useTopologyStats() {
  return useTopologyStore((s) => s.stats);
}

export function useTopologyLoading() {
  return useTopologyStore((s) => s.status === "loading");
}

export function useTopologyError() {
  return useTopologyStore((s) => s.error);
}

export function useTopologyErrorCode() {
  return useTopologyStore((s) => s.errorCode);
}

export function useTopologyScope() {
  return useTopologyStore((s) => s.scope);
}

export function useSetTopologyScope() {
  return useTopologyStore((s) => s.setScope);
}

export function useLoadTopology() {
  return useTopologyStore((s) => s.load);
}

/** 跨页面共享的当前实体 ID */
export function useActiveEntityId() {
  return useTopologyStore((s) => s.activeEntityId);
}

/** Set the global active entity ID — triggers EntityHubDrawer data refresh */
export function useSetActiveEntityId() {
  return useTopologyStore((s) => s.setActiveEntityId);
}

/** Governance gaps from gap-engine — backend already filters resolved/ignored */
export function useGapItems() {
  return useTopologyStore((s) => s.gaps);
}

/** Unresolved governance gap count — semantic alias, uses backend-filtered data */
export function useUnresolvedGapCount() {
  return useTopologyStore((s) => s.gaps.length);
}

