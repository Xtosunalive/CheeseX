import { apiFetchEnvelope } from "@/lib/api";
import type {
  DocumentSearchParams,
  CandidateSearchResponse,
  DocumentDetailResponse,
  SearchDocumentsResponse,
} from "./document-inventory-types";
import { DOCUMENT_REQUEST_COPY } from "./document-inventory-copy";

export class DocumentInventoryApiError extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message);
    this.name = "DocumentInventoryApiError";
  }
}

export function buildDocumentSearchQuery(filters: DocumentSearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : `${value}`);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function unwrap<T>(result: Awaited<ReturnType<typeof apiFetchEnvelope<T>>>, fallback: string): T {
  if (!result.ok || !result.data) throw new DocumentInventoryApiError(result.error || fallback, result.errorCode);
  return result.data;
}

export async function searchDocuments(filters: DocumentSearchParams): Promise<SearchDocumentsResponse> {
  return unwrap(await apiFetchEnvelope<SearchDocumentsResponse>(`/api/documents/search${buildDocumentSearchQuery(filters)}`), DOCUMENT_REQUEST_COPY.SEARCH_FAILED);
}

export async function searchArticleCandidates(keyword: string): Promise<CandidateSearchResponse> {
  const query = new URLSearchParams({ keyword, limit: "50", offset: "0" });
  return unwrap(await apiFetchEnvelope<CandidateSearchResponse>(`/api/articles/candidates/search?${query}`), DOCUMENT_REQUEST_COPY.CANDIDATE_SEARCH_FAILED);
}

export async function fetchDocument(documentId: string): Promise<DocumentDetailResponse> {
  return unwrap(await apiFetchEnvelope<DocumentDetailResponse>(`/api/documents/${encodeURIComponent(documentId)}`), DOCUMENT_REQUEST_COPY.DETAIL_FAILED);
}
