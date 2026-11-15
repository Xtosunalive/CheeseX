// Component: Entity-Compliance Types — from OpenAPI contract
// @responsible: 导出源文档校验页面使用的契约类型与查询参数类型。
// @inputs: 生成的 OpenAPI TypeScript components
// @outputs: 源文档校验 TypeScript 类型别名
// @context: Canvas
import type { components } from "@/lib/generated/api-types";

export type EntityCheckData = components["schemas"]["EntityCheckData"];
// ComplianceSummary 别名随 2026-11-15 MAIC 形态批退役（唯一消费面 SummaryBar 撤）——
// 契约面不受影响：summary 形状由生成物 components["schemas"]["ComplianceSummary"] 单源承载
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
