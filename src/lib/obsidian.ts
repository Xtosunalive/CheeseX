import type { paths } from "@/lib/generated/api-types";
import { apiFetchEnvelope } from "@/lib/api";
import { LIB_REQUEST_COPY } from "./lib-copy";

type ObsidianOpenData = paths["/api/system/open-obsidian"]["post"]["responses"][200]["content"]["application/json"]["data"];

export function resolveObsidianSourcePath(profile: { properties?: Record<string, unknown> } | null): string {
  const properties = profile?.properties || {};
  const value = properties.file_path || properties.sourcePath || properties.source_path || properties.source_vault_path;
  return typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
}

export async function openObsidianFile(relativePath: string): Promise<ObsidianOpenData> {
  const sourcePath = relativePath.trim().replace(/\\/g, "/");
  // seq201（前端纯净度规则①清存量）：入参完整性守卫改中性技术诊断，不再自造业务话术
  if (!sourcePath) throw new Error("source document path is empty");
  const response = await apiFetchEnvelope<ObsidianOpenData>("/api/system/open-obsidian", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath }),
  });
  if (!response.ok || !response.data) throw new Error(response.error || LIB_REQUEST_COPY.OBSIDIAN_OPEN_FAILED);
  return response.data;
}
