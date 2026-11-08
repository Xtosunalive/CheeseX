// Graph data DTO types — separated from store for DDD contract layer

import type { components } from "./generated/api-types";

type FormalReleaseIdentity = components["schemas"]["FormalReleaseIdentity"];

export interface ComponentInfo {
  id: string;
  label: string;
  arch_layer?: string;
  layer?: string;
  arch_category?: string;
  sourcePath?: string;
}

export interface LayerInfo {
  id: string;
  label: string;
  rank?: number;
}

export interface GapInfo {
  id?: string;
  componentId?: string;
  title?: string;
  label?: string;
  detail?: string;
  severity?: string;
  missing?: string[];
  hasGraphNode?: boolean;
  hasWikiPage?: boolean;
  hasContent?: boolean;
  relationCount?: number;
  wikiPath?: string;
  layer?: string;
}

export interface AuditInfo {
  summary: Record<string, unknown>;
  edgeReconciliation?: unknown;
  rulesVersion?: string;
}

export interface GraphDataSet extends FormalReleaseIdentity {
  /** ADR064 正式代次新鲜度（stale=当前数据来自工作投影） */
  freshness?: components["schemas"]["ReleaseFreshness"];
  components: ComponentInfo[];
  layers: LayerInfo[];
  dependencies: unknown[];
  crosscutting: string[];
  gaps: GapInfo[];
  candidates: unknown[];
  coverage: unknown;
  audit: AuditInfo | null;
  layout: unknown;
  version: string;
  updatedAt: string;
  product: string;
}
