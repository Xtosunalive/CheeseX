// Component: Entity-Compliance Store
// @responsible: 管理源文档校验筛选、分页、加载和错误状态。
// @inputs: 用户筛选操作与 Entity-Compliance API 响应
// @outputs: Zustand 源文档校验视图状态与 actions
// @context: Canvas
import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchEntityCheckOne, fetchEntityCompliance, previewEntityRepair, applyEntityRepair } from "./entity-compliance-api";
import { extractPostCheckBlockers, extractRepairBlockers, extractFieldBlocker, type RepairWriteGateBlocker } from "@/lib/domain/entity-repair-api";
import type {
  EntityCheckData, ComplianceFilter, EntityComplianceResult,
  EntityRelationPatch, EntityRepairChanges, EntityRepairPreviewData, EntityRepairApplyData,
} from "./entity-compliance-types";
import { errorMessageOf, requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { EC_STORE_COPY, ecNoChangeSummary, ecSelectedBlockerDelta, ecSourceBlockerDelta } from "./entity-compliance-copy";
import { LIB_REQUEST_COPY } from "@/lib/lib-copy";

type State = {
  filter: ComplianceFilter;
  query: string;
  limit: number;
  offset: number;
  /** 主请求＝校验清单加载（reload/refreshAll）；refreshing 为「有数据时重拉」辅助旗（anomaly 先例） */
  status: RequestStatus;
  error: string | null;
  data: EntityCheckData | null;
  refreshing: boolean;
  lastCheckedAt: string | null;
  refreshSummary: string | null;
  selectedEntity: EntityComplianceResult | null;
  repairOpen: boolean;
  creatingEntity: boolean;
  repairChanges: EntityRepairChanges;
  relationPatch: EntityRelationPatch | null;
  preview: EntityRepairPreviewData | null;
  applyResult: EntityRepairApplyData | null;
  repairStatus: "idle" | "previewing" | "preview_ready" | "applying" | "applied";
  repairError: string | null;
  // seq178：写门拒绝（ENTITY_COMPLIANCE_BLOCKED）的字段级规则明细，按字段回显给修复者
  repairBlockers: RepairWriteGateBlocker[];
  setFilter: (f: ComplianceFilter) => void;
  setQuery: (q: string) => void;
  clearFilters: () => void;
  setPage: (offset: number) => void;
  reload: () => Promise<void>;
  refreshAll: (options?: { announce?: boolean }) => Promise<void>;
  openRepair: (entity: EntityComplianceResult) => void;
  // seq205 展示即事实：单实体现读现算（契约 06 编辑前重读），打开抽屉自动触发
  refreshEntity: (sourceKey: string) => Promise<boolean>;
  refreshingSourceKey: string | null;
  openCreate: (entity: EntityComplianceResult) => void;
  closeRepair: () => void;
  minimizeRepair: () => void;
  resumeRepair: () => void;
  setRepairField: (field: string, value: unknown) => void;
  // PR-026 池行式底部操作条「清除全部」：只清编辑态（对称 setRepairField 的连带清理），任务本体（selectedEntity）保留
  clearRepairChanges: () => void;
  setRelationPatch: (patch: EntityRelationPatch | null) => void;
  loadPreview: () => Promise<void>;
  submitApply: () => Promise<void>;
};

export const useEntityComplianceStore = create<State>((set, get) => ({
  filter: "all",
  query: "",
  limit: 50,
  offset: 0,
  status: "idle",
  error: null,
  data: null,
  refreshing: false,
  lastCheckedAt: null,
  refreshSummary: null,
  selectedEntity: null,
  repairOpen: false,
  creatingEntity: false,
  repairChanges: {},
  relationPatch: null,
  preview: null,
  applyResult: null,
  repairStatus: "idle",
  repairError: null,
  repairBlockers: [],

  setFilter: (f) => { set({ filter: f, offset: 0 }); get().reload(); },
  setQuery: (q) => { set({ query: q, offset: 0 }); get().reload(); },
  clearFilters: () => { set({ filter: "all", query: "", offset: 0 }); get().reload(); },
  setPage: (offset) => { set({ offset }); get().reload(); },

  reload: async () => {
    const { filter, query, limit, offset } = get();
    set({ ...requestLoading(), data: null });
    try {
      const data = await fetchEntityCompliance({ filter, q: query, limit, offset });
      const selected = get().selectedEntity;
      const freshSelected = selected ? data.items.find((item) => item.sourceKey === selected.sourceKey) || null : null;
      set({ data, ...requestSettled(data.items.length === 0), ...(selected ? { selectedEntity: freshSelected, repairOpen: Boolean(freshSelected) } : {}) });
    } catch (e) {
      set(requestFailed(e, TERM.LOAD_FAILED));
    }
  },
  refreshAll: async (options = {}) => {
    const { filter, query, limit, offset, data: previousData, selectedEntity } = get();
    set({ refreshing: true, repairError: null, ...requestLoading() });
    try {
      const data = await fetchEntityCompliance({ filter, q: query, limit, offset });
      const freshSelected = selectedEntity ? data.items.find((item) => item.sourceKey === selectedEntity.sourceKey) || null : null;
      // 红队 WP-134 反例③（必修，自查成立）：卡面本批改读 blockerEntityCount（源文档数口径），
      // 而这条 aria-live 播报仍取 blockerCount（问题数口径）——同屏会出现「卡：存在阻断 0」
      // ＋「播报：当前 3 项阻断」。播报文案自称「源文档阻断」，故两侧同取源文档数族。
      const before = previousData?.summary?.blockerEntityCount;
      const after = data.summary?.blockerEntityCount ?? 0;
      const selectedBefore = selectedEntity?.blockerCount;
      const selectedAfter = freshSelected?.blockerCount;
      const selectedChanged = typeof selectedBefore === "number" && typeof selectedAfter === "number" && selectedBefore !== selectedAfter;
      const refreshSummary = options.announce
        ? selectedChanged
          ? ecSelectedBlockerDelta(freshSelected?.title || freshSelected?.fileName || EC_STORE_COPY.CURRENT_DOC_FALLBACK, selectedBefore, selectedAfter)
          : typeof before === "number" && before !== after
            ? ecSourceBlockerDelta(before, after)
            : ecNoChangeSummary(after)
        : get().refreshSummary;
      set({
        data, selectedEntity: freshSelected, repairOpen: selectedEntity ? Boolean(freshSelected) : get().repairOpen,
        refreshing: false, ...requestSettled(data.items.length === 0),
        lastCheckedAt: data.generatedAt, refreshSummary,
      });
    } catch (e) {
      set({ refreshing: false, ...requestFailed(e, EC_STORE_COPY.RECHECK_FAILED) });
    }
  },
  openRepair: (selectedEntity) => {
    set({ selectedEntity, repairOpen: true, creatingEntity: false, repairChanges: {}, relationPatch: null, preview: null, applyResult: null, repairStatus: "idle", repairError: null, repairBlockers: [] });
    // seq205 展示即事实：打开即单实体现读现算（契约 06「编辑前重新读取」）；
    // 创建流（源不存在）跳过。用户已改的 repairChanges 保留不被覆盖。
    if (selectedEntity.sourceExists !== false && selectedEntity.sourceKey) void get().refreshEntity(selectedEntity.sourceKey);
  },
  refreshingSourceKey: null,
  refreshEntity: async (sourceKey) => {
    const previous = get().selectedEntity;
    set({ refreshingSourceKey: sourceKey, repairError: null });
    try {
      const fresh = await fetchEntityCheckOne(sourceKey);
      set((state) => ({
        refreshingSourceKey: null,
        selectedEntity: state.selectedEntity?.sourceKey === sourceKey ? fresh : state.selectedEntity,
        data: state.data ? { ...state.data, items: state.data.items.map((item) => (item.sourceKey === sourceKey ? fresh : item)) } : state.data,
      }));
      return true;
    } catch {
      // 重验失败不阻断修复（保留当前基座 + 非致命提示）；源真变了时写回侧 revision/SOURCE_CHANGED 兜底
      set({ refreshingSourceKey: null, repairError: previous ? EC_STORE_COPY.REFRESH_STALE_HINT : null });
      return false;
    }
  },
  openCreate: (selectedEntity) => set({ selectedEntity, repairOpen: true, creatingEntity: true, repairChanges: {}, relationPatch: null, preview: null, applyResult: null, repairStatus: "idle", repairError: null, repairBlockers: [] }),
  closeRepair: () => set({ selectedEntity: null, repairOpen: false, creatingEntity: false, repairChanges: {}, relationPatch: null, preview: null, applyResult: null, repairStatus: "idle", repairError: null, repairBlockers: [] }),
  minimizeRepair: () => set({ repairOpen: false }),
  resumeRepair: () => { if (get().selectedEntity) set({ repairOpen: true }); },
  setRepairField: (field, value) => set((state) => ({ repairChanges: { ...state.repairChanges, [field]: value }, relationPatch: null, preview: null, repairStatus: "idle", repairError: null, repairBlockers: [] })),
  clearRepairChanges: () => set({ repairChanges: {}, relationPatch: null, preview: null, repairStatus: "idle", repairError: null, repairBlockers: [] }),
  setRelationPatch: (relationPatch) => set({ relationPatch, repairChanges: {}, preview: null, repairStatus: "idle", repairError: null, repairBlockers: [] }),
  loadPreview: async () => {
    const { selectedEntity, creatingEntity, repairChanges, relationPatch } = get();
    if (!selectedEntity?.sourceKey || (!creatingEntity && !selectedEntity.sourceRevision)) {
      set({ repairError: EC_STORE_COPY.REVISION_MISSING }); return;
    }
    set({ repairStatus: "previewing", repairError: null, preview: null, applyResult: null });
    try {
      const preview = await previewEntityRepair({
        sourceKey: selectedEntity.sourceKey,
        ...(selectedEntity.sourceRevision ? { sourceRevision: selectedEntity.sourceRevision } : {}),
        // 契约必填 boolean；后端对缺省同样按 false 处理（@default false），非创建流显式传 false 语义不变
        createIfMissing: creatingEntity === true,
        ...(creatingEntity ? { initialTitle: selectedEntity.title || selectedEntity.fileName } : {}),
        ...(relationPatch ? { relationPatch } : { changes: repairChanges }),
      });
      // seq179：预览阶段即回显阻断明细（展示时机前移）——postCheck.blockers（EG-1a 契约
      // BlockerDetail）归一化进同一 repairBlockers 槽，字段行内 errorText 与底部明细复用
      // seq178 机制自动点亮；文章分支渐进补齐期为空数组（不阻塞预览）。
      set({ preview, repairStatus: "preview_ready", repairBlockers: extractPostCheckBlockers((preview as { postCheck?: unknown } | null)?.postCheck) });
    } catch (e) {
      // seq181：preview 请求被拒（VALIDATION_ERROR 族字段级校验）→ extractFieldBlocker 归一化进
      // 同一 repairBlockers 槽（字段行内回显+中文标签）；无 field 归因的错误保持全局条兜底。
      const fieldBlocker = extractFieldBlocker(e);
      set({ repairStatus: "idle", repairError: fieldBlocker ? null : errorMessageOf(e, LIB_REQUEST_COPY.REPAIR_PREVIEW_FAILED), repairBlockers: fieldBlocker ? [fieldBlocker] : [] });
    }
  },
  submitApply: async () => {
    const preview = get().preview;
    if (!preview) return;
    set({ repairStatus: "applying", repairError: null });
    try {
      const applyResult = await applyEntityRepair(preview.previewId);
      set({ applyResult, preview: null, repairStatus: "applied", repairBlockers: [] });
      // 修复写回后立即重检当前过滤视图——写回成功但列表/抽屉仍显旧值，需手动刷新才见回填
      // （2026-10-14 Master 报障实证；对齐异常工作台 B1 路径 onBatchApplied→reconcileAndLoad 同款语义）
      await get().refreshAll({ announce: true });
    } catch (e) {
      // seq178：写门拒绝时按错误码提取字段级阻断明细（repairBlockers），抽屉逐字段回显
      set({ repairStatus: "preview_ready", repairError: errorMessageOf(e, LIB_REQUEST_COPY.REPAIR_APPLY_FAILED), repairBlockers: extractRepairBlockers(e) });
    }
  },
}));
