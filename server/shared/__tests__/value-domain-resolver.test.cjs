// value-domain-resolver 红绿夹具（SPEC-020 波 1 追踪矩阵）：
// ① 封闭操作集（未知 op 红）②引用悬空（段/别名表红）③空态忠实（tags 空集／ADR-006 矩阵两态回落）
// ④entity_usable 过滤 ⑤缺省回落 first ⑥product_closure ⑦version_registry ⑧composite 随域收窄
// ⑨等价性：与 enums-loader buildRuleSet（现行实现）六概念相等——夹具＋真实 vault 双面（vault 缺省 skip）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { createRequire } = require("node:module");
const ROOT = path.resolve(__dirname, "..", "..");
const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
const YAML = requireFromRoot("yaml");
const { resolveValueDomains, collectValueDomainReferences } = require("../value-domain-resolver.cjs");
const { buildRuleSet } = require("../enums-loader.cjs");
const { resolveTheSchemaDir } = require("../theschema-root.cjs");

// WP-195 v2 类属主形态：fields＝{schema_version:2, keys, classes:{entity,article}}——无顶层 fields 数组，
// 无 scope 字段（行 scope 由属主类锚回填＝[cls]）。
function resolverOf(vd) {
  return resolveValueDomains({
    fields: { schema_version: 2, keys: {}, classes: { entity: { properties: [{ name: "x", value_domain: vd }] }, article: { properties: [] } } },
    enums: {},
    versions: {},
  });
}

const RICH_ENUMS = {
  domains: { ref: "参考资料", tech: "技术域" },
  subdomains: { ref: [{ id: "overview", label: "总览" }], tech: [{ id: "api", label: "接口" }] },
  article_types: ["排错指南"],
  doc_types: ["用户手册"],
  tags: { g1: ["a", "b"], g2: ["b", "c"] },
  disabled_tags: ["c"],
  tag_aliases: { 别名甲: "a" },
  lifecycle: { review_cycle: ["30d", "never"], status: ["灰度", "在线"], default_status: "" },
  arch_categories: ["兜底类"],
  layers: [
    { id: "gateway", label: "网关" },
    { id: "plate", label: "聚合容器", entity_layer: false },
  ],
  architecture_projection: { product: "As", product_aliases: { anyshare: "As" }, layer_aliases: { gw: "gateway" } },
  modules: { 主模块: { label: "主" } },
  subdomain_constraints: { api: { allowed_categories: ["服务", "存储"] } },
};
const RICH_VERSIONS = {
  reserved_products: ["通用"],
  products: { As: { versions: [{ id: "7.0.0", label: "v7", aliases: ["v7"] }] } },
};

