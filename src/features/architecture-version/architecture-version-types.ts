import type { components, paths } from "@/lib/generated/api-types";

type ProductVersionsOperation = paths["/api/kg/product-versions"]["get"];
type CompareOperation = paths["/api/kg/architecture-version-compare"]["get"];

export type ProductVersionList = ProductVersionsOperation["responses"][200]["content"]["application/json"]["data"];
export type ProductVersion = ProductVersionList["items"][number];
export type ArchitectureVersionComparison = CompareOperation["responses"][200]["content"]["application/json"]["data"];
export type ArchitectureVersionComponent = components["schemas"]["ArchitectureVersionComponent"];
export type ArchitectureVersionComponentChange = components["schemas"]["ArchitectureVersionComponentChange"];
export type ArchitectureVersionRelation = components["schemas"]["ArchitectureVersionRelation"];
export type ArchitectureVersionDocument = components["schemas"]["ArchitectureVersionDocument"];
export type ArchitectureVersionDocumentChange = components["schemas"]["ArchitectureVersionDocumentChange"];
