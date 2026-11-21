import { ArrowRight, LoaderCircle, Square, Terminal } from "lucide-react";
import { PIPELINE_RUN_ACTION } from "@/lib/pipeline-api";
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
 * 图谱管道浮层（纯状态面板——2026-11-22 Master 连裁「现在就删」×2）：
 * ① 重建与诊断按钮均已退役：日常由自动链路覆盖（源增量＋代码升级/产物丢失自愈〔WP-216〕）；
 *    「图谱为何未更新」由本面板管道状态＋运行日志如实呈现，内容阻断由服务端链路汇入待处理问题；
 * ② 维修通道保留在路由层：POST /api/pipeline/rebuild（断路器人工出口＋resume 宿主）与
 *    POST /api/pipeline/run（同步流等服务端消费者）；
 * ③ 运行中（自愈/服务端触发的重建或诊断）仍如实展示运行文案＋可取消。
 */
export function PipelinePanel() {
  const job = usePipelineStore((state) => state.job);
  const loading = usePipelineStore((state) => state.status === "loading");
  const error = usePipelineStore((state) => state.error);
  const cancel = usePipelineStore((state) => state.cancel);
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
        {running && (
          <button type="button" onClick={() => void cancel()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-status-error ring-1 ring-status-error-6 hover:bg-red-3 disabled:opacity-40">
            <Square className="h-4 w-4" />{TERM.CANCEL_ACTION}
          </button>
        )}
      </div>

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
