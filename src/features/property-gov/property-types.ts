// property-types.ts — 文章图谱映射 + 架构组件属性类型定义

export interface ManifestItem {
  sourcePath: string;
  normalizedSourcePath: string;
  title: string;
  kind: string;
  nodeEvidenceCount: number;
  directRelationCount: number;
  manifest: ManifestStatus;
  manifestMode?: string;
  excluded?: boolean;
  exclusionReason?: string | null;
  eligible?: boolean;
}

export interface ManifestStatus {
  exists: boolean;
  fresh: boolean;
  status: string;
  relativePath: string | null;
  reason: string;
}

export interface LegacySummary {
  totalSources: number;
  totalManifests: number;
  fresh: number;
  missing: number;
  stale: number;
  unknown: number;
}

export interface CoverageSummary extends LegacySummary {
  totalSourcesRaw: number;
  excludedSources: number;
  eligibleSources: number;
  relationalManifests: number;
  sourceOnlyManifests: number;
  coveredSources: number;
  missingEligible: number;
  coverageRatio: number;
}

export interface ManifestListData {
  releaseId: string;
  sourceCommit: string;
  summary: LegacySummary | CoverageSummary;
  items: ManifestItem[];
}

export function isCoverageSummary(s: LegacySummary | CoverageSummary | null | undefined): s is CoverageSummary {
  return s != null && (s as CoverageSummary).coverageRatio !== undefined;
}

// ── Check Result types (P-04) ──

export interface CheckResultItem {
  componentId: string;
  label: string;
  module: string | null;
  archLayer: string;
  sourcePath: string;
  sourcePathExists: boolean;
  sourceRevision?: EntitySourceRevision;
  checks: CheckResults;
}

export interface EntitySourceRevision {
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export type WorkingRevisions = Record<string, string | null | undefined>;

export interface CheckResults {
  /** 索引签名：服务端按 checkKey 动态下发条目，消费侧可按键安全读取（每项至多携带可选 passed） */
  [key: string]: { passed?: boolean } | undefined;
  missing_module: { passed: boolean };
  invalid_module: { passed: boolean; value: string; validModules: string[] };
  stale_property: { passed: boolean; articleMtime: string; propertyExtractedAt: string };
  mount_mismatch: { passed: boolean; matchedEntityId: string | null };
  mount_diagnostic: { passed?: boolean; entityCount: number; edgeCount: number; missingEntityIds: string[] };
  format_artifact: { passed: boolean; artifacts: FormatArtifact[] };
  document_module_entity?: { passed: boolean; moduleName: string; moduleInEnums: boolean; hasEntity: boolean; matchedEntityId: string | null; docTitle: string; docFilePath: string; reason: string };
}

export interface FormatArtifact {
  field: string;
  rawValue: string;
  normalizedValue: string;
  /** 后端单源旗标（property-format-scan.cjs 写入）：normalizedValue 为复杂对象占位符、不可自动归一化时置 true；
      普通 artifact 省略本键。前端按本字段决定是否可提案写回，不按 normalizedValue 文案判等。 */
  requiresManualConfirm?: boolean;
}

export interface CheckSummary {
  totalComponents: number;
  blockerCount: number;
  warningCount: number;
  healthyCount: number;
  coverageRatio: number;
}

export interface CheckResponse {
  summary: CheckSummary;
  total: number;
  limit: number;
  offset: number;
  items: CheckResultItem[];
  workingRevisions?: WorkingRevisions;
}

export type RepairAction = "set_module" | "overwrite_module" | "normalize_format";

export interface RepairPayload {
  module?: string;
  field?: string;
  value?: string;
  /** 透传来源 artifact 的 requiresManualConfirm 旗标；写回守卫按本字段判等，不按 value 文案判等。 */
  requiresManualConfirm?: boolean;
}

// E2'b：graph-fact Proposal 退役，直接写回结果类型统一来自 entity-repair-api（EntityRepairApplyData）

export type CheckFilter =
  | "all"
  | "blocker"
  | "warning"
  | "missing_module"
  | "invalid_module"
  | "stale"
  | "mount_mismatch"
  | "format_artifact"
  | "document_module_entity";

// WP-151：映射筛选标签迁入页级文案单源 property-gov-copy.ts（MANIFEST_FILTER_LABELS），本处原名再导出（消费点零改动）
export { MANIFEST_FILTER_LABELS as FILTER_LABELS } from "./property-gov-copy";

export const LEGACY_FILTERS = ["all", "missing", "fresh", "stale", "unknown"] as const;
export const COVERAGE_FILTERS = ["relational", "source_only", "excluded", "missing_eligible"] as const;
