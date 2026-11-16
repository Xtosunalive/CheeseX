// workbench-store.ts — 工作台聚合量值带数据源（2026-11-17 第 2 批，目标 IA 工作台）
// 四源信号（下钻修正口径：队列形状归工作台，动作配置异构共存——本 store 只聚合计数，不含动作）：
//   待审关系  ← review-data-store.pendingCount（第 1 批接线，EdgeReviewPanel 回写）
//   拓扑缺口  ← topology-store.useUnresolvedGapCount（P7 同源）
//   待处理问题 ← anomalies 接口 pending 面（本 store 自拉）
//   映射待处理 ← manifests summary（stale＋missingEligible 合计；清单非队列，仅信号）
// 未知口径：null＝尚未加载，不冒充真零（WP-134 波2 口径沿袭）。
import { create } from "zustand";
import { isAnomalyPending } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { fetchAnomalyPendingSignals, fetchManifestSignals } from "./workbench-api";

interface WorkbenchSignals {
  /** 待审关系数（第 1 批接线源）；null＝未知 */
  pendingReview: number | null;
  /** 未解决拓扑缺口；null＝未知 */
  topologyGaps: number | null;
  /** 待处理问题；null＝未知 */
  anomalies: number | null;
  /** 映射待处理（过期＋未生成合计）；null＝未知 */
  manifestPending: number | null;
}

interface WorkbenchStore extends WorkbenchSignals {
  loaded: boolean;
  load: () => Promise<void>;
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  pendingReview: null,
  topologyGaps: null,
  anomalies: null,
  manifestPending: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    const [anomaliesRes, manifestRes] = await Promise.allSettled([
      fetchAnomalyPendingSignals(),
      fetchManifestSignals(),
    ]);
    const patch: Partial<WorkbenchSignals> = {};
    if (anomaliesRes.status === "fulfilled" && anomaliesRes.value) {
      patch.anomalies = anomaliesRes.value.issues.filter((issue) => isAnomalyPending(issue.status)).length;
    }
    if (manifestRes.status === "fulfilled" && manifestRes.value) {
      const s = manifestRes.value.summary;
      patch.manifestPending = s ? (("missingEligible" in s ? s.missingEligible : s.missing) ?? 0) + (s.stale ?? 0) : null;
    }
    set(patch as WorkbenchSignals);
  },
}));
