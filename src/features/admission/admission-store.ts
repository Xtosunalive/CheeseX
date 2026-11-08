// Admission store — entity registry + drawer state + tab state (Module 1)

import { create } from "zustand";
import { useGraphStore } from "@/lib/graph-data";
import { fetchCanvasAdmission, type AdmissionResponse } from "./admission-api";
import type { GovernanceTab } from "./admission-types";

const EMPTY_ARRAY: never[] = [];

// ── Canvas admission authority（WP-030/PR-145 批2 接线）──
// 后端 GET /api/kg/canvas-admission 是准入判定唯一事实源（三源口径 file_path||sourcePath||source_path，
// 键序单源 contracts/graph-admission.json）；admission 页准入状态优先消费本 store 的权威面，
// 权威缺席（未加载/请求失败）时 entity-registry-selectors 降级为前端 hasArticle 自算加速缓存。
interface CanvasAdmissionStore {
  /** id → 权威判定；null＝权威面缺席（降级语义，不是「全员 PENDING」） */
  componentsById: Map<string, { admitted: boolean; blockedReasons: string[]; kind: AdmissionKind | null }> | null;
  /**
   * 后端汇总口径直读面（server/routes/kg-routes.cjs 同一遍历管道产出）——
   * 「已准入实体/文档」取 `byKind`（契约 admittedByKind），「待准入」的**被减数**取 `totalByKind`
   * （契约同名，全量含无 id 条目）。红队 WP-134 反例①要求减法两侧同集合，此前由前端自己按
   * components 重数一份（kindTotals）；WP-136 a 起该份本地计数退役，两侧都来自后端同一管道。
   * null＝该响应未携带（契约 optional）或权威面缺席；缺席不得降级成 0。
   */
  totals: { total: number; admitted: number; blocked: number; byKind: AdmissionByKind | null; totalByKind: AdmissionByKind | null } | null;
  status: "idle" | "loading" | "ready" | "error";
  load: () => Promise<void>;
}

type AdmissionKind = "entity" | "document" | "taxonomy";
type AdmissionByKind = { entity: number; document: number; taxonomy: number };

export const useCanvasAdmissionStore = create<CanvasAdmissionStore>((set) => ({
  componentsById: null,
  totals: null,
  status: "idle",
  load: async () => {
    set({ status: "loading" });
    try {
      const env = await fetchCanvasAdmission();
      const data = (env?.data ?? null) as AdmissionResponse | null;
      const items = (data?.components ?? []) as Array<{ id: string; admitted: boolean; blockedReasons?: string[]; kind?: AdmissionKind }>;
      const map = new Map(
        items
          .filter((c) => typeof c?.id === "string" && c.id !== "")
          .map((c) => [c.id, {
            admitted: !!c.admitted,
            blockedReasons: Array.isArray(c.blockedReasons) ? c.blockedReasons : [],
            // WP-134 波1：kind 此前被丢弃，导致按类过滤恒空、统计堆整块不渲染（死面）。
            // 红队反例④：契约 required，缺席不得伪造成某一类（伪造值会喂给分母）——保持 null。
            kind: c.kind ?? null,
          }]),
      );
      set({
        componentsById: map,
        totals: data
          ? {
            total: data.total,
            admitted: data.admitted,
            blocked: data.blocked,
            byKind: data.admittedByKind ?? null,
            totalByKind: data.totalByKind ?? null,
          }
          : null,
        status: "ready",
      });
    } catch {
      // fail-open 渲染：权威面缺席走降级缓存，不阻断页面（判定语义见 selectors 注释）
      set({ componentsById: null, totals: null, status: "error" });
    }
  },
}));

// ── Graph-data selectors ──
// EDGE-RELATION-GOV-001 退役批（2026-10-24）：useRelations（kg/query dependencies 字段唯一消费方）
// 经全仓清点零外部导入——死 selector 删除，dependencies 字段自此零前端消费。
// kg/query 响应仍含该字段（契约兼容）；全量边集需求如真实出现，走 /api/edges 增设全量模式
// 而非复活旧读法（新消费方一律走 /api/edges——阶段 4 面板示范）。
export function useEntities() {
  return useGraphStore((s) => s.data?.components ?? EMPTY_ARRAY);
}

export function useGovernanceLoading() {
  return useGraphStore((s) => s.status === "loading");
}

export function useGovernanceError() {
  return useGraphStore((s) => s.error);
}

export function useLoadGraph() {
  return useGraphStore((s) => s.load);
}

// ── Real data selectors (re-exported from lib) ──
export { useRegistryItems, useTopologyEdges } from "@/lib/entity-registry-selectors";

// ── UI State (drawer, tab — pure UI, no data) ──

interface AdmissionUIState {
  activeTab: GovernanceTab;
  drawerOpen: boolean;
  selectedEntityId: string | null;
  setActiveTab: (tab: GovernanceTab) => void;
  openDrawer: (entityId: string) => void;
  closeDrawer: () => void;
}

export const useAdmissionUIStore = create<AdmissionUIState>((set) => ({
  activeTab: "registry",
  drawerOpen: false,
  selectedEntityId: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  openDrawer: (entityId) => set({ drawerOpen: true, selectedEntityId: entityId }),
  closeDrawer: () => set({ drawerOpen: false, selectedEntityId: null }),
}));

// ── UI Selectors ──

export function useActiveTabValue() {
  return useAdmissionUIStore((s) => s.activeTab);
}

export function useSetActiveTab() {
  return useAdmissionUIStore((s) => s.setActiveTab);
}

export function useDrawerOpen() {
  return useAdmissionUIStore((s) => s.drawerOpen);
}

export function useDrawerEntityId() {
  return useAdmissionUIStore((s) => s.selectedEntityId);
}

export function useOpenDrawer() {
  return useAdmissionUIStore((s) => s.openDrawer);
}

export function useCloseDrawer() {
  return useAdmissionUIStore((s) => s.closeDrawer);
}
