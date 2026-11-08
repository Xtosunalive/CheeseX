// property-api.ts — 文章图谱映射 + 架构组件属性 API 调用
import { apiFetchEnvelope, apiFetchJson } from "@/lib/api";
import type { paths } from "@/lib/generated/api-types";
import type {
  CheckResponse,
  CheckResultItem,
  ManifestListData,
  RepairAction,
  RepairPayload,
} from "./property-types";
import { previewEntityRepair, applyEntityRepair } from "@/lib/domain/entity-repair-api";
import type { EntityRepairApplyData } from "@/lib/domain/entity-repair-api";
import { PROPERTY_REQUEST_COPY, pipelineStatusFetchFailed } from "./property-gov-copy";

// ── Manifest list (existing) ──

export async function fetchArticleManifests(params: {
  filter: string; q: string; limit: number; offset: number;
}) {
  const p = new URLSearchParams({
    filter: params.filter, q: params.q,
    limit: String(params.limit), offset: String(params.offset),
  });
  return apiFetchEnvelope<ManifestListData>(`/api/kg/query?type=article-manifests&${p}`);
}

// ── Pipeline health (existing) ──

type PipelineStatusEnvelope = paths["/api/pipeline/status"]["get"]["responses"][200]["content"]["application/json"];
export type PipelineJob = PipelineStatusEnvelope["data"];

export async function fetchPipelineGenStatus(): Promise<PipelineJob> {
  const response = await fetch("/api/pipeline/status", { cache: "no-store" });
  const envelope = (await response.json()) as PipelineStatusEnvelope & { message?: string; error?: string };
  if (!response.ok) throw new Error(envelope.message || envelope.error || pipelineStatusFetchFailed(response.status));
  return envelope.data;
}

// ── Check results ──

export async function fetchCheckResults(params: {
  filter?: string; q?: string; limit?: number; offset?: number;
}): Promise<CheckResponse> {
  const p = new URLSearchParams({
    filter: params.filter || "all", q: params.q || "",
    limit: String(params.limit ?? 50), offset: String(params.offset ?? 0),
  });
  const env = await apiFetchEnvelope<CheckResponse>(`/api/property/check?${p}`);
  if (!env.ok || !env.data) throw new Error(env.error ?? PROPERTY_REQUEST_COPY.CHECK_RESULTS_FETCH_FAILED);
  return env.data;
}

// ── Repair ──

function proposalChanges(action: RepairAction, payload: RepairPayload): Record<string, unknown> {
  if (action === "set_module" || action === "overwrite_module") {
    // seq201（前端纯净度规则①清存量）：纯客户端必填守卫改中性技术诊断，不再自造业务话术；正常路径由 UI 禁用态前置拦截
    if (!payload.module) throw new Error("module is required for this repair");
    return { module: [payload.module] };
  }
  if (!payload.field || !payload.value || payload.requiresManualConfirm === true) {
    // seq201（前端纯净度规则①清存量）：写回守卫改中性技术诊断——按后端下发的 requiresManualConfirm 结构化旗标判等
    // （不再按 normalizedValue 占位文案判等）；写回合法性最终由 preview/apply 后端裁决
    throw new Error("complex-object placeholder requires manual confirmation before write-back");
  }
  const field = payload.field === "arch_status" ? "status" : payload.field;
  return { [field]: field === "module" ? [payload.value] : payload.value };
}

export async function applyPropertyRepair(
  item: CheckResultItem,
  action: RepairAction,
  payload: RepairPayload,
): Promise<EntityRepairApplyData> {
  if (!item.sourcePath || !item.sourceRevision) {
    // seq201（前端纯净度规则①清存量）：写前完整性守卫改中性技术诊断——缺来源标识时后端 preview 必拒，此处提前拦截省一次无效请求
    throw new Error("source path or source revision is missing; refresh the working copy");
  }
  const preview = await previewEntityRepair({
    sourceKey: item.sourcePath,
    sourceRevision: item.sourceRevision,
    createIfMissing: false,
    changes: proposalChanges(action, payload),
  });
  return applyEntityRepair(preview.previewId);
}

// ── Refresh ──

export async function refreshProperty(componentId: string): Promise<{ componentId: string; queued: boolean }> {
  // seq201（前端纯净度规则①清存量，规则①TemplateLiteral 缺口载体）：改走共享 apiFetchJson——
  // 本端点非标准 envelope（直返 {componentId,queued}），!ok 由 apiFetch 以中性技术文案（API <status>）抛出，退役前端自造「刷新失败」话术
  return apiFetchJson<{ componentId: string; queued: boolean }>("/api/property/refresh", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ componentId }),
  });
}
