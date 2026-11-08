import { apiFetchEnvelope } from "@/lib/api";
import { SM_REQUEST_COPY } from "./schema-manager-copy";
import type { DependencyImpactPreviewData, DependencyRulesData, DependencyRuleSavePayload } from "./schema-manager-types";

export async function fetchDependencyRules(): Promise<DependencyRulesData> {
  const env = await apiFetchEnvelope<DependencyRulesData>("/api/schema/dependencies");
  if (!env.ok || !env.data) {
    throw new Error(env.error ?? SM_REQUEST_COPY.DEPENDENCY_FETCH_FAILED);
  }
  return env.data;
}

export async function validateDependencyRules(payload: DependencyRuleSavePayload): Promise<DependencyRulesData> {
  const env = await apiFetchEnvelope<DependencyRulesData>("/api/schema/dependencies/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error ?? SM_REQUEST_COPY.DEPENDENCY_VALIDATE_FAILED);
  }
  return env.data;
}

export async function previewDependencyRules(payload: DependencyRuleSavePayload): Promise<DependencyImpactPreviewData> {
  const env = await apiFetchEnvelope<DependencyImpactPreviewData>("/api/schema/dependencies/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!env.ok || !env.data) throw new Error(env.error ?? SM_REQUEST_COPY.DEPENDENCY_PREVIEW_FAILED);
  return env.data;
}
