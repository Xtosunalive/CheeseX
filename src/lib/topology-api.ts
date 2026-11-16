// topology-api — 拓扑总览读面（2026-11-15 运行概览退役批自 features/dashboard 迁入 lib——
// 消费面＝topology-store（图谱检索枢纽/缺口引擎），api 模块随 store 同居 lib 层；
// 裸 fetch 同步改信封出口 apiFetchEnvelope（ADR-019 §二，旧 features 面豁免不随迁））。
import type { paths } from "@/lib/generated/api-types";
import { apiFetchEnvelope } from "@/lib/api";
import { topologyRequestFailed } from "./lib-copy";

export type TopologyRawResponse =
  paths["/api/dashboard/topology"]["get"]["responses"][200]["content"]["application/json"];

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchTopology(scope: "full" | "architecture" = "full"): Promise<TopologyRawResponse> {
  const env = await apiFetchEnvelope<TopologyRawResponse["data"]>(`/api/dashboard/topology?scope=${scope}`, { cache: "no-store" });
  if (!env.ok || !env.data) {
    throw new DashboardApiError(
      env.error || topologyRequestFailed(env.status),
      env.errorCode || "UNKNOWN_ERROR",
      env.status,
    );
  }
  // 返回形状保持旧 envelope body（{success, data}）——topology-store 消费面 d.data.* 零改动
  return { success: true, data: env.data } as TopologyRawResponse;
}
