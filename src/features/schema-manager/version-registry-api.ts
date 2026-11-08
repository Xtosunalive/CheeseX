import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import { SM_REQUEST_COPY } from "./schema-manager-copy";
import type { ProductIdentityData, VersionFreezePayload, VersionFreezeResult, VersionRegistryData, VersionRegistryWritePayload } from "./schema-manager-types";

export function fetchVersionRegistry(): Promise<VersionRegistryData> {
  return unwrapEnvelope(apiFetchEnvelope<VersionRegistryData>("/api/schema/versions"), SM_REQUEST_COPY.VERSIONS_LOAD_FAILED);
}

export function fetchProductIdentity(): Promise<ProductIdentityData> {
  return unwrapEnvelope(apiFetchEnvelope<ProductIdentityData>("/api/schema/product-identity"), SM_REQUEST_COPY.PRODUCT_IDENTITY_LOAD_FAILED);
}

export function validateVersionRegistry(payload: VersionRegistryWritePayload): Promise<VersionRegistryData> {
  return unwrapEnvelope(apiFetchEnvelope<VersionRegistryData>("/api/schema/versions/validate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }), SM_REQUEST_COPY.VERSIONS_VALIDATE_FAILED);
}

export function freezeProductVersion(revision: string, product: string, version: string): Promise<VersionFreezeResult> {
  const payload: VersionFreezePayload = { revision, product, version };
  return unwrapEnvelope(apiFetchEnvelope<VersionFreezeResult>("/api/schema/versions/freeze", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }), SM_REQUEST_COPY.VERSION_FREEZE_FAILED);
}
