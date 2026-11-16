// workbench-api.ts — 工作台聚合信号自拉端点（2026-11-17 第 2 批；第 3 批从 store 分层提为 api 模块）
import { apiFetchEnvelope } from "@/lib/api";
import type { AnomalyListData } from "@/features/anomaly-workbench/anomaly-workbench-types";
import type { ManifestListData } from "@/features/property-gov/property-types";

export async function fetchAnomalyPendingSignals(): Promise<AnomalyListData | null> {
  const env = await apiFetchEnvelope<AnomalyListData>("/api/anomalies", { cache: "no-store" });
  return env.ok ? (env.data ?? null) : null;
}

export async function fetchManifestSignals(): Promise<ManifestListData | null> {
  const env = await apiFetchEnvelope<ManifestListData>("/api/kg/query?type=article-manifests&filter=all&limit=1", { cache: "no-store" });
  return env.ok ? (env.data ?? null) : null;
}
