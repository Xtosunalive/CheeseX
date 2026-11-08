// schema-write-api.ts — Schema 权威源直接写回 API（ADR043 E3'b2：替代 Schema Proposal 生命周期）
import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import { SM_REQUEST_COPY } from "./schema-manager-copy";

export type SchemaWriteResult = {
  category: string;
  revision: string;
  affectedFile?: string;
  backupPath?: string;
  product?: string;
  version?: string;
  /** WP-B 出生反查（field=entity create 时返回）：提及该新实体的文章坐标 */
  backlinks?: Array<{ file: string; coordinate?: string }>;
};

function write(method: "PUT" | "POST", path: string, payload: unknown, fallback: string): Promise<SchemaWriteResult> {
  return unwrapEnvelope(apiFetchEnvelope<SchemaWriteResult>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), fallback);
}

export function writeOntology(revision: string, patch: Record<string, unknown>): Promise<SchemaWriteResult> {
  return write("PUT", "/api/schema/ontology", { revision, patch }, SM_REQUEST_COPY.ONTOLOGY_SAVE_FAILED);
}

export function writeEnums(revision: string, patch: Record<string, unknown>): Promise<SchemaWriteResult> {
  return write("PUT", "/api/schema/enums", { revision, patch }, SM_REQUEST_COPY.RULES_SAVE_FAILED);
}

export function writeDependencies(revision: string, patch: Record<string, unknown>): Promise<SchemaWriteResult> {
  return write("PUT", "/api/schema/dependencies", { revision, patch }, SM_REQUEST_COPY.DEPENDENCY_SAVE_FAILED);
}

export function writeVersions(revision: string, patch: Record<string, unknown>): Promise<SchemaWriteResult> {
  return write("PUT", "/api/schema/versions", { revision, patch }, SM_REQUEST_COPY.VERSIONS_SAVE_FAILED);
}

export function writeProductIdentity(revision: string, patch: Record<string, unknown>): Promise<SchemaWriteResult> {
  return write("PUT", "/api/schema/product-identity", { revision, patch }, SM_REQUEST_COPY.PRODUCT_IDENTITY_SAVE_FAILED);
}

export function freezeVersion(revision: string, product: string, version: string): Promise<SchemaWriteResult> {
  return write("POST", "/api/schema/versions/freeze", { revision, product, version }, SM_REQUEST_COPY.VERSION_FREEZE_FAILED);
}

export function absorbDiscovery(revision: string, patch: Record<string, unknown>): Promise<SchemaWriteResult> {
  return write("POST", "/api/schema/discovery/absorb", { revision, patch }, SM_REQUEST_COPY.DISCOVERY_ABSORB_FAILED);
}

export function rollbackEnums(revision: string, snapshotId: string): Promise<SchemaWriteResult> {
  return write("POST", "/api/schema/enums/rollback", { revision, snapshotId }, SM_REQUEST_COPY.ENUMS_ROLLBACK_FAILED);
}
