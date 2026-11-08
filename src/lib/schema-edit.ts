// schema-edit — 编辑器变更构造层（SCHEMA-IA 的 edit 半场；PR-277 R4 收口）
//
// 借镜 OpenMAIC lib/model-settings/edit.ts 的机制：把「编辑器→变更」的构造从组件里拆成
// 纯函数＋声明表，组件只接线不写分支。本模块单点回答 SchemaManagerView 的三个装配问题——
// 当前页签怎么存（saveAction）、保存状态/错误读哪里（saveStatus/saveError）、首挂载要补拉
// 什么（lazyLoadAction）——R4 前这些答案以 15 处逐页签 if-else 手工写在视图里。
//
// 元数据键=字典正名（单源=contracts/object-dictionary.json，经 schema-shape canonicalTabLabels
// 投影；无对象页签走 TAB_LABEL_FALLBACKS 声明回退）——页签必须先有字典身份才接得上编辑线，
// 字典正名演化与装配声明同源演进（漂移即测试红＋运行时 fail-visible）。
//
// 纪律：纯函数（同输入两次调用 deepEqual）、全 total（对已登记页签零抛错）、零 feature 依赖
// （输入为 store 结构化最小面，编译期直通钉与键存在性钉住测试面）；未登记页签 fail-visible
// （throw，不静默回落——「专用族数据缺席回落 enums 主面」是显式声明语义，不是缺登记的兜底）。

import { canonicalTabLabels } from "./schema-shape";
import { OBJECT_DICTIONARY } from "./object-dictionary";
import { SCHEMA_TAB_NAMES } from "./lib-copy";

/** 页签编辑族——保存动作与保存状态/错误读取键的接线归属（store 四族写面） */
export type EditFamily = "enums" | "ontology" | "dependencies" | "versions";

/** 独立读资源——懒加载守卫与补拉动作的声明键（enums 主面随主 load 一次到位，不在其列） */
export type LazyResource = "ontology" | "discovery" | "dependencies" | "versions";

/** 页签编辑元数据（字段面：编辑族＋独立读资源） */
export interface TabEditMeta {
  /** 归属页签 id（与键——字典正名——往返全等，测试面钉住） */
  tab: string;
  /** 编辑族 */
  family: EditFamily;
  /** 独立读资源（null=数据随主 load 一次到位） */
  lazyResource: LazyResource | null;
}

/** 族接线声明（store 契约面——动作名与状态/错误键；键存在性由测试面用真实 store 实例钉住） */
export const FAMILY_WIRING = {
  enums: { dataKey: "enums", saveAction: "saveEnums", saveStatusKey: "saveStatus", saveErrorKey: "saveError" },
  ontology: { dataKey: "ontology", saveAction: "saveOntology", saveStatusKey: "ontologySaveStatus", saveErrorKey: "ontologySaveError" },
  dependencies: { dataKey: "dependencies", saveAction: "saveDependencies", saveStatusKey: "dependenciesSaveStatus", saveErrorKey: "dependenciesSaveError" },
  versions: { dataKey: "versions", saveAction: "saveVersions", saveStatusKey: "versionsSaveStatus", saveErrorKey: "versionsSaveError" },
} as const;

/** 独立读资源声明（数据缺席且读请求非 loading 才补拉——R4 前视图四个 effect 的守卫逐字保留） */
export const LAZY_RESOURCES = {
  ontology: { dataKey: "ontology", requestKey: "ontologyRequest", action: "loadOntology" },
  discovery: { dataKey: "discovery", requestKey: "discoveryRequest", action: "loadDiscovery" },
  dependencies: { dataKey: "dependencies", requestKey: "dependenciesRequest", action: "loadDependencies" },
  versions: { dataKey: "versions", requestKey: "versionsRequest", action: "loadVersions" },
} as const;

/**
 * 页签编辑元数据表（键=字典正名——R4 装配声明单源）。
 *
 * 两条不落表但由 changeOf 统一兑现的语义（与 R4 前视图分支链逐字等价）：
 * - 专用族（ontology/dependencies/versions）页签在其数据缺席时保存回落 enums 主面
 *   （fall-through 语义，非兜底——显式声明于 changeOf）；
 * - ontology 数据已在而乐观锁 revision 缺席 → 不保存（门槛）且编辑冻结。
 *
 * 各页签的独立读资源：modules 与 versions 共用产品注册表读面（适用产品选择器真源）；
 * discovery 的写操作（absorb/grow）在面板内部走各自通道，不经头部保存钮。
 */
export const TAB_EDIT_META: Readonly<Record<string, TabEditMeta>> = {
  [SCHEMA_TAB_NAMES.DOMAINS]: { tab: "domains", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.LAYERS]: { tab: "layers", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.CATEGORIES]: { tab: "categories", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.TAXONOMY]: { tab: "taxonomy", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.MODULES]: { tab: "modules", family: "enums", lazyResource: "versions" },
  [SCHEMA_TAB_NAMES.TAGS]: { tab: "tags", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.CONCEPTS]: { tab: "concepts", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.ONTOLOGY]: { tab: "ontology", family: "ontology", lazyResource: "ontology" },
  [SCHEMA_TAB_NAMES.DEPENDENCIES]: { tab: "dependencies", family: "dependencies", lazyResource: "dependencies" },
  [SCHEMA_TAB_NAMES.VERSIONS]: { tab: "versions", family: "versions", lazyResource: "versions" },
  // 版本快照=git 账页（TAB_LABEL_FALLBACKS 正名，无字典对象），头部保存沿袭 enums 主面
  [SCHEMA_TAB_NAMES.HISTORY]: { tab: "history", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.RELATIONS]: { tab: "relations", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.FIELDS]: { tab: "fields", family: "enums", lazyResource: null },
  [SCHEMA_TAB_NAMES.DISCOVERY]: { tab: "discovery", family: "enums", lazyResource: "discovery" },
};

