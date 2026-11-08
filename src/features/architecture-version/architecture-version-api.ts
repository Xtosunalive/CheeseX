import { apiFetchEnvelope } from "@/lib/api";
import type { ArchitectureVersionComparison, ProductVersionList } from "./architecture-version-types";
import { AV_REQUEST_COPY } from "./architecture-version-copy";

export class ArchitectureVersionApiError extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message);
    this.name = "ArchitectureVersionApiError";
  }
}

function unwrap<T>(result: Awaited<ReturnType<typeof apiFetchEnvelope<T>>>, fallback: string): T {
  if (!result.ok || !result.data) throw new ArchitectureVersionApiError(result.error || fallback, result.errorCode);
  return result.data;
}

export async function fetchProductVersions(): Promise<ProductVersionList> {
  return unwrap(await apiFetchEnvelope<ProductVersionList>("/api/kg/product-versions"), AV_REQUEST_COPY.LOAD_FAILED);
}

export async function compareArchitectureVersions(product: string, source: string, target: string): Promise<ArchitectureVersionComparison> {
  const query = new URLSearchParams({ product, source, target });
  return unwrap(
    await apiFetchEnvelope<ArchitectureVersionComparison>(`/api/kg/architecture-version-compare?${query.toString()}`),
    AV_REQUEST_COPY.COMPARE_FAILED,
  );
}
