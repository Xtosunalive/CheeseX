// architecture-projection-types.ts — C1 UI derived types for projection flow

export type ProjectionNodeType =
  | "start"
  | "entity"
  | "decision"
  | "implicit"
  | "ambiguous"
  | "unresolved"
  | "missing"
  | "empty"
  | "success";

export interface ProjectionFlowNodeData {
  nodeType: ProjectionNodeType;
  label: string;
  sourceNodeId?: string;
  pathNodeIds?: string[];
  evidenceKey?: string;
  alternateCount?: number;
  pairNodes?: { nodeA: string; nodeB: string };
  /** 拓扑模式：实体类别（CATEGORY_COLORS 上色用） */
  category?: string;
  /** 拓扑模式：连接数（三上下文侧栏用） */
  degree?: number;
}

export interface ProjectionFlowEdgeData {
  edgeType: "connected" | "implicit" | "ambiguous" | "unresolved" | "missing" | "topology";
  label: string;
  evidenceKey?: string;
  /** 拓扑模式：关系类型（RELATION_COLORS 上色 + RELATION_TYPES 中文标签用） */
  relationType?: string;
  /** 拓扑模式：TopoEdge 稳定身份（三上下文侧栏选中用） */
  edgeId?: string;
  /** 拓扑模式：证据文件（从哪来） */
  sourceFile?: string;
  lineNumber?: number;
  /** 拓扑模式：审核状态（AI 提议 pending / 人裁定 approved） */
  reviewStatus?: string;
  /** 拓扑模式：provenance 直通（ruleId/ruleRevision/confidence 等，按数据诚实度原则原样透传） */
  properties?: Record<string, unknown>;
}

export interface ProjectionEvidence {
  type: "implicit_path" | "unresolved_pair" | "missing_seed" | "success";
  label: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  pathNodeIds?: string[];
  nodeCount?: number;
  isImplicit?: boolean;
  isAmbiguous?: boolean;
  alternateCount?: number;
  pairNodes?: { nodeA: string; nodeB: string };
  dataFreshness?: { fresh: boolean; ageHours: number; updatedAt: string; version: string };
}

export type ProjectionFilter = "all" | "implicit" | "unresolved" | "missing";

export interface ProjectionModel {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: ProjectionFlowNodeData }>;
  edges: Array<{ id: string; source: string; target: string; data?: ProjectionFlowEdgeData }>;
  evidenceIndex: Map<string, ProjectionEvidence>;
  meta: {
    seedCount: number;
    implicitCount: number;
    unresolvedCount: number;
    missingCount: number;
    isComplete: boolean;
    /** 拓扑层：参与渲染的实体节点数 */
    nodeCount: number;
    /** 拓扑层：真实互联边数（悬空边已剔除） */
    edgeCount: number;
  };
}

/** buildProjectionModel 选项：showGaps=true 时在拓扑层之上叠加缺口诊断层（能力保留，默认关） */
export interface ProjectionOptions {
  showGaps?: boolean;
}

/** 枢纽选中回调载荷：实体节点或真实拓扑边（edgeId = TopoEdge 稳定身份） */
export type ProjectionSelection =
  | { kind: "node"; nodeId: string }
  | { kind: "edge"; edgeId: string };
