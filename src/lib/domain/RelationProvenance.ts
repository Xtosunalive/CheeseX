/** 「全部」筛选哨兵——属数据非文案（term-copy 域裁定不入 TERM），消费点按名引用、不手写中文（WP-152） */
export const RELATION_SOURCE_GROUP_ALL = "全部";

/** 关系来源六分组正名的具名出口（RELATION_SOURCE_GROUPS 成员——消费点按名引用、不手写中文键，WP-152） */
export const RELATION_PROVENANCE_GROUP = {
  BODY_REFERENCE: "正文引用",
  STRUCTURE_LINK: "结构关联",
  BODY_INFERENCE: "正文推断",
  AGGREGATE_INFERENCE: "聚合推断",
  PLATE_DERIVED: "板块派生",
  SYSTEM_SOURCE: "系统来源",
} as const;

export const RELATION_SOURCE_GROUPS = [
  RELATION_SOURCE_GROUP_ALL,
  RELATION_PROVENANCE_GROUP.BODY_REFERENCE,
  RELATION_PROVENANCE_GROUP.STRUCTURE_LINK,
  RELATION_PROVENANCE_GROUP.BODY_INFERENCE,
  RELATION_PROVENANCE_GROUP.AGGREGATE_INFERENCE,
  RELATION_PROVENANCE_GROUP.PLATE_DERIVED,
  RELATION_PROVENANCE_GROUP.SYSTEM_SOURCE,
] as const;

export type RelationSourceGroup = (typeof RELATION_SOURCE_GROUPS)[number];
export type RelationProvenanceGroup = Exclude<RelationSourceGroup, typeof RELATION_SOURCE_GROUP_ALL>;

export type RelationProvenanceMeta = {
  group: RelationProvenanceGroup;
  label: string;
  description: string;
};

export const RELATION_SOURCE_KEYS = [
  "entity-wikilink",
  "category-path",
  "document-frontmatter",
  "document-body",
  "document-body-version",
  "concept-body",
  "multi-source-inference",
  "plate-aggregation",
  "plate-product-link",
  "plate-system-aggregation",
  "plate-version-aggregation",
  "canvas-module-alias",
  "auto-discovered",
  "extract_graph.py",
  "extract_graph.py v2.0",
  "extract_graph.py v2.0 (cache)",
  "team-placeholder",
  "team-unassigned",
] as const;

const RELATION_SOURCE_META: Record<string, RelationProvenanceMeta> = {
  "entity-wikilink": { group: "正文引用", label: "正文引用", description: "来自实体正文中的关联引用" },
  "category-path": { group: "结构关联", label: "结构关联", description: "来自文档元数据中的分类关联" },
  "document-frontmatter": { group: "结构关联", label: "结构关联", description: "来自文档元数据中的结构字段" },
  "document-body": { group: "正文推断", label: "正文推断", description: "来自正文扫描的关系推断" },
  "document-body-version": { group: "正文推断", label: "正文推断", description: "来自正文版本段的关系推断" },
  "concept-body": { group: "正文推断", label: "正文推断", description: "来自概念正文抽取" },
  "multi-source-inference": { group: "聚合推断", label: "聚合推断", description: "由多个来源聚合推断" },
  "plate-aggregation": { group: "板块派生", label: "板块派生", description: "来自板块聚合" },
  "plate-product-link": { group: "板块派生", label: "板块派生", description: "来自板块与产品关联" },
  "plate-system-aggregation": { group: "板块派生", label: "板块派生", description: "来自板块与系统聚合" },
  "plate-version-aggregation": { group: "板块派生", label: "板块派生", description: "来自板块与版本聚合" },
  "canvas-module-alias": { group: "板块派生", label: "板块派生", description: "来自画布模块别名" },
  "auto-discovered": { group: "系统来源", label: "系统来源", description: "由提取器自动发现" },
  "extract_graph.py": { group: "系统来源", label: "系统来源", description: "来自提取脚本主流程" },
  "extract_graph.py v2.0": { group: "系统来源", label: "系统来源", description: "来自提取脚本版本 2.0" },
  "extract_graph.py v2.0 (cache)": { group: "系统来源", label: "系统来源", description: "来自提取脚本缓存结果" },
  "team-placeholder": { group: "系统来源", label: "系统来源", description: "未分配占位实体" },
  "team-unassigned": { group: "系统来源", label: "系统来源", description: "未分配团队实体" },
};

const UNKNOWN_SOURCE: RelationProvenanceMeta = {
  group: "系统来源",
  label: "系统来源",
  description: "来源说明尚未收录",
};

export function relationSourceMeta(raw: unknown): RelationProvenanceMeta {
  return typeof raw === "string" && RELATION_SOURCE_META[raw]
    ? RELATION_SOURCE_META[raw]
    : UNKNOWN_SOURCE;
}


// ── 关系类型轴来源文案（WP-032/PR-147 收编自 review 页私有映射）──
// 此前 EdgeReviewPanel 私有 PROVENANCE_BY_RELATION/BY_SOURCE/DEFAULT 三映射与
// 本域同键两套中文已分叉（category-path 面板「分类关联」vs 域「结构关联」）——
// 文案唯一声明处归本域，呈现层（color/icon）留消费组件本地、键与本域对齐。
export type RelationTypeProvenanceMeta = { label: string; description: string };

export const RELATION_TYPE_PROVENANCE: Record<string, RelationTypeProvenanceMeta> = {
  BELONGS_TO: { label: "分类关联", description: "来自实体文档元数据中的分类关联" },
  DOCUMENTS: { label: "文档关联", description: "来自文档与实体的关系" },
  REFERENCES: { label: "正文引用", description: "来自正文里的引用或链接" },
  DEPENDS_ON: { label: "依赖引用", description: "来自实体正文里的依赖关系" },
  HAS_VERSION: { label: "版本推断", description: "来自版本号或版本段落推断" },
  APPLIES_TO: { label: "适用对象", description: "来自文档元数据或正文中的适用范围" },
  MENTIONS: { label: "关键词命中", description: "来自正文中的关键词匹配" },
  HAS_SYMPTOM: { label: "症状标签", description: "来自标签或症状词匹配" },
  ASSOCIATED_WITH: { label: "结构化关联", description: "来自结构化关联信息" },
};

export const RELATION_TYPE_PROVENANCE_DEFAULT: RelationTypeProvenanceMeta = {
  label: "结构生成",
  description: "未显式标记来源，按结构关系处理",
};

export function relationSourceDetail(sourceKey: string): Pick<RelationProvenanceMeta, "label" | "description"> {
  if (!sourceKey) return { label: "未标记", description: "未标记来源" };
  const meta = relationSourceMeta(sourceKey);
  return { label: meta.label, description: meta.description };
}
