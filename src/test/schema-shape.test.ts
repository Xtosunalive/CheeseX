// schema-shape 机制测试——复用域 schema-shape 守护测试（SCHEMA-IA-001 批1）
// 面覆盖：分区往返全等／六类边干净面／六类悬空精确面／ontology 缺席语义／纯函数 total／分区归属／coverage 信号／便利取数口
// R4（PR-277）扩面：编辑器变更构造层 schema-edit——changeOf 输出矩阵／正名键元数据表／装配键存在性钉／视图装配结构钉
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECT_DICTIONARY } from "@/lib/object-dictionary";
import {
  canonicalTabLabels,
  danglingForTab,
  partitionDanglingCounts,
  partitionOfKind,
  partitionOfTab,
  schemaPartitions,
  editabilityState,
  schemaTopology,
  TAB_FORMS,
  TAB_SECTIONS,
  tabSemantics,
  type ShapeEnumsInput,
  type ShapeOntologyInput,
  type SchemaTopology,
} from "@/lib/schema-shape";
import {
  canonicalTabName,
  changeOf,
  FAMILY_WIRING,
  LAZY_RESOURCES,
  TAB_EDIT_META,
  type SchemaEditPayload,
} from "@/lib/schema-edit";
import { TAB_LABELS, type NormalizedEnumsData, type OntologyData } from "@/features/schema-manager/schema-manager-types";
import { useSchemaManagerStore } from "@/features/schema-manager/schema-manager-store";

// 编译期直通钉子：特征侧类型（NormalizedEnumsData/OntologyData）必须结构性可赋值 Shape 输入面——
// 特征类型演化破坏直通时在此红（运行时为无害赋值；复用契约"零 feature 依赖"的类型面执法）
const _enumsAssignable: ShapeEnumsInput = {} as NormalizedEnumsData;
const _ontologyAssignable: ShapeOntologyInput = {} as OntologyData;
void _enumsAssignable;
void _ontologyAssignable;

const cleanEnums: ShapeEnumsInput = {
  domains: { d1: "参考资料", d2: "deploy" },
  subdomains: { d1: [{ id: "s1" }, { id: "s2" }], d2: [{ id: "s3" }] },
  subdomain_constraints: { s1: { domain_id: "d1" } },
  tags: { 分组一: ["t1", "t2"] },
  tag_aliases: { t1: ["别名甲"] },
  modules: { gateway: { subdomain: "s2" } },
};
const cleanOntology: ShapeOntologyInput = {
  node_types: { module: { allows_relations: ["DEPENDS_ON"] }, service: { allows_relations: [] } },
  relation_types: { DEPENDS_ON: { source_types: ["module"], target_types: ["service"] } },
};

describe("schemaPartitions（静态分区单源）", () => {
  it("五分区叶子并集 ≡ TAB_LABELS 键集（双向全等：无重无漏无漂移）", () => {
    const leaves = schemaPartitions().flatMap((p) => p.tabs);
    expect(new Set(leaves).size).toBe(leaves.length);
    expect([...leaves].sort()).toEqual(Object.keys(TAB_LABELS).sort());
  });

  it("分区 id/title/note 齐备且页签不跨分区", () => {
    const parts = schemaPartitions();
    expect(parts).toHaveLength(5);
    for (const p of parts) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.note.length).toBeGreaterThan(0);
    }
  });
});

describe("schemaTopology 干净面（六类边全在、零悬空）", () => {
  const t = schemaTopology(cleanEnums, cleanOntology);
  const kinds = new Set(t.edges.map((e) => e.kind));
  it("edges 覆盖全部六类 kind", () => {
    expect(kinds).toEqual(
      new Set(["policy-domain", "policy-key", "module-subdomain", "tag-alias", "allows-relation", "relation-endpoint"]),
    );
  });
  it("dangling 为空集", () => {
    expect(t.dangling).toEqual([]);
  });
});

