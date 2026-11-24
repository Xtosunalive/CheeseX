// WP-210（SPEC-100 批 4）：个体派生面 API 层——全部走批 2 generic:* 通用面（单一执法点）。
import { apiFetchJson } from "@/lib/api";
import type {
  IndividualConfigEnvelope,
  IndividualListEnvelope,
  IndividualMutationEnvelope,
  IndividualRecordEnvelope,
} from "./individuals-types";

export async function fetchIndividualConfig(classId: string): Promise<IndividualConfigEnvelope> {
  return apiFetchJson<IndividualConfigEnvelope>(`/api/individuals/${encodeURIComponent(classId)}/config`);
}

// WP-219：可用类清单（复用本体 GET——approved 类 id 排序返回；拉取失败由调用方静默回退手输）
export async function fetchIndividualClasses(): Promise<string[]> {
  const env = await apiFetchJson<{ success: boolean; data: { node_types: Record<string, { lifecycle_status?: string }> } }>("/api/schema/ontology");
  const nodeTypes = env.data?.node_types ?? {};
  return Object.keys(nodeTypes)
    .filter((id) => {
      const status = nodeTypes[id]?.lifecycle_status;
      return status === undefined || status === "approved";
    })
    .sort();
}

export async function fetchIndividualList(classId: string): Promise<IndividualListEnvelope> {
  return apiFetchJson<IndividualListEnvelope>(`/api/individuals/${encodeURIComponent(classId)}`);
}

export async function fetchIndividual(classId: string, individualId: string): Promise<IndividualRecordEnvelope> {
  return apiFetchJson<IndividualRecordEnvelope>(`/api/individuals/${encodeURIComponent(classId)}/${encodeURIComponent(individualId)}`);
}

export async function createIndividual(classId: string, fields: Record<string, unknown>): Promise<IndividualMutationEnvelope> {
  return apiFetchJson<IndividualMutationEnvelope>(`/api/individuals/${encodeURIComponent(classId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}

export async function updateIndividual(classId: string, individualId: string, fields: Record<string, unknown>, expectedRevision: string): Promise<IndividualMutationEnvelope> {
  return apiFetchJson<IndividualMutationEnvelope>(`/api/individuals/${encodeURIComponent(classId)}/${encodeURIComponent(individualId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields, expectedRevision }),
  });
}

export async function retireIndividual(classId: string, individualId: string, expectedRevision: string, confirmation = true): Promise<IndividualMutationEnvelope> {
  return apiFetchJson<IndividualMutationEnvelope>(`/api/individuals/${encodeURIComponent(classId)}/${encodeURIComponent(individualId)}/retire`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision, confirm: confirmation }),
  });
}
