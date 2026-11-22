// Pipeline API — 管道状态读取（观测单源）。
// 2026-11-22 纯观测化：run/rebuild/cancel 前端触发器随控制 UI 退役——通道归服务端（自愈链路
// ＋路由层维修口：POST /api/pipeline/rebuild 为断路器人工出口与 resume 宿主）。本文件只剩
// fetchPipelineStatus（GraphStallNotice／pipeline-store 消费）。

import type { paths } from "@/lib/generated/api-types";
import { pipelineRequestFailed } from "./lib-copy";

type RunEnvelope =
  paths["/api/pipeline/run"]["post"]["responses"][202]["content"]["application/json"];
type StatusEnvelope =
  paths["/api/pipeline/status"]["get"]["responses"][200]["content"]["application/json"];

export type PipelineJob = RunEnvelope["data"];

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
