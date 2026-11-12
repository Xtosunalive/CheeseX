// Pipeline API — shared API functions for pipeline run/status/cancel.
// Migrated from features/dashboard/pipeline-api.ts (Phase 1 store decoupling).

import type { paths } from "@/lib/generated/api-types";
import { pipelineRequestFailed } from "./lib-copy";

type RunEnvelope =
  paths["/api/pipeline/run"]["post"]["responses"][202]["content"]["application/json"];
type RebuildEnvelope =
  paths["/api/pipeline/rebuild"]["post"]["responses"][202]["content"]["application/json"];
type StatusEnvelope =
  paths["/api/pipeline/status"]["get"]["responses"][200]["content"]["application/json"];

export type PipelineJob = RunEnvelope["data"];

// 诊断档（默认）：只读对账——刷新来源状态并将阻断汇入待处理问题，不重写任何派生投影（ADR063 名实相符）。
export const PIPELINE_RUN_ACTION = {
  id: "pipeline.run",
  risk: "medium",
  dataChannel: "POST /api/pipeline/run",
  writes: [],
} as const;

// 重建档（显式确认）：--force 全量重跑并重写工作投影（ADR063）。
export const PIPELINE_REBUILD_ACTION = {
  id: "pipeline.rebuild",
  risk: "high",
  dataChannel: "POST /api/pipeline/rebuild",
  writes: ["master_graph.json", "master_graph.db", "semantic_architecture.json", "architecture_layout.json"],
} as const;

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & {
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || body.error || pipelineRequestFailed(response.status));
  }
  return body;
}

export async function runPipeline(): Promise<PipelineJob> {
  const response = await fetch("/api/pipeline/run?mode=full", {
    method: "POST",
    cache: "no-store",
  });
  const envelope = await readEnvelope<RunEnvelope>(response);
  return envelope.data;
}

export async function rebuildPipeline(): Promise<PipelineJob> {
  const response = await fetch("/api/pipeline/rebuild", {
    method: "POST",
    cache: "no-store",
  });
  const envelope = await readEnvelope<RebuildEnvelope>(response);
  return envelope.data;
}

export async function fetchPipelineStatus(): Promise<PipelineJob> {
  const response = await fetch("/api/pipeline/status", { cache: "no-store" });
  const envelope = await readEnvelope<StatusEnvelope>(response);
  const job = envelope.data;
  if (job.state === "succeeded" && job.jobId && typeof window !== "undefined") {
    const marker = `pipeline-completed:${job.jobId}`;
    try {
      if (window.sessionStorage.getItem(marker) !== "1") {
        window.sessionStorage.setItem(marker, "1");
        window.dispatchEvent(new CustomEvent("pipeline-completed", { detail: job }));
      }
    } catch (_error) {
      // Refresh remains best-effort when browser storage is unavailable.
    }
  }
  return job;
}

export async function cancelPipeline(): Promise<PipelineJob> {
  const response = await fetch("/api/pipeline/cancel", { method: "POST", cache: "no-store" });
  const envelope = await readEnvelope<StatusEnvelope>(response);
  return envelope.data;
}
