// 实体类别正名的具名出口（WP-152 散写销账收官批）——类别名是数据值（拓扑节点 category 字段的取值），
// 不是文案：值域单源＝TheSchema enums.yaml → 生成物 ENTITY_TYPES／CATEGORY_ALIASES
// （src/lib/generated/ontology-registry.ts）。本表只给「以类别名为键/值的数据表」一个按名引用的出口——
// 键值经 satisfies 钉在生成物值域内：TheSchema 改名并再生成后，此处编译期即红（不静默漂移）。
// 消费面：分类色表（topology-types）、类别→防区回落（dashboard-containers）、类别别名归一（ontology）、
// 准入表类别色（admission）、运行概览类别分布排除集（dashboard）。
// 闭集登记：eslint.config.js 尾部闭集豁免块＋copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES 投影＋
// SPEC-091 §2.1（ADR-019 §三.4 闭集仪式；与 RelationProvenance 关系来源分组同形态）。
import type { CATEGORY_ALIASES, ENTITY_TYPES } from "@/lib/generated/ontology-registry";

type EntityTypeName = (typeof ENTITY_TYPES)[number];
type CategoryAliasName = keyof typeof CATEGORY_ALIASES;

export const ENTITY_CATEGORY = {
  TERMINAL: "终端",
  SERVICE: "服务",
  STORAGE: "存储",
  INFRASTRUCTURE: "基础设施",
  SECURITY: "安全",
  PLATE: "板块",
  CONCEPT: "概念",
  OTHER: "其他",
  PRODUCT: "产品",
  VERSION: "版本",
  DOMAIN: "域",
  DOCUMENT: "文档",
} as const satisfies Record<string, EntityTypeName>;

/** 存量数据里仍可能出现的类别别名（生成物 CATEGORY_ALIASES 键；准入表按原值着色时用） */
export const ENTITY_CATEGORY_ALIAS = {
  SMART_SERVICE: "智能服务",
} as const satisfies Record<string, CategoryAliasName>;
