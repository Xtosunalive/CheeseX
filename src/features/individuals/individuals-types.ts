import type { ScreenContract } from "@/lib/contract-renderer";

// WP-210（SPEC-100 批 4）：个体派生面类型（含响应信封——契约 config/个体面响应同形状）。
export interface IndividualFieldConfig {
  name: string;
  display: string;
  required: boolean;
  type: string;
  declared: boolean;
}

export interface IndividualUiConfig {
  classId: string;
  lifecycle_status?: "draft" | "review" | "approved" | "deprecated" | "retired" | null;
  fields: IndividualFieldConfig[];
  screen: ScreenContract | null;
  actions: { create: string; list: string; read: string; update: string; retire: string };
}

export interface IndividualListItem {
  individualId: string;
  title: string;
  revision: string;
  fields: Record<string, unknown>;
}

export interface IndividualConfigEnvelope {
  success: boolean;
  error?: string;
  data: IndividualUiConfig;
}

export interface IndividualListEnvelope {
  success: boolean;
  error?: string;
  data: IndividualListItem[];
}

export interface IndividualRecordEnvelope {
  success: boolean;
  error?: string;
  data: { classId: string; individualId: string; fields: Record<string, unknown>; revision: string };
}

export interface IndividualMutationEnvelope {
  success: boolean;
  error?: string;
  data: { classId?: string; individualId?: string; path?: string; revision?: string; retired?: boolean; alreadyRetired?: boolean };
}