function resolveRich() {
  return resolveValueDomains({
    fields: {
      schema_version: 2,
      keys: {},
      classes: {
        entity: {
          properties: [
            { name: "arch_layer", value_domain: { source: "layers", resolve: { op: "ids", filter: "entity_usable" } } },
            { name: "arch_category", value_domain: { source: "arch_categories", resolve: { op: "matrix_union_fallback" } } },
            { name: "tags", value_domain: { source: "tags", resolve: { op: "tags_union" } } },
            { name: "arch_subdomain", value_domain: { source: "subdomains", resolve: { op: "ids" } } },
            { name: "module", value_domain: { source: "modules", resolve: { op: "keys" } } },
            { name: "cp", value_domain: { source: "free", composite: [{ source: "domains", resolve: { op: "keys" } }, { source: "subdomains", resolve: { op: "ids" }, scoped_by: "previous" }, { resolve: { op: "free_slug" } }] } },
          ],
        },
        article: {
          properties: [
            { name: "status", value_domain: { source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" }, default: { from: "lifecycle.default_status", fallback: "first" } } },
            { name: "product", value_domain: { source: "architecture_projection", resolve: { op: "product_closure" } } },
            { name: "version", value_domain: { source: "versions", resolve: { op: "version_registry" } } },
          ],
        },
      },
    },
    enums: RICH_ENUMS,
    versions: RICH_VERSIONS,
  });
}

test("未知 op 记 errors（封闭操作集执法）", () => {
  const r = resolverOf({ source: "layers", resolve: { op: "sql_injection" } });
  assert.ok(r.errors.some((e) => e.includes("未知操作") && e.includes("sql_injection")));
});

test("引用悬空：段与别名表缺失即红", () => {
  const r1 = resolverOf({ source: "not_exist_seg", resolve: { op: "values" } });
  assert.ok(r1.errors.some((e) => e.includes("值域引用悬空") && e.includes("not_exist_seg")));
  const r2 = resolverOf({ source: "tags", resolve: { op: "tags_union" }, normalize: { aliases: "no_such_table" } });
  assert.ok(r2.errors.some((e) => e.includes("归一表悬空") && e.includes("no_such_table")));
});

test("ADR-006 两态：矩阵配置→并集；矩阵空→回落 arch_categories", () => {
  const r = resolveRich();
  const cat = r.byField.find((f) => f.name === "arch_category");
  assert.deepEqual([...cat.values].sort(), ["存储", "服务"]); // 矩阵配置态（优先）
  const noMatrix = structuredClone(RICH_ENUMS);
  delete noMatrix.subdomain_constraints;
  const r2 = resolveValueDomains({ fields: { schema_version: 2, keys: {}, classes: { entity: { properties: [{ name: "arch_category", value_domain: { source: "arch_categories", resolve: { op: "matrix_union_fallback" } } }] }, article: { properties: [] } } }, enums: noMatrix, versions: {} });
  assert.deepEqual(r2.byField[0].values, ["兜底类"]); // 回落态
});

test("entity_usable 过滤：plate（entity_layer=false）被排除", () => {
  const r = resolveRich();
  assert.deepEqual(r.byField.find((f) => f.name === "arch_layer").values, ["gateway"]);
});

test("tags_union：分组并集减 disabled；缺省回落 first（default_status 空）", () => {
  const r = resolveRich();
  assert.deepEqual([...r.byField.find((f) => f.name === "tags").values].sort(), ["a", "b"]); // c 被减
  assert.equal(r.byField.find((f) => f.name === "status").default, "灰度"); // default_status 空→首项
  // WP-195 v2：行 scope 由属主类锚生成＝[cls]（无 scope 声明字段）
  assert.deepEqual(r.byField.find((f) => f.name === "tags").scope, ["entity"]);
  assert.deepEqual(r.byField.find((f) => f.name === "status").scope, ["article"]);
});

test("product_closure＝非空 product ∪ product_aliases 键 ∪ reserved；version_registry＝id ∪ aliases", () => {
  const r = resolveRich();
  assert.deepEqual([...r.byField.find((f) => f.name === "product").values].sort(), ["As", "anyshare", "通用"]);
  assert.deepEqual([...r.byField.find((f) => f.name === "version").values].sort(), ["7.0.0", "v7"]);
});

test("composite：subdomain 段随 domain 段收窄（scoped 映射）", () => {
  const r = resolveRich();
  const cp = r.byField.find((f) => f.name === "cp");
  assert.deepEqual(cp.composite[0].values, ["ref", "tech"]);
  assert.deepEqual(cp.composite[1].scoped, { ref: ["overview"], tech: ["api"] });
  assert.deepEqual(cp.composite[2], { op: "free_slug" });
});

test("等价性（夹具面）：与 buildRuleSet 六概念逐项相等", () => {
  const r = resolveRich();
  const rs = buildRuleSet(RICH_ENUMS);
  const byName = Object.fromEntries(r.byField.map((f) => [f.name, f]));
  assert.deepEqual([...byName.arch_layer.values].sort(), [...rs.archLayers].sort());
  assert.deepEqual([...byName.arch_category.values].sort(), [...rs.archCategories].sort());
  assert.deepEqual([...byName.tags.values].sort(), [...new Set(rs.formalTags)].sort()); // formalTags flat 不去重为现行实现噪音——按成员等价（去重）比对
  assert.deepEqual([...byName.arch_subdomain.values].sort(), [...rs.subdomainIds].sort());
  assert.deepEqual([...byName.module.values].sort(), [...rs.moduleNames].sort());
  assert.deepEqual([...byName.status.values].sort(), [...rs.statuses].sort());
  assert.equal(byName.status.default, rs.defaultStatus);
});

test("等价性（真实 vault 面）：vault 在场必跑，缺省明示 skip", () => {
  let vault = process.env.VAULT_PATH;
  if (!vault || !fs.existsSync(vault)) {
    const envPath = path.join(ROOT, ".env");
    if (fs.existsSync(envPath)) {
      const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
      if (line) vault = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
  if (!vault || !fs.existsSync(vault)) {
    console.log("value-domain-resolver: (skip 真实 vault 未解析——等价性由夹具面覆盖)");
    return;
  }
  // PR-135：TheSchema 住址经唯一解析点（THESCHEMA_DIR＞vault 窗口＞仓内主源 data/theschema）——
  // 原 hardcoded vault/知识库/TheSchema 随迁仓退役（vault 侧窗口已不存在，带 VAULT_PATH 提交即 ENOENT）
  const schemaDir = resolveTheSchemaDir(vault);
  const enums = YAML.parse(fs.readFileSync(path.join(schemaDir, "enums.yaml"), "utf8"));
  const fields = YAML.parse(fs.readFileSync(path.join(schemaDir, "fields.yaml"), "utf8"));
  const versions = YAML.parse(fs.readFileSync(path.join(schemaDir, "versions.yaml"), "utf8"));
  const r = resolveValueDomains({ fields, enums, versions });
  assert.deepEqual(r.errors, [], "真实 vault 解析必须零悬空");
  const rs = buildRuleSet(enums);
  const byName = Object.fromEntries(r.byField.map((f) => [f.name, f]));
  assert.deepEqual([...byName.arch_layer.values].sort(), [...rs.archLayers].sort());
  assert.deepEqual([...byName.arch_category.values].sort(), [...rs.archCategories].sort());
  assert.deepEqual([...byName.tags.values].sort(), [...new Set(rs.formalTags)].sort()); // formalTags flat 不去重为现行实现噪音——按成员等价（去重）比对
  assert.deepEqual([...byName.arch_subdomain.values].sort(), [...rs.subdomainIds].sort());
  assert.deepEqual([...byName.module.values].sort(), [...rs.moduleNames].sort());
  assert.deepEqual([...byName.status.values].sort(), [...rs.statuses].sort());
  assert.equal(byName.status.default, rs.defaultStatus);
});

// ══ 红队复核批（2026-10-18）反例回归夹具：每缺陷一用例，防再犯 ══

test("红队A1+A2：legacy 标量子域与带空白 id——与 buildRuleSet 等价（ADR-008 D1 归一）", () => {
  const enums = { subdomains: { ref: [" overview ", { id: "api" }] } };
  const fields = { schema_version: 2, keys: {}, classes: { entity: { properties: [{ name: "arch_subdomain", value_domain: { source: "subdomains", resolve: { op: "ids" } } }] }, article: { properties: [] } } };
  const r = resolveValueDomains({ fields, enums, versions: {} });
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.byField[0].values].sort(), [...buildRuleSet(enums).subdomainIds].sort()); // 两侧均 ["api","overview"]
});

test("红队A3：default_status 纯空白 → 回落首项（不再当有效缺省）", () => {
  const enums = { lifecycle: { status: ["灰度", "在线"], default_status: " " } };
  const fields = { schema_version: 2, keys: {}, classes: { entity: { properties: [] }, article: { properties: [{ name: "status", value_domain: { source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" }, default: { from: "lifecycle.default_status", fallback: "first" } } }] } } };
  const r = resolveValueDomains({ fields, enums, versions: {} });
  assert.equal(r.byField[0].default, "灰度");
  assert.equal(r.byField[0].default, buildRuleSet(enums).defaultStatus);
});

test("红队D2：default.from 悬空 → errors（与别名表执法对称）", () => {
  const r = resolverOf({ source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" }, default: { from: "lifecycle.no_such" } });
  assert.ok(r.errors.some((e) => e.includes("缺省来源悬空") && e.includes("lifecycle.no_such")));
});

test("红队C1：filter 挂在非 ids op → 红（过滤意图不得静默丢失）", () => {
  const r = resolverOf({ source: "article_types", resolve: { op: "values", filter: "entity_usable" } });
  assert.ok(r.errors.some((e) => e.includes("filter 错挂")));
});

test("红队C2：composite 首段 scoped_by → 红", () => {
  const r = resolveValueDomains({
    fields: { schema_version: 2, keys: {}, classes: { entity: { properties: [{ name: "cp", value_domain: { source: "free", composite: [{ source: "domains", resolve: { op: "keys" }, scoped_by: "previous" }, { source: "subdomains", resolve: { op: "ids" }, scoped_by: "previous" }] } }] }, article: { properties: [] } } },
    enums: { domains: { ref: "参考资料" }, subdomains: { ref: [{ id: "overview" }] } },
    versions: {},
  });
  assert.ok(r.errors.some((e) => e.includes("composite 收窄错位")));
});

test("红队C5/C6：op 与段形态不符 → 红（不留静默空集空档）", () => {
  const r1 = resolverOf({ source: "domains", resolve: { op: "values" } }); // values 挂对象段
  assert.ok(r1.errors.some((e) => e.includes("op 形态不符") && e.includes("values")));
  const r2 = resolverOf({ source: "article_types", resolve: { op: "keys" } }); // keys 挂数组段
  assert.ok(r2.errors.some((e) => e.includes("op 形态不符") && e.includes("keys")));
});

test("红队A6：别名表标量值 → aliasMap 统一数组形态", () => {
  const r = resolveValueDomains({
    fields: { schema_version: 2, keys: {}, classes: { entity: { properties: [{ name: "tags", value_domain: { source: "tags", resolve: { op: "tags_union" }, normalize: { aliases: "tag_aliases" } } }] }, article: { properties: [] } } },
    enums: { tags: {}, tag_aliases: { 野生: "a", 组: ["x", "y"] } },
    versions: {},
  });
  assert.deepEqual(r.byField[0].aliasMap, { 野生: ["a"], 组: ["x", "y"] });
});

test("WP-197：semantic 透传——行带 semantic＝值原样；无 semantic 键的行 semantic=null（行形状恒定）", () => {
  const r = resolveValueDomains({
    fields: {
      schema_version: 2,
      keys: {},
      classes: {
        entity: {
          properties: [
            { name: "arch_since", display: "组件有效期起点", type: "string", required: "建议", semantic: "valid_from", value_domain: { source: "free" } },
            { name: "title", display: "标题", type: "string", required: "是", value_domain: { source: "free" } },
          ],
        },
        article: {
          properties: [
            { name: "status", display: "文档生命周期状态", type: "enum", required: "否", semantic: "status", value_domain: { source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" } } },
          ],
        },
      },
    },
    enums: { lifecycle: { status: ["灰度", "在线"], default_status: "" } },
    versions: {},
  });
  assert.deepEqual(r.errors, []);
  const byName = Object.fromEntries(r.byField.map((f) => [f.name, f]));
  assert.equal(byName.arch_since.semantic, "valid_from"); // semantic 值原样透传
  assert.equal(byName.status.semantic, "status"); // 跨类同名独立属性各带各值（entity/article 平铺）
  assert.equal(byName.title.semantic, null); // 无 semantic 键的行 → null（不缺键，行形状恒定）
  assert.ok(Object.hasOwn(byName.title, "semantic"), "无声明行也必须有 semantic 键");
});

test("红队A4/A5/A7：脏形态经 normalizeEnums 收口后与运行时同观", () => {
  const enums = {
    layers: [{ id: "gw" }, { id: "plate", entity_layer: "false" }],
    tags: { g1: ["a", 5], g2: ["b"] },
    lifecycle: { status: ["灰度", 7], default_status: 42 },
  };
  const fields = {
    schema_version: 2,
    keys: {},
    classes: {
      entity: {
        properties: [
          { name: "arch_layer", value_domain: { source: "layers", resolve: { op: "ids", filter: "entity_usable" } } },
          { name: "tags", value_domain: { source: "tags", resolve: { op: "tags_union" } } },
        ],
      },
      article: { properties: [] },
    },
  };
  const r = resolveValueDomains({ fields, enums, versions: {} });
  const rs = buildRuleSet(enums);
  assert.deepEqual([...r.byField[0].values].sort(), [...rs.archLayers].sort()); // 脏层降级后同观
  assert.deepEqual([...r.byField[1].values].sort(), [...new Set(rs.formalTags)].sort()); // 脏组降级后同观
});

// ══ WP-199 波3：collectValueDomainReferences——被引用 enums 顶层段集合（段删除保护引用面）══

test("WP-199 collector：五类引用＋op 隐式段全捕获（两类属性平铺遍历）", () => {
  const fieldsDoc = {
    schema_version: 2,
    keys: {},
    classes: {
      entity: {
        properties: [
          // ① source 首段
          { name: "sub", value_domain: { source: "subdomains", resolve: { op: "ids" } } },
          // ② segment 首段（点路径 lifecycle.status→lifecycle）＋⑤ default.from 首段（lifecycle.default_status→lifecycle）
          { name: "status", value_domain: { source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" }, default: { from: "lifecycle.default_status", fallback: "first" } } },
          // ③ normalize.aliases 段
          { name: "tags", value_domain: { source: "tags", resolve: { op: "tags_union" }, normalize: { aliases: "tag_aliases" } } },
          // ④ composite[].source
          { name: "cp", value_domain: { source: "free", composite: [{ source: "domains", resolve: { op: "keys" } }, { source: "subdomains", resolve: { op: "ids" }, scoped_by: "previous" }, { resolve: { op: "free_slug" } }] } },
          // ⑥ op 隐式段：matrix_union_fallback→arch_categories＋subdomain_constraints
          { name: "cat", value_domain: { source: "arch_categories", resolve: { op: "matrix_union_fallback" } } },
          // ⑥ op 隐式段：product_closure→architecture_projection
          { name: "prod", value_domain: { source: "architecture_projection", resolve: { op: "product_closure" } } },
        ],
      },
      article: {
        properties: [
          // free／versions 非 enums 被引用段，不入集
          { name: "title", value_domain: { source: "free" } },
          { name: "version", value_domain: { source: "versions", resolve: { op: "version_registry" } } },
          // 无 value_domain 的属性跳过不炸
          { name: "bare", display: "无配方" },
        ],
      },
    },
  };
  const refs = collectValueDomainReferences(fieldsDoc);
  assert.deepEqual(
    [...refs].sort(),
    ["arch_categories", "architecture_projection", "domains", "lifecycle", "subdomain_constraints", "subdomains", "tag_aliases", "tags"].sort(),
    "五类显式引用＋两类 op 隐式段全捕获；free/versions 不入集：" + [...refs].sort().join("、"),
  );
  assert.ok(!refs.has("free") && !refs.has("versions"), "free/versions 非 enums 段不入集");
});

test("WP-199 collector：op 隐式段单独成立（source: free 不连坐，隐式段照收）＋tags_union→tags", () => {
  const refs = collectValueDomainReferences({
    schema_version: 2,
    keys: {},
    classes: {
      entity: { properties: [{ name: "x", value_domain: { resolve: { op: "tags_union" } } }] },
      article: { properties: [{ name: "y", value_domain: { source: "free", resolve: { op: "matrix_union_fallback" } } }] },
    },
  });
  assert.deepEqual([...refs].sort(), ["arch_categories", "subdomain_constraints", "tags"].sort());
  assert.ok(!refs.has("free"), "free 不因 op 声明连坐入集");
});

test("WP-199 collector：空 doc／空 properties／缺类→空集（不炸）", () => {
  assert.deepEqual([...collectValueDomainReferences({})], []);
  assert.deepEqual([...collectValueDomainReferences(null)], []);
  assert.deepEqual([...collectValueDomainReferences({ schema_version: 2, keys: {}, classes: { entity: { properties: [] }, article: { properties: [] } } })], []);
});
