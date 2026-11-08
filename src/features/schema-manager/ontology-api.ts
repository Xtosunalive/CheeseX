// Ontology API client — 直接读写权威源（E3'b2：替代 Proposal ontology 读取）
import { apiFetchEnvelope } from "@/lib/api";
import { SM_REQUEST_COPY } from "./schema-manager-copy";
import type { OntologyData } from "./schema-manager-types";

export async function fetchOntology(): Promise<OntologyData> {
  const env = await apiFetchEnvelope<OntologyData>("/api/schema/ontology");
  if (!env.ok || !env.data) {
    throw new Error(env.error ?? SM_REQUEST_COPY.ONTOLOGY_FETCH_FAILED);
  }
  return env.data;
}
