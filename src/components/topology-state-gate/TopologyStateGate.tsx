// TopologyStateGate — 拓扑加载状态统一门（loading / error / 无数据）
// @responsible: 收敛 DashboardView / DataDashboardView 重复的状态分支样板（规则 8 单源化）
// NOT_INITIALIZED 分支与 PipelineInitializationPanel 已退役（PR-081 全量落地，Master 2026-10-26
// 「空库就显示各项0就行了啊要什么指引」）：后端空图恒 200 零值载荷，空态由 children 自然渲染；
// 当年由此分支形成的「诊断 succeeded↔NOT_INITIALIZED」互锁闪烁随分支移除结构性消失——
// 任何 errorCode 都不得再唤出自动初始化面板。
import { AlertTriangle } from "lucide-react";
import { TERM } from "@/constants/term-const";
import type { ReactNode } from "react";
import { SMALL_UI_COPY } from "../components-copy";

export function FullCenter({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-text-hint">{text}</p>
    </div>
  );
}

interface TopologyStateGateProps {
  loading: boolean;
  error?: Error | string | null;
  hasStats: boolean;
  onLoad: () => void;
  loadingText?: string;
  children: ReactNode;
}

/**
 * 统一处理拓扑视图的三种加载状态：
 * - loading → 居中加载文案
 * - error → 错误卡片 + 手动重试按钮（永不自动回调）
 * - 无 stats → 空渲染
 */
export function TopologyStateGate({ loading, error, hasStats, onLoad, loadingText = SMALL_UI_COPY.TOPOLOGY_LOADING_DEFAULT, children }: TopologyStateGateProps) {
  if (loading) return <FullCenter text={loadingText} />;
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-lg ring-1 ring-status-error-6 bg-status-error-2 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-status-error" />
          <p className="text-sm text-status-error">{String(error)}</p>
          <button onClick={onLoad} className="mt-3 rounded bg-surface-card px-3 py-1.5 text-xs text-text-main hover:bg-surface-hover">{TERM.RETRY_ACTION}</button>
        </div>
      </div>
    );
  }
  if (!hasStats) return null;
  return <>{children}</>;
}