/** 页签→字典正名（canonicalTabLabels 投影——正名单源=字典；无对象页签走声明回退） */
export function canonicalTabName(tab: string): string {
  return canonicalTabLabels(OBJECT_DICTIONARY, [tab])[tab];
}

/** changeOf 输入面——特征侧 store 的结构化最小面（schema-shape 同款纪律：结构性可赋值直通） */
export interface SchemaEditPayload {
  /** 页签数据就绪面（键=族/资源 dataKey；truthy=数据已在） */
  enums?: unknown;
  ontology?: unknown;
  discovery?: unknown;
  dependencies?: unknown;
  versions?: unknown;
  /** 独立读请求切片最小面（懒加载守卫——status "loading"=进行中） */
  ontologyRequest?: { status?: string };
  discoveryRequest?: { status?: string };
  dependenciesRequest?: { status?: string };
  versionsRequest?: { status?: string };
  /** 乐观锁 revision 位（ontology 保存门槛＋编辑冻结） */
  ontologyRevision?: string | null;
  /** 各族保存状态（键=FAMILY_WIRING[*].saveStatusKey） */
  saveStatus?: string | null;
  ontologySaveStatus?: string | null;
  dependenciesSaveStatus?: string | null;
  versionsSaveStatus?: string | null;
  /** 各族保存错误（键=FAMILY_WIRING[*].saveErrorKey） */
  saveError?: string | null;
  ontologySaveError?: string | null;
  dependenciesSaveError?: string | null;
  versionsSaveError?: string | null;
  /** enums 族影响预览失败回显（视图侧状态——enums 族错误优先级高于 saveError） */
  previewError?: string | null;
}

/** changeOf 输出——当前页签的装配接线（视图按此接线，不再逐页签分支） */
export interface TabEditWiring {
  /** 保存动作名（视图动作注册表据此调 store 动作；null=保存门槛未过，不调） */
  saveAction: string | null;
  /** 懒加载动作名（当前页签需补拉的子资源；null=无需/已在拉/已就绪） */
  lazyLoadAction: string | null;
  /** 保存状态值（当前页签族的读取结果；输入缺省=null——真实 store 恒有值） */
  saveStatus: string | null;
  /** 保存错误文本（enums 族=预览失败优先于 saveError；无错=null） */
  saveError: string | null;
  /** 编辑冻结位（当前仅 ontology 乐观锁 revision 缺席；数据缺席期走懒加载加载态，不冻结） */
  editingLocked: boolean;
}

/**
 * 编辑器变更构造单点：页签＋store 快照 → 当前页签的装配接线。
 *
 * 消费方（SchemaManagerView）以动作注册表按返回的动作名调 store 动作——动作名到动作的
 * 扁平注册是视图侧唯一接线位；除此之外视图不写任何页签分支。
 */
export function changeOf(tab: string, payload: SchemaEditPayload): TabEditWiring {
  const name = canonicalTabName(tab);
  const meta = TAB_EDIT_META[name];
  if (!meta) {
    // fail-visible：开发者不变量（未登记页签＝装配声明缺行），技术消息非业务文案（seq201）
    throw new Error(`[schema-edit] unregistered tab: ${tab} (canonical: ${name}) — assembly source of truth = TAB_EDIT_META`);
  }
  const family = FAMILY_WIRING[meta.family];

  // 懒加载守卫（R4 前视图四个 effect 的守卫逐字保留）：数据缺席且读请求非 loading 才补拉
  const lazy = meta.lazyResource ? LAZY_RESOURCES[meta.lazyResource] : null;
  const lazyLoadAction =
    lazy && !payload[lazy.dataKey] && payload[lazy.requestKey]?.status !== "loading"
      ? lazy.action
      : null;

  // 保存动作：专用族数据缺席回落 enums 主面（R4 前分支链 fall-through 语义逐字保留）；
  // ontology 数据已在而乐观锁 revision 缺席 → 不保存（门槛，非回落）
  let saveAction: string | null = family.saveAction;
  if (meta.family !== "enums" && !payload[family.dataKey]) saveAction = FAMILY_WIRING.enums.saveAction;
  if (meta.family === "ontology" && payload[family.dataKey] && !payload.ontologyRevision) saveAction = null;

  // 状态/错误读取：enums 族错误=预览失败优先（R4 前 previewError || saveError 逐字保留）
  const saveStatus = payload[family.saveStatusKey] ?? null;
  const saveError =
    meta.family === "enums"
      ? payload.previewError || payload[FAMILY_WIRING.enums.saveErrorKey] || null
      : payload[family.saveErrorKey] ?? null;

  // 编辑冻结：当前仅 ontology 乐观锁 revision 缺席
  const editingLocked = meta.family === "ontology" && !payload.ontologyRevision;

  return { saveAction, lazyLoadAction, saveStatus, saveError, editingLocked };
}
