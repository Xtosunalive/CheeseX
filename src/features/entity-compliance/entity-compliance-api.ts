// Component: Entity-Compliance API
// @responsible: 封装源文档校验列表查询的前端 HTTP 调用。
// @inputs: EntityCheckParams 与 API envelope
// @outputs: EntityCheckData Promise
// @context: Canvas
import { apiFetchEnvelope } from "@/lib/api";
import type {
  EntityCheckData, EntityCheckParams, EntityComplianceResult,
} from "./entity-compliance-types";
import { EC_REQUEST_COPY } from "./entity-compliance-copy";
export { previewEntityRepair, applyEntityRepair } from "@/lib/domain/entity-repair-api";

export async function fetchEntityCompliance(params: EntityCheckParams = {}): Promise<EntityCheckData> {
  const q = new URLSearchParams();
  if (params.filter && params.filter !== "all") q.set("filter", params.filter);
  if (params.q) q.set("q", params.q);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  const qs = q.toString();
  const env = await apiFetchEnvelope<EntityCheckData>(qs ? `/api/entity/check?${qs}` : "/api/entity/check");
  if (!env.ok || !env.data) throw new Error(env.error || EC_REQUEST_COPY.CHECK_FAILED);
  return env.data;
}

// seq205 展示即事实：单实体现读现算（契约 06 编辑前重读）。返回与全量扫描 items 条目同形的最新结果。
export async function fetchEntityCheckOne(sourceKey: string): Promise<EntityComplianceResult> {
  const env = await apiFetchEnvelope<{ result: EntityComplianceResult; checkedAt: string }>(
    `/api/entity/check-one?sourceKey=${encodeURIComponent(sourceKey)}`,
  );
  if (!env.ok || !env.data) throw new Error(env.error || EC_REQUEST_COPY.CHECK_ONE_FAILED);
  return env.data.result;
}
