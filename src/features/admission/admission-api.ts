// Admission API layer — 实体准入 (Module 1)

import { apiFetchEnvelope, apiFetchJson } from "@/lib/api";
import type { paths } from "@/lib/generated/api-types";
import { ADMISSION_REQUEST_COPY } from "./admission-copy";

// ── 准入 ──

type CanvasAdmissionEnvelope = paths["/api/kg/canvas-admission"]["get"]["responses"][200]["content"]["application/json"];
export type AdmissionResponse = NonNullable<CanvasAdmissionEnvelope["data"]>;

export async function fetchCanvasAdmission(): Promise<CanvasAdmissionEnvelope> {
  return apiFetchJson<CanvasAdmissionEnvelope>("/api/kg/canvas-admission");
}

// ── 分类列表 ──

type ClassificationEnvelope = paths["/api/kg/classification/list"]["get"]["responses"][200]["content"]["application/json"];
export type ClassificationListData = NonNullable<ClassificationEnvelope["data"]>;
export type ClassificationItem = ClassificationListData["items"][number];

export async function fetchClassificationList(): Promise<{ success: boolean; data: ClassificationListData }> {
  // seq184（前端纯净度规则①）：改走标准 envelope，错误文案回显后端 env.error，中性兜底仅在信封异常时出现
  const env = await apiFetchEnvelope<ClassificationListData>("/api/kg/classification/list");
  if (!env.ok || !env.data) throw new Error(env.error ?? ADMISSION_REQUEST_COPY.CLASSIFICATION_MISSING_DATA);
  return { success: env.ok, data: env.data };
}
