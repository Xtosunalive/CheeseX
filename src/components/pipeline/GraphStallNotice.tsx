import { useEffect } from "react";
import { AlertTriangle, Terminal } from "lucide-react";
import { usePipelineStore } from "@/lib/pipeline-store";
import { PIPELINE_NOTICE_COPY } from "@/components/components-copy";

/**
 * GraphStallNotice（OpenMAIC StorageHealthNotice 同构，2026-11-22 Master 裁「做」）：
 * 呈现用户无法以其他方式察觉的失败——图谱自动更新停摆（管道终态 failed）。发生之前
 * 什么都不渲染；恢复（新 run 起动）即自隐。数据源＝pipeline-store 单源（job）。
 * 轮询自适应：运行中 1s（完成后经 pipeline-completed 事件触发全页刷新）、常态 30s。
 * 控制通道不在本面：触发归服务端自愈链路；人工出口在路由层（POST /api/pipeline/rebuild）。
 */
export function GraphStallNotice() {
  const job = usePipelineStore((state) => state.job);
  const initialize = usePipelineStore((state) => state.initialize);
  const refresh = usePipelineStore((state) => state.refresh);
  const running = job?.state === "running" || job?.state === "cancelling";

  useEffect(() => { void initialize(); }, [initialize]);

  useEffect(() => {
    const period = running ? 1_000 : 30_000;
    const timer = window.setInterval(() => { void refresh(); }, period);
    return () => window.clearInterval(timer);
  }, [refresh, running]);

  if (!job || job.state !== "failed") return null;

  return (
    <div role="alert" className="border-b border-status-error-6 bg-status-error-2 px-4 py-2 text-xs text-status-error">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">{PIPELINE_NOTICE_COPY.STALL_TITLE}</span>
        <span className="truncate text-status-error/80">{job.message || PIPELINE_NOTICE_COPY.STALL_FALLBACK_REASON}</span>
      </div>
      {!!job.logs?.length && (
        <details className="mt-1">
          <summary className="flex cursor-pointer items-center gap-1.5 text-status-error/70">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            {PIPELINE_NOTICE_COPY.STALL_LOGS(job.logs.length)}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-root p-2 font-mono text-kg-xs leading-5 text-text-sub">
            {job.logs.map((line) => `[${line.source}] ${line.message}`).join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
