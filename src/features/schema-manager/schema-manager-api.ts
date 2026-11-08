// Schema Manager API layer
import { apiFetchEnvelope } from "@/lib/api";
import { SM_REQUEST_COPY } from "./schema-manager-copy";
import type { EnumsChangePreviewData, EnumsChangePreviewRequest, EnumsData } from "./schema-manager-types";
import type { paths } from "@/lib/generated/api-types";
export type SchemaSnapshot = paths["/api/schema/enums/history"]["get"]["responses"][200]["content"]["application/json"]["data"]["items"][number];

export async function fetchEnums(): Promise<EnumsData> {
  const env = await apiFetchEnvelope<EnumsData>("/api/schema/enums");
  if (!env.ok || !env.data) {
    throw new Error(env.error ?? SM_REQUEST_COPY.ENUMS_FETCH_FAILED);
  }
  return env.data;
}

export async function previewEnumsChanges(payload: EnumsChangePreviewRequest): Promise<EnumsChangePreviewData> {
  const env = await apiFetchEnvelope<EnumsChangePreviewData>("/api/schema/enums/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!env.ok || !env.data) throw new Error(env.error ?? SM_REQUEST_COPY.ENUMS_PREVIEW_FAILED);
  return env.data;
}

export async function fetchSchemaHistory(): Promise<SchemaSnapshot[]> {
  const env = await apiFetchEnvelope<{ items: SchemaSnapshot[] }>("/api/schema/enums/history");
  if (!env.ok || !env.data) throw new Error(env.error ?? SM_REQUEST_COPY.SCHEMA_HISTORY_LOAD_FAILED);
  return env.data.items;
}
