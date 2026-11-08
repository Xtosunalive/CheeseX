// request-status — interaction-state 域 store 层单源（五态枚举＋状态切片构造器）
// 契约（PR-071 子项二／域表 interaction-state A3 评估）：
//   ① 一次请求只有一个 status：idle | loading | success | empty | error——取代各 store 各自为政的
//      loading/error 布尔旗标（11 store 审计：3 枚举、8 布尔，布尔模型允许 loading=true 且 error≠null 的矛盾组合）。
//   ② error 非空 ⇔ status === "error"。store 一律用下面四个构造器整体 set，禁止手写 {status, error} 组合。
//   ③ 视图主请求用 status/error；写操作（保存/修复/比较）的失败走各 store 自己的 operationError，
//      不污染主请求的 error（anomaly-workbench 先例：operationApiError）。
//   ④ 「有数据时的重新拉取」沿用 refreshing: boolean 辅助旗（anomaly-workbench 先例），不另造状态。
// 首两个落地场景（document-inventory QueryStatus / anomaly-workbench AnomalyViewStatus）的枚举定义逐字相同，
// 本文件为合一后的唯一定义处，两处类型名保留为别名。

export type RequestStatus = "idle" | "loading" | "success" | "empty" | "error";

/** 主请求状态切片——spread 进 store 的 set() */
export type RequestSlice = { status: RequestStatus; error: string | null };

export function requestIdle(): RequestSlice {
  return { status: "idle", error: null };
}

export function requestLoading(): RequestSlice {
  return { status: "loading", error: null };
}

/** 请求成功落账；empty=true 表示结果集为空（列表场景），单对象场景传 false */
export function requestSettled(empty = false): RequestSlice {
  return { status: empty ? "empty" : "success", error: null };
}

/** 请求失败落账；非 Error 的 reason 用 fallback 文案 */
export function requestFailed(reason: unknown, fallback: string): RequestSlice {
  return { status: "error", error: reason instanceof Error && reason.message ? reason.message : fallback };
}

/** 统一的错误文案提取（写操作的 operationError 复用，避免 10 份 `e instanceof Error ? e.message : "…"` 抄写） */
export function errorMessageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function isRequestBusy(status: RequestStatus): boolean {
  return status === "loading";
}
