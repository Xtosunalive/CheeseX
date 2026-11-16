// review-data-store.ts — 关系待审计数共享源（2026-11-17 第 1 批接线：96 待审计数上提）
// 历史：原 store 含 pendingCount/load/summary，89 死源批整删；本批按目标 IA 工作台量值带
// 前置依赖重建精简版——计数由 EdgeReviewPanel 自 fetch 后回写（唯一生产写入口），
// 工作台批（IA 第 2 批）挂载量值卡时再暴露消费 hook。
// 未知口径沿 WP-134 波2：null＝尚未加载，不冒充真零。
import { create } from "zustand";

interface ReviewDataStore {
  /** 待审核关系数；null＝尚未加载（未知≠真零） */
  pendingCount: number | null;
  setPendingCount: (pendingCount: number | null) => void;
}

export const useReviewDataStore = create<ReviewDataStore>((set) => ({
  pendingCount: null,
  setPendingCount: (pendingCount) => set({ pendingCount }),
}));
