// Edge-API — EDGE-RELATION-GOV-001 阶段 4 前端通道（辖区纪律：只消费 gen:api-types 生成类型，不手搓字段）。
// 两条通道：① /api/schema/relations 实例账读/写（乐观锁 revision）② /api/edges 出链/反链/邻域查询。
import type { components, paths } from "./generated/api-types";
import { edgeApiRequestFailed } from "./lib-copy";

export type RelationInstance = components["schemas"]["RelationInstance"];
export type EdgeRecord = components["schemas"]["EdgeRecord"];
export type RelationsBundle = components["schemas"]["RelationsListData"];
export type EdgeListData = components["schemas"]["EdgeListData"];
export type EdgeNeighborhoodData = components["schemas"]["EdgeNeighborhoodData"];

type ApiEnvelope<T> = { success: boolean; data: T; error_code?: string; message?: string; trace_id?: string };

async function call<T>(input: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(input, init);
  const body = (await response.json()) as ApiEnvelope<T> & { details?: unknown };
  if (!response.ok || body.success === false) {
    const error = new Error(body.message || edgeApiRequestFailed(response.status)) as Error & { code?: string; status?: number; details?: unknown };
    error.code = body.error_code;
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  return body;
}

export function fetchRelationsBundle(): Promise<ApiEnvelope<RelationsBundle>> {
  return call("/api/schema/relations");
}

export function saveRelations(payload: paths["/api/schema/relations"]["put"]["requestBody"]["content"]["application/json"]): Promise<ApiEnvelope<components["schemas"]["RelationsWriteData"]>> {
  return call("/api/schema/relations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type EdgeQuery = { node: string; direction?: "out" | "in" | "both"; relationType?: string; limit?: number };

export function fetchEdges(q: EdgeQuery): Promise<ApiEnvelope<EdgeListData>> {
  const params = new URLSearchParams({ node: q.node, direction: q.direction || "both" });
  if (q.relationType) params.set("relationType", q.relationType);
  if (q.limit) params.set("limit", String(q.limit));
  return call(`/api/edges?${params.toString()}`);
}

export function fetchNeighborhood(node: string, hops: number, relationType?: string): Promise<ApiEnvelope<EdgeNeighborhoodData>> {
  const params = new URLSearchParams({ node, hops: String(hops) });
  if (relationType) params.set("relationType", relationType);
  return call(`/api/edges/neighborhood?${params.toString()}`);
}
