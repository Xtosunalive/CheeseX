// Admission types — 实体准入 (Module 1)

// admissionStatus 值域与显示映射单源=status-display 域（PR-130；契约 CanvasAdmissionData 无枚举，
// 值域单源=域内 as const）。
import type { AdmissionStatusValue } from "@/lib/domain/StatusDisplay";

/** 入图审批列表行 */
export interface EntityRegistryItem {
  /** 架构组件名称 */
  componentName: string;
  /** 实体 ID (Node ID) */
  entityId: string;
  /** 架构分层 */
  layer: string;
  /** 实体类别 (服务/基础设施/安全/其他...) */
  category: string;
  /** 图谱引用文档路径 */
  articlePath: string | null;
  /** 准入状态（后端 canvas-admission 权威；权威缺席时前端加速缓存——WP-030） */
  admissionStatus: AdmissionStatusValue;
  /** 是否有图谱引用文档 */
  hasSourceArticle: boolean;
  /** Obsidian frontmatter 解析结果 */
  frontmatter: Record<string, unknown> | null;
}

export interface TopologyEdge {
  source: string;
  target: string;
  type: string;
}

export interface TopologyNode {
  id: string;
  label: string;
  category?: string;
  layer?: string;
}

/** NodeGovernanceView sub-tabs */
export type GovernanceTab = "registry" | "topology" | "governance";