describe("schemaTopology 悬空面（逐类恰报一条、from 定位精确）", () => {
  const dirtyEnums: ShapeEnumsInput = {
    domains: { d1: "参考资料" },
    subdomains: { d1: [{ id: "s1" }] },
    subdomain_constraints: {
      ghostRow: { domain_id: "ghost-domain" }, // policy-domain 悬空（domain_id 不在册）
      offRow: { domain_id: "d1" }, // policy-key 悬空（键不是 d1 的子域词条）
    },
    tags: { 分组一: ["t1"] },
    tag_aliases: { ghostAlias: [] }, // tag-alias 悬空（规范标签不在册）
    modules: { gateway: { subdomain: "ghost-s" } }, // module-subdomain 悬空
  };
  const dirtyOntology: ShapeOntologyInput = {
    node_types: { service: { allows_relations: ["CONSUMES", "DEPENDS_ON"] } },
    relation_types: { DEPENDS_ON: { source_types: ["ghost-node"], target_types: [] } }, // relation-endpoint 悬空
  };
  const t = schemaTopology(dirtyEnums, dirtyOntology);

  const oneOf = (kind: string) => {
    const rows = t.dangling.filter((d) => d.kind === kind);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  it("policy-domain：domain_id 幽灵键；同坏行不双报 policy-key（同源跳过）", () => {
    const d = oneOf("policy-domain");
    expect(d.from).toBe("subdomain_constraints.ghostRow.domain_id");
    expect(d.to).toBe("ghost-domain");
    expect(t.dangling.filter((x) => x.from === "subdomain_constraints.ghostRow")).toHaveLength(0);
  });
  it("policy-key：矩阵键不是所属域子域词条", () => {
    const d = oneOf("policy-key");
    expect(d.from).toBe("subdomain_constraints.offRow");
    expect(d.to).toBe("offRow");
  });
  it("module-subdomain：挂靠不存在的子域", () => {
    const d = oneOf("module-subdomain");
    expect(d.from).toBe("modules.gateway.subdomain");
    expect(d.to).toBe("ghost-s");
  });
  it("tag-alias：别名指向不在册的规范标签", () => {
    const d = oneOf("tag-alias");
    expect(d.from).toBe("tag_aliases.ghostAlias");
    expect(d.to).toBe("ghostAlias");
  });
  it("allows-relation：越界者恰报、在册者不报", () => {
    const d = oneOf("allows-relation");
    expect(d.from).toBe("node_types.service.allows_relations");
    expect(d.to).toBe("CONSUMES");
  });
  it("relation-endpoint：端点类型不在册", () => {
    const d = oneOf("relation-endpoint");
    expect(d.from).toBe("relation_types.DEPENDS_ON");
    expect(d.to).toBe("ghost-node");
  });
  it("悬空总量恰为六（无其他误报）", () => {
    expect(t.dangling).toHaveLength(6);
  });
});

describe("schemaTopology 语义边界", () => {
  it("ontology 缺席：类型系统两类边整体缺席、coverage.ontology=false、不抛错；其余面照常", () => {
    const t = schemaTopology(cleanEnums, null);
    expect(t.edges.some((e) => e.kind === "allows-relation" || e.kind === "relation-endpoint")).toBe(false);
    expect(t.edges.length).toBeGreaterThan(0);
    expect(t.dangling).toEqual([]);
    expect(t.coverage).toEqual({ ontology: false });
  });
  it("对端空集跳过（server validateNodeType 同款守卫）；空 ontology 已载入仍算覆盖面在", () => {
    const t = schemaTopology(cleanEnums, { node_types: { m: { allows_relations: ["X"] } }, relation_types: {} });
    expect(t.edges.filter((e) => e.kind === "allows-relation")).toHaveLength(0);
    expect(t.dangling.filter((d) => d.kind === "allows-relation")).toHaveLength(0);
    expect(t.coverage).toEqual({ ontology: true });
  });
  it("全空输入 total：edges 与 dangling 均空、coverage.ontology=false", () => {
    expect(schemaTopology()).toEqual({ edges: [], dangling: [], coverage: { ontology: false } });
    expect(schemaTopology(null, undefined)).toEqual({ edges: [], dangling: [], coverage: { ontology: false } });
  });
  it("子域词条 legacy 裸标量形态与对象形态同判", () => {
    const legacy: ShapeEnumsInput = { domains: { d1: "x" }, subdomains: { d1: ["s1"] }, modules: { m: { subdomain: "s1" } } };
    const modern: ShapeEnumsInput = { domains: { d1: "x" }, subdomains: { d1: [{ id: "s1" }] }, modules: { m: { subdomain: "s1" } } };
    expect(schemaTopology(legacy).dangling).toEqual([]);
    expect(schemaTopology(modern).dangling).toEqual([]);
  });
});

describe("纯函数纪律", () => {
  it("同输入两次调用 deepEqual", () => {
    expect(schemaTopology(cleanEnums, cleanOntology)).toEqual(schemaTopology(cleanEnums, cleanOntology));
  });
});

describe("分区归属取数口", () => {
  it("partitionOfKind 六类映射；partitionOfTab 13 页签全覆盖、未知页签 null", () => {
    expect(partitionOfKind("module-subdomain")).toBe("classification");
    expect(partitionOfKind("tag-alias")).toBe("vocabulary");
    expect(partitionOfKind("allows-relation")).toBe("type-system");
    for (const tab of Object.keys(TAB_LABELS)) {
      expect(partitionOfTab(tab)).not.toBeNull();
    }
    expect(partitionOfTab("nonexistent")).toBeNull();
    expect(partitionOfTab("versions")).toBe("ledger");
    expect(partitionOfTab("discovery")).toBe("intake");
  });
});

describe("消费便利口（danglingForTab／partitionDanglingCounts——消灭消费方过滤/聚合样板）", () => {
  const dirty: SchemaTopology = schemaTopology(
    {
      domains: { d1: "x" },
      subdomains: { d1: [{ id: "s1" }] },
      subdomain_constraints: { ghostRow: { domain_id: "ghost" }, offRow: { domain_id: "d1" } },
      tags: { g: ["t1"] },
      tag_aliases: { ghostAlias: [] },
      modules: { m: { subdomain: "ghost-s" } },
    },
    {
      node_types: { service: { allows_relations: ["CONSUMES", "DEPENDS_ON"] } },
      relation_types: { DEPENDS_ON: { source_types: ["ghost-node"], target_types: [] } },
    },
  );

  it("danglingForTab 按页签归属分区过滤：classification 3／vocabulary 1／type-system 2／ledger·intake·未登记 0", () => {
    expect(danglingForTab("domains", dirty)).toHaveLength(3);
    expect(danglingForTab("taxonomy", dirty)).toHaveLength(3);
    expect(danglingForTab("tags", dirty)).toHaveLength(1);
    expect(danglingForTab("ontology", dirty)).toHaveLength(2);
    expect(danglingForTab("versions", dirty)).toHaveLength(0);
    expect(danglingForTab("discovery", dirty)).toHaveLength(0);
    expect(danglingForTab("not-a-tab", dirty)).toHaveLength(0);
  });
  it("partitionDanglingCounts 五分区聚合与 dirty fixture 一致", () => {
    expect(partitionDanglingCounts(dirty)).toEqual({
      classification: 3,
      vocabulary: 1,
      "type-system": 2,
      ledger: 0,
      intake: 0,
    });
  });
  it("干净拓扑计数全 0；便利口亦全空", () => {
    const clean = schemaTopology(cleanEnums, cleanOntology);
    expect(partitionDanglingCounts(clean)).toEqual({
      classification: 0,
      vocabulary: 0,
      "type-system": 0,
      ledger: 0,
      intake: 0,
    });
    expect(danglingForTab("domains", clean)).toEqual([]);
  });
});

// ── 语义投影（批4 扩域）──
describe("语义投影 tabSemantics/canonicalTabLabels", () => {
  const fixture = [
    { canonical_name: "知识域/子域", definition: "运营域划分轴", edited_by_tab: "domains", editable: true, object_kind: "business_object" },
    { canonical_name: "实体类别", definition: "主定义", edited_by_tab: "categories", editable: true, object_kind: "business_object" },
    { canonical_name: "子域约束", definition: "矩阵约束", edited_by_tab: "categories", editable: true, object_kind: "config_object" },
    { canonical_name: "停用标签", definition: "停用清单", edited_by_tab: "tags", editable: false, object_kind: "business_object" },
  ];

  it("tabSemantics：多对象页签主名取首对象、语义面全量带回", () => {
    const s = tabSemantics(fixture, "categories")!;
    expect(s.primaryName).toBe("实体类别");
    expect(s.objects).toHaveLength(2);
    expect(s.editable).toBe(true);
  });

  it("tabSemantics：无对象页签返回 null（不假装有语义）；空输入 total", () => {
    expect(tabSemantics(fixture, "history")).toBeNull();
    expect(tabSemantics([], "domains")).toBeNull();
  });

  it("tabSemantics：全只读对象 → editable=false（派生只读页签信号）", () => {
    expect(tabSemantics(fixture, "tags")!.editable).toBe(false);
  });

  it("canonicalTabLabels：字典正名优先，无对象页签走声明回退，仍缺以 id 兜底", () => {
    const labels = canonicalTabLabels(fixture, ["domains", "categories", "history", "unknown-tab"]);
    expect(labels.domains).toBe("知识域/子域");
    expect(labels.categories).toBe("实体类别");
    expect(labels.history).toBe("版本快照");
    expect(labels["unknown-tab"]).toBe("unknown-tab");
  });

  it("真字典投影：14 页签正名齐备且与 Master 裁决名一致（批10 +产品模块）", () => {
    const TABS = ["domains","layers","categories","taxonomy","modules","discovery","tags","concepts","ontology","dependencies","versions","history","relations","fields"];
    const labels = canonicalTabLabels(OBJECT_DICTIONARY, TABS);
    expect(Object.keys(labels)).toHaveLength(14);
    expect(labels.modules).toBe("产品模块"); // 批10 拆页签（Master 2026-10-26「1 拆」）
    expect(Object.values(labels).every((v) => v && v.length > 0)).toBe(true);
    expect(labels.discovery).toBe("未收录值");
    expect(labels.tags).toBe("标签词表");
    expect(labels.taxonomy).toBe("文章字段值域");
    expect(labels.ontology).toBe("知识本体");
  });
});

// ── 编辑性谓词（批5：角色面入语义层）──
describe("editabilityState（对象编辑性 × 页签写侧角色 × 当前角色）", () => {
  it("静态只读对象恒 derived-readonly（角色无关）", () => {
    expect(editabilityState("tags", false, ["admin"])).toBe("derived-readonly");
    expect(editabilityState("tags", false, null)).toBe("derived-readonly");
  });
  it("admin 页签：有角色面时按角色裁决；身份未知（null）只出静态面不假设", () => {
    expect(editabilityState("domains", true, ["admin"])).toBe("editable");
    expect(editabilityState("domains", true, ["review"])).toBe("role-denied");
    expect(editabilityState("domains", true, null)).toBe("editable");
  });
  it("无钉扎页签（relations/discovery）：任一认证角色可写", () => {
    expect(editabilityState("relations", true, ["review"])).toBe("editable");
    expect(editabilityState("discovery", true, [])).toBe("editable");
  });
});

// ── 形态声明表（批8：结构性收敛——形态从编辑器私产升为投影声明）──
describe("TAB_FORMS 形态声明", () => {
  it("13 页签全覆盖且形态值域合法", () => {
    const TABS = ["domains","layers","categories","taxonomy","modules","discovery","tags","concepts","ontology","dependencies","versions","history","relations","fields"];
    expect(Object.keys(TAB_FORMS).sort()).toEqual([...TABS].sort());
    const legal = new Set(["table", "master-detail", "chips", "cards"]);
    expect(Object.values(TAB_FORMS).every((f) => legal.has(f))).toBe(true);
  });
  it("存量判定在册：清单型=table、交互保留型=master-detail/chips、候选流=cards", () => {
    expect(TAB_FORMS.ontology).toBe("table");
    expect(TAB_FORMS.layers).toBe("table");
    expect(TAB_FORMS.fields).toBe("table");
    expect(TAB_FORMS.domains).toBe("master-detail");
    expect(TAB_FORMS.concepts).toBe("master-detail");
    expect(TAB_FORMS.tags).toBe("chips");
    expect(TAB_FORMS.discovery).toBe("cards");
  });
  it("tabSemantics.form 透传声明（缺省 table）", () => {
    const fixture = [{ canonical_name: "X", definition: "d", edited_by_tab: "layers", editable: true, object_kind: "business_object" }];
    expect(tabSemantics(fixture, "layers")!.form).toBe("table");
  });
});

// ── 内容区 sections 声明（批14：组装层入投影——未声明=无挂载点）──
describe("TAB_SECTIONS 内容区声明", () => {
  it("键集 ≡ TAB_FORMS 键集（14 页签全覆盖）且每页签至少一节", () => {
    expect(Object.keys(TAB_SECTIONS).sort()).toEqual(Object.keys(TAB_FORMS).sort());
    expect(Object.values(TAB_SECTIONS).every((secs) => secs.length > 0)).toBe(true);
  });
  it("区块 id 全局唯一（视图注册表键无歧义）", () => {
    const all = Object.values(TAB_SECTIONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it("批13 宪法断言：关系页签唯一节=账编辑（查询/图谱无挂载点）", () => {
    expect(TAB_SECTIONS.relations).toEqual(["relation-ledger"]);
  });
  it("fields 两节分立（值域引用图谱 + 字典编辑）", () => {
    expect(TAB_SECTIONS.fields).toEqual(["field-graph", "fields-editor"]);
  });
});

// ── 内容区 sections 声明（批14：组装层入投影——未声明=无挂载点）──
describe("TAB_SECTIONS 内容区声明", () => {
  it("键集 ≡ TAB_FORMS 键集（14 页签全覆盖）且每页签至少一节", () => {
    expect(Object.keys(TAB_SECTIONS).sort()).toEqual(Object.keys(TAB_FORMS).sort());
    expect(Object.values(TAB_SECTIONS).every((secs) => secs.length > 0)).toBe(true);
  });
  it("区块 id 全局唯一（视图注册表键无歧义）", () => {
    const all = Object.values(TAB_SECTIONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it("批13 宪法断言：关系页签唯一节=账编辑（查询/图谱无挂载点）", () => {
    expect(TAB_SECTIONS.relations).toEqual(["relation-ledger"]);
  });
  it("fields 两节分立（值域引用图谱 + 字典编辑）", () => {
    expect(TAB_SECTIONS.fields).toEqual(["field-graph", "fields-editor"]);
  });
});

// ── R4（PR-277）：编辑器变更构造层 schema-edit——装配声明驱动 ──
describe("schema-edit changeOf（变更构造单点——load/save/error 装配输出矩阵）", () => {
  const TABS = Object.keys(TAB_LABELS);

  // 期望矩阵显式声明（不从被测表派生——防循环自证）
  const LAZY_EXPECTED: Record<string, string | null> = {
    domains: null, layers: null, categories: null, taxonomy: null, modules: "loadVersions",
    tags: null, concepts: null, ontology: "loadOntology", dependencies: "loadDependencies",
    versions: "loadVersions", history: null, relations: null, fields: null, discovery: "loadDiscovery",
  };
  const SAVE_READY_EXPECTED: Record<string, string> = {
    domains: "saveEnums", layers: "saveEnums", categories: "saveEnums", taxonomy: "saveEnums",
    modules: "saveEnums", tags: "saveEnums", concepts: "saveEnums", ontology: "saveOntology",
    dependencies: "saveDependencies", versions: "saveVersions", history: "saveEnums",
    relations: "saveEnums", fields: "saveEnums", discovery: "saveEnums",
  };

  const emptyPayload: SchemaEditPayload = {
    ontology: null, discovery: null, dependencies: null, versions: null,
    ontologyRequest: { status: "idle" }, discoveryRequest: { status: "idle" },
    dependenciesRequest: { status: "idle" }, versionsRequest: { status: "idle" },
    ontologyRevision: null,
  };

  it("空数据态矩阵：懒加载按声明补拉、专用族保存回落 enums 主面（R4 前 fall-through 语义逐字保留）", () => {
    for (const tab of TABS) {
      const w = changeOf(tab, emptyPayload);
      expect(w.lazyLoadAction).toBe(LAZY_EXPECTED[tab]);
      expect(w.saveAction).toBe("saveEnums");
      expect(w.editingLocked).toBe(tab === "ontology");
      expect(w.saveStatus).toBeNull();
      expect(w.saveError).toBeNull();
    }
  });

  it("就绪态矩阵：保存动作按族接线、数据已在即不重复补拉、revision 已在不冻结", () => {
    for (const tab of TABS) {
      const payload: SchemaEditPayload = {
        ...emptyPayload,
        ontology: tab === "ontology" ? { node_types: {} } : null,
        dependencies: tab === "dependencies" ? { items: [] } : null,
        versions: tab === "versions" || tab === "modules" ? { products: {} } : null,
        discovery: tab === "discovery" ? { discovery: {} } : null,
        ontologyRevision: tab === "ontology" ? "sha256:rev" : null,
      };
      const w = changeOf(tab, payload);
      expect(w.saveAction).toBe(SAVE_READY_EXPECTED[tab]);
      expect(w.lazyLoadAction).toBeNull();
      expect(w.editingLocked).toBe(false);
    }
  });

  it("ontology 乐观锁门槛：数据已在而 revision 缺席 → 不保存（null，非回落）且编辑冻结", () => {
    const w = changeOf("ontology", { ...emptyPayload, ontology: { node_types: {} } });
    expect(w.saveAction).toBeNull();
    expect(w.editingLocked).toBe(true);
    expect(w.lazyLoadAction).toBeNull();
  });

  it("读请求 loading 守卫：进行中不重复补拉（modules 与 versions 共用产品注册表读面）", () => {
    for (const tab of ["modules", "versions"]) {
      expect(changeOf(tab, { ...emptyPayload, versionsRequest: { status: "loading" } }).lazyLoadAction).toBeNull();
    }
    expect(changeOf("ontology", { ...emptyPayload, ontologyRequest: { status: "loading" } }).lazyLoadAction).toBeNull();
    expect(changeOf("discovery", { ...emptyPayload, discoveryRequest: { status: "loading" } }).lazyLoadAction).toBeNull();
    expect(changeOf("dependencies", { ...emptyPayload, dependenciesRequest: { status: "loading" } }).lazyLoadAction).toBeNull();
  });

  it("error 读取矩阵：enums 族=预览失败优先于保存错误；专用族读各自的保存错误（不读预览）", () => {
    const withErrors: SchemaEditPayload = {
      ...emptyPayload,
      saveError: "enums 保存失败",
      ontologySaveError: "本体保存失败",
      dependenciesSaveError: "依赖保存失败",
      versionsSaveError: "版本保存失败",
      previewError: "影响预览失败",
    };
    for (const tab of TABS) {
      const w = changeOf(tab, withErrors);
      if (tab === "ontology") expect(w.saveError).toBe("本体保存失败");
      else if (tab === "dependencies") expect(w.saveError).toBe("依赖保存失败");
      else if (tab === "versions") expect(w.saveError).toBe("版本保存失败");
      else expect(w.saveError).toBe("影响预览失败");
    }
    // 预览失败缺席时 enums 族读保存错误（R4 前 previewError || saveError 的 || 语义）
    expect(changeOf("domains", { ...withErrors, previewError: null }).saveError).toBe("enums 保存失败");
  });

  it("状态读取矩阵：各族读各自的保存状态键（modules 沿袭 enums 主面）", () => {
    const withStatus: SchemaEditPayload = {
      ...emptyPayload,
      saveStatus: "dirty",
      ontologySaveStatus: "saving",
      dependenciesSaveStatus: "saved",
      versionsSaveStatus: "error",
    };
    expect(changeOf("domains", withStatus).saveStatus).toBe("dirty");
    expect(changeOf("modules", withStatus).saveStatus).toBe("dirty");
    expect(changeOf("ontology", withStatus).saveStatus).toBe("saving");
    expect(changeOf("dependencies", withStatus).saveStatus).toBe("saved");
    expect(changeOf("versions", withStatus).saveStatus).toBe("error");
  });

  it("纯函数纪律：同输入两次调用 deepEqual", () => {
    expect(changeOf("ontology", emptyPayload)).toEqual(changeOf("ontology", emptyPayload));
    expect(changeOf("modules", emptyPayload)).toEqual(changeOf("modules", emptyPayload));
  });

  it("未登记页签 fail-visible：throw（不静默回落）", () => {
    expect(() => changeOf("not-a-tab", emptyPayload)).toThrow(/unregistered tab/);
  });
});

describe("TAB_EDIT_META 正名键元数据表（R4 装配声明单源）", () => {
  const TABS = Object.keys(TAB_LABELS);

  it("键集 ≡ 14 页签字典正名集（无重无漏）；meta.tab ↔ 键往返全等", () => {
    const names = TABS.map((tab) => canonicalTabName(tab));
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(TAB_EDIT_META).sort()).toEqual([...names].sort());
    for (const [name, meta] of Object.entries(TAB_EDIT_META)) {
      expect(TABS).toContain(meta.tab);
      expect(canonicalTabName(meta.tab)).toBe(name);
    }
  });

  it("编辑族与懒加载资源值域合法且 14 页签全覆盖", () => {
    const families = new Set(["enums", "ontology", "dependencies", "versions"]);
    const resources = new Set([null, ...Object.keys(LAZY_RESOURCES)]);
    for (const meta of Object.values(TAB_EDIT_META)) {
      expect(families.has(meta.family)).toBe(true);
      expect(resources.has(meta.lazyResource)).toBe(true);
    }
    for (const tab of TABS) expect(canonicalTabName(tab) in TAB_EDIT_META).toBe(true);
  });
});

describe("schema-edit 装配键存在性钉（真实 store 实例）", () => {
  const state = useSchemaManagerStore.getState();

  it("FAMILY_WIRING/LAZY_RESOURCES 声明的数据键、请求键、动作名、状态/错误键在 store 上全部实存", () => {
    for (const family of Object.values(FAMILY_WIRING)) {
      expect(family.dataKey in state).toBe(true);
      expect(family.saveAction in state).toBe(true);
      expect(family.saveStatusKey in state).toBe(true);
      expect(family.saveErrorKey in state).toBe(true);
    }
    for (const resource of Object.values(LAZY_RESOURCES)) {
      expect(resource.dataKey in state).toBe(true);
      expect(resource.requestKey in state).toBe(true);
      expect(resource.action in state).toBe(true);
    }
  });

  it("编译期直通钉：真实 store 结构性可赋值 SchemaEditPayload（特征演化破坏输入面时此钉红）", () => {
    const _pin: SchemaEditPayload = useSchemaManagerStore.getState();
    void _pin;
  });
});

describe("SchemaManagerView 装配声明驱动结构钉（形状执法正主=check:schema-shape 检查面③）", () => {
  // vitest jsdom 环境下 import.meta.url 非 file scheme——以项目根（vitest root）解析
  const source = readFileSync(resolve(process.cwd(), "src/features/schema-manager/SchemaManagerView.tsx"), "utf-8");

  it("零逐页签装配分支（字面量比较/switch 装配绝迹）且接线走 changeOf", () => {
    expect(source).not.toMatch(/activeTab\s*===\s*["'`]/);
    expect(source).not.toMatch(/switch\s*\(\s*[\w.]*\.?activeTab\s*\)/);
    expect(source).toContain("changeOf(");
  });
});
