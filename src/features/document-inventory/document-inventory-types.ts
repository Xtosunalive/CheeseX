import type { paths } from "@/lib/generated/api-types";
import type { RequestStatus } from "@/lib/request-status";

export type DocumentSearchParams = NonNullable<paths["/api/documents/search"]["get"]["parameters"]["query"]>;
export type SearchDocumentsResponse = paths["/api/documents/search"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type DocumentDetailResponse = paths["/api/documents/{documentId}"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type DocumentInventoryDocument = SearchDocumentsResponse["documents"][number] & {
  readablePath?: string;
};
export type CandidateSearchResponse = paths["/api/articles/candidates/search"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type DocumentFacetOption = NonNullable<SearchDocumentsResponse["availableFilters"]["tags"]>[number];

/** 别名：定义单源在 @/lib/request-status（interaction-state 域） */
export type QueryStatus = RequestStatus;
export type ExpandedCards = Record<string, boolean>;
