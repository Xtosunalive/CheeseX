// PoolShell — 右侧任务池卡片容器（PR-026）
// 定位：四个右侧面板（实体修复/实体全景/异常修复弹窗/投稿准入详情）的统一容器壳，
//      取代 480px 通顶白条（Sheet/SIDE_PANEL_*）与居中 modal（RepairDrawerShell）。
// 布局形态（Master 2026-10-06 目检④改版）：停靠卡片——经 portal 渲染进 App 层池槽（#pool-dock），
//      与主内容并排（flex 兄弟），打开时主内容收缩让位、互不遮挡；槽内同时至多一卡（pool-bus 互斥）。
// 规格：300px 固定宽、高随槽拉伸、圆角 --radius-panel、半透明白底 bg-glass + 毛玻璃、柔和投影、1px 描边。
// 视口 ≤800px：槽隐藏，由唤回钮（PoolRecallButton）点击强制显示（fixed 悬浮回退）。
// 词表合规：全部走 L1 令牌，零字面值——check:theme-tokens 执法对象。
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Minus, X } from "lucide-react";
import { useNarrowViewport } from "./use-narrow-viewport";
import { SMALL_UI_COPY, poolSourceTitle } from "../components-copy";

export const POOL_WIDTH = 300; // 与 PoolShell className w-[300px] 同值（Tailwind JIT 需静态类名，常量供几何计算用）
export const POOL_EDGE = 12;
export const POOL_DOCK_ID = "pool-dock";

type PoolShellProps = {
  /** 无障碍名（aria-label），如「修复 MySQL」 */
  title: string;
  /** 头部标题行文案（如「修复 MySQL」/「实体全景」）；缺省用 title */
  heading?: string;
  /** 标题下方的来源文档路径行（截断省略）；可选 */
  sourceKey?: string;
  children: ReactNode;
  /** 吸底操作条（2×2 网格等由调用方组织） */
  footer?: ReactNode;
  /** 最小化钮回调；不传则不渲染该钮 */
  onMinimize?: () => void;
  onClose: () => void;
  /** 最小化钮 aria-label（既有测试按名寻获，逐字保留） */
  minimizeLabel?: string;
  closeLabel?: string;
  /** 头部右侧额外内容（如状态点） */
  headerExtra?: ReactNode;
};

function PoolCard({ title, heading, sourceKey, children, footer, onMinimize, onClose, minimizeLabel = SMALL_UI_COPY.POOL_MINIMIZE_DEFAULT, closeLabel = SMALL_UI_COPY.POOL_CLOSE_DEFAULT, headerExtra }: PoolShellProps) {
  return (
    <aside
      aria-label={title}
      className="flex h-full w-[300px] shrink-0 flex-col rounded-[var(--radius-panel)] bg-glass text-text-main shadow-card ring-1 ring-border-thin backdrop-blur-md"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-main">{heading || title}</h2>
          {sourceKey && (
            <p className="mt-0.5 truncate text-xs text-text-hint" title={poolSourceTitle(sourceKey)}>
              {sourceKey}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {headerExtra}
          {onMinimize && (
            <button type="button" onClick={onMinimize} aria-label={minimizeLabel} title={SMALL_UI_COPY.POOL_MINIMIZE_TITLE} className="rounded p-1.5 text-text-sub transition-colors hover:bg-surface-hover hover:text-text-main">
              <Minus className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={closeLabel} title={SMALL_UI_COPY.POOL_CLOSE_TITLE} className="rounded p-1.5 text-text-sub transition-colors hover:bg-surface-hover hover:text-text-main">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">{children}</div>
      {footer && <footer className="shrink-0 border-t border-border-thin px-3 py-2.5">{footer}</footer>}
    </aside>
  );
}

export function PoolShell(props: PoolShellProps) {
  const narrow = useNarrowViewport();
  if (narrow) return null;
  // 停靠卡片：portal 进 App 池槽（与主内容并排）；槽不存在时（测试/独立渲染）回退 body 内联
  const dock = typeof document !== "undefined" ? document.getElementById(POOL_DOCK_ID) : null;
  if (dock) return createPortal(<PoolCard {...props} />, dock);
  return <PoolCard {...props} />;
}

/** 唤回钮：窄视口（≤800px）面板隐藏时显示，点击强制显示面板（调用方持有 revealed 状态） */
export function PoolRecallButton({ label, onClick, stacked }: { label: string; onClick: () => void; stacked?: boolean }) {
  const narrow = useNarrowViewport();
  if (!narrow) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="fixed right-3 z-chrome flex h-9 w-9 items-center justify-center rounded-md bg-glass text-text-sub shadow-card ring-1 ring-border-thin backdrop-blur-md transition-colors hover:bg-surface-hover hover:text-text-main"
      style={{ top: `calc(var(--app-bar-height) + ${POOL_EDGE}px + ${(stacked ? 42 : 0)}px)` }}
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-accent-base" />
    </button>
  );
}
