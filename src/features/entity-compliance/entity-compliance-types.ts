// Component: Entity-Compliance Types — from OpenAPI contract
// @responsible: 导出源文档校验页面使用的契约类型与查询参数类型。
// @inputs: 生成的 OpenAPI TypeScript components
// @outputs: 源文档校验 TypeScript 类型别名
// @context: Canvas
import type { components } from "@/lib/generated/api-types";

export type EntityCheckData = components["schemas"]["EntityCheckData"];
export type ComplianceSummary = components["schemas"]["ComplianceSummary"];
export type EntityComplianceResult = components["schemas"]["EntityComplianceResult"];
export type ComplianceGroup = components["schemas"]["ComplianceGroup"];
export type ComplianceFinding = components["schemas"]["ComplianceFinding"];
export type EntitySourceRevision = components["schemas"]["EntitySourceRevision"];
export type EntityRepairPreviewRequest = components["schemas"]["EntityRepairPreviewRequest"];
export type EntityRepairPreviewData = components["schemas"]["EntityRepairPreviewData"];
export type EntityRepairApplyData = components["schemas"]["EntityRepairApplyData"];

export type EntityRepairChanges = Record<string, unknown>;
export type EntityRelationPatch = components["schemas"]["EntityRelationPatch"];

export type ComplianceFilter = "all" | "blocker" | "warning" | "info" | "healthy";

export type EntityCheckParams = {
  filter?: ComplianceFilter;
  q?: string;
  limit?: number;
  offset?: number;
};
