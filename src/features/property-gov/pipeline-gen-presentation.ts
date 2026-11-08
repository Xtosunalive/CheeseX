import type { PipelineJob } from "./property-api";
import {
  PIPELINE_GEN_COPY,
  pipelineGenFailedLabel,
  pipelineGenRunningLabel,
  pipelineGenSuccessLabel,
  pipelineGenSuccessTitle,
} from "./property-gov-copy";

function formatPipelineTime(timestamp: string | null | undefined) {
  if (!timestamp) return PIPELINE_GEN_COPY.TIME_UNKNOWN;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return PIPELINE_GEN_COPY.TIME_UNKNOWN;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export type PipelineGenPresentation = { label: string; tone: "running" | "success" | "failed" | "empty"; title?: string };

export function getPipelineGenPresentation(job: PipelineJob | null): PipelineGenPresentation {
  const lastRun = job?.lastRun;
  if (job?.state === "running" || job?.state === "cancelling") {
    return { label: pipelineGenRunningLabel(job.stage || "—"), tone: "running" };
  }
  // WP-146 裁决2：写在数据/表现层的空态文案属于数据不上屏——label 置空，
  // tone "empty" 保留作为状态标记（全仓无渲染点消费本 label，grep 实证 2026-11-07）
  if (!lastRun) return { label: "", tone: "empty" };
  if (lastRun.status === "failed") {
    return {
      label: pipelineGenFailedLabel(lastRun.failedStage || PIPELINE_GEN_COPY.STAGE_UNKNOWN),
      tone: "failed",
      title: `${formatPipelineTime(lastRun.timestamp)} · ${lastRun.error || PIPELINE_GEN_COPY.RUN_FAILED}`,
    };
  }
  return {
    label: pipelineGenSuccessLabel(lastRun.nodes, lastRun.connections),
    tone: "success",
    title: pipelineGenSuccessTitle(formatPipelineTime(lastRun.timestamp)),
  };
}
