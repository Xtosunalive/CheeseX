import { ArrowRight, LoaderCircle, Play, RefreshCw, Square, Terminal } from "lucide-react";
import { PIPELINE_REBUILD_ACTION, PIPELINE_RUN_ACTION } from "@/lib/pipeline-api";
import { usePipelineStore } from "@/lib/pipeline-store";
import { TERM } from "@/constants/term-const";
import { PIPELINE_PANEL_COPY, PIPELINE_STATE_LABELS, pipelineRunLogs, pipelineStageSuffix } from "../components-copy";

const STATE_LABEL = PIPELINE_STATE_LABELS;

function statusText() {
  const job = usePipelineStore.getState().job;
  if (!job) return PIPELINE_PANEL_COPY.READING_STATUS;
  const state = STATE_LABEL[job.state] || PIPELINE_PANEL_COPY.STATE_UNKNOWN;
  return `${state}${job.stage ? pipelineStageSuffix(job.stage) : ""}`;
}

/**
 * 图谱管道浮层（WP-146 件1：重建/诊断分主次）：
 * ① 主路径=只读诊断（醒目主按钮，直执行无阻断确认——零副作用文案自证低风险）；
 * ② 重建=高风险低频路径，收进「进阶操作」折叠区（details 范式同本面板运行日志/CheckResultsPanel），
 *    保留阻断确认，确认块与确认钮改 error 险级视觉（bg-status-error 系），与 warn 平权旧态区分；
 * ③ 状态机：诊断走 startRun 直执行；重建走 requestRun→confirmRun，二者共用同一起动体，
 *    进入起动即清 confirming 与上一轮 error，执行中/失败展示两条路径共用。
 */
export function PipelinePanel() {
  const job = usePipelineStore((state) => state.job);
  const loading = usePipelineStore((state) => state.status === "loading");
  const confirming = usePipelineStore((state) => state.confirming);
  const error = usePipelineStore((state) => state.error);
  const requestRun = usePipelineStore((state) => state.requestRun);
  const dismissConfirmation = usePipelineStore((state) => state.dismissConfirmation);
  const startRun = usePipelineStore((state) => state.startRun);
  const confirmRun = usePipelineStore((state) => state.confirmRun);
  const cancel = usePipelineStore((state) => state.cancel);
  const confirmingMode = usePipelineStore((state) => state.confirmingMode);
  const running = job?.state === "running" || job?.state === "cancelling";
  const rebuilding = running && job?.purpose === "article_graph";
  const runningLabel = rebuilding ? PIPELINE_PANEL_COPY.RUNNING_REBUILD : PIPELINE_PANEL_COPY.RUNNING_DIAGNOSTIC;

  return (
    <div data-action-id={PIPELINE_RUN_ACTION.id} data-risk={PIPELINE_RUN_ACTION.risk} data-channel={PIPELINE_RUN_ACTION.dataChannel}>
      <div className="flex items-start justify-between gap-4 border-b border-border-thin pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-main">{TERM.GRAPH_PIPELINE}</h2>
          <p className="mt-1 truncate font-mono text-xs text-text-hint">{statusText()}</p>
        </div>
        {running ? (
          <button type="button" onClick={() => void cancel()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-status-error ring-1 ring-status-error-6 hover:bg-red-3 disabled:opacity-40">
            <Square className="h-4 w-4" />{TERM.CANCEL_ACTION}
          </button>
        ) : (
          <button type="button" aria-label={TERM.RUN_PIPELINE_DIAGNOSTIC_ACTION} title={PIPELINE_PANEL_COPY.DIAGNOSTIC_TITLE} onClick={() => void startRun("diagnostic")} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-base px-3 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-bg-strong disabled:opacity-40">
            <Play className="h-4 w-4" />{PIPELINE_PANEL_COPY.DIAGNOSTIC}
          </button>
        )}
      </div>

      {!running && (
        <details className="mt-3">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-hint">
            <RefreshCw className="h-4 w-4" />{TERM.PIPELINE_ADVANCED_ACTIONS}
          </summary>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" aria-label={TERM.RUN_FULL_GRAPH_PIPELINE_ACTION} onClick={() => requestRun("rebuild")} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-status-warn ring-1 ring-status-warn-7 hover:bg-amber-3 disabled:opacity-40">
              <RefreshCw className="h-4 w-4" />{PIPELINE_PANEL_COPY.REBUILD}
            </button>
          </div>
          {confirming && confirmingMode === "rebuild" && (
            <div className="mt-2 bg-status-error-2 px-3 py-2.5 text-xs text-text-sub ring-1 ring-status-error-6" data-action-id={PIPELINE_REBUILD_ACTION.id} data-risk={PIPELINE_REBUILD_ACTION.risk} data-channel={PIPELINE_REBUILD_ACTION.dataChannel}>
              <p className="leading-5">{PIPELINE_PANEL_COPY.REBUILD_CONFIRM_TEXT}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={dismissConfirmation} className="h-7 px-2 text-text-hint hover:text-text-main">{TERM.CANCEL_ACTION}</button>
                <button type="button" onClick={() => void confirmRun()} className="h-7 rounded bg-status-error-3 px-3 text-status-error hover:bg-red-5">{PIPELINE_PANEL_COPY.CONFIRM_REBUILD}</button>
              </div>
            </div>
          )}
        </details>
      )}

      {error && <p className="mt-3 bg-status-error-2 px-3 py-2 text-xs leading-5 text-status-error">{error}</p>}
      {running && <div className="mt-3 flex items-center gap-2 text-xs text-accent-base"><LoaderCircle className="h-4 w-4 animate-spin" />{runningLabel}</div>}
      {job?.diagnostics && !running && (
        <div className={`mt-3 px-3 py-2 text-xs leading-5 ${job.diagnostics.blockerCount > 0 ? "bg-status-warn-2 text-status-warn" : "bg-status-fact-2 text-status-fact"}`}>
          <p>{job.diagnostics.message}</p>
          {job.diagnostics.blockerCount > 0 && <a href="#/anomalies" className="mt-1 inline-flex items-center gap-1 font-medium text-status-warn hover:text-amber-3">{PIPELINE_PANEL_COPY.OPEN_PENDING_ISSUES}<ArrowRight className="h-3 w-3" /></a>}
        </div>
      )}
      {!!job?.logs?.length && (
        <details className="mt-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-text-hint"><Terminal className="h-4 w-4" />{pipelineRunLogs(job.logs.length)}</summary>
          <pre className="mt-2 max-h-44 overflow-auto rounded bg-surface-root p-3 font-mono text-kg-xs leading-5 text-text-sub">{job.logs.map((line) => `[${line.source}] ${line.message}`).join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
