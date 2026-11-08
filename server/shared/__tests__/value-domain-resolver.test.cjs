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
const { resolveValueDomains } = require("../value-domain-resolver.cjs");
const { buildRuleSet } = require("../enums-loader.cjs");
const { resolveTheSchemaDir } = require("../theschema-root.cjs");

function resolverOf(vd) {
  return resolveValueDomains({ fields: { fields: [{ name: "x", scope: ["entity"], value_domain: vd }] }, enums: {}, versions: {} });
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
      fields: [
        { name: "arch_layer", scope: ["entity"], value_domain: { source: "layers", resolve: { op: "ids", filter: "entity_usable" } } },
        { name: "arch_category", scope: ["entity"], value_domain: { source: "arch_categories", resolve: { op: "matrix_union_fallback" } } },
        { name: "tags", scope: ["entity"], value_domain: { source: "tags", resolve: { op: "tags_union" } } },
        { name: "arch_subdomain", scope: ["entity"], value_domain: { source: "subdomains", resolve: { op: "ids" } } },
        { name: "module", scope: ["entity"], value_domain: { source: "modules", resolve: { op: "keys" } } },
        { name: "status", scope: ["article"], value_domain: { source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" }, default: { from: "lifecycle.default_status", fallback: "first" } } },
        { name: "product", scope: ["article"], value_domain: { source: "architecture_projection", resolve: { op: "product_closure" } } },
        { name: "version", scope: ["article"], value_domain: { source: "versions", resolve: { op: "version_registry" } } },
        { name: "cp", scope: ["entity"], value_domain: { source: "free", composite: [{ source: "domains", resolve: { op: "keys" } }, { source: "subdomains", resolve: { op: "ids" }, scoped_by: "previous" }, { resolve: { op: "free_slug" } }] } },
      ],
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
  const r2 = resolveValueDomains({ fields: { fields: [{ name: "arch_category", scope: ["entity"], value_domain: { source: "arch_categories", resolve: { op: "matrix_union_fallback" } } }] }, enums: noMatrix, versions: {} });
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
  const fields = { fields: [{ name: "arch_subdomain", scope: ["entity"], value_domain: { source: "subdomains", resolve: { op: "ids" } } }] };
  const r = resolveValueDomains({ fields, enums, versions: {} });
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.byField[0].values].sort(), [...buildRuleSet(enums).subdomainIds].sort()); // 两侧均 ["api","overview"]
});

test("红队A3：default_status 纯空白 → 回落首项（不再当有效缺省）", () => {
  const enums = { lifecycle: { status: ["灰度", "在线"], default_status: " " } };
  const fields = { fields: [{ name: "status", scope: ["article"], value_domain: { source: "lifecycle", segment: "lifecycle.status", resolve: { op: "values" }, default: { from: "lifecycle.default_status", fallback: "first" } } }] };
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
    fields: { fields: [{ name: "cp", scope: ["entity"], value_domain: { source: "free", composite: [{ source: "domains", resolve: { op: "keys" }, scoped_by: "previous" }, { source: "subdomains", resolve: { op: "ids" }, scoped_by: "previous" }] } }] },
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
    fields: { fields: [{ name: "tags", scope: ["entity"], value_domain: { source: "tags", resolve: { op: "tags_union" }, normalize: { aliases: "tag_aliases" } } }] },
    enums: { tags: {}, tag_aliases: { 野生: "a", 组: ["x", "y"] } },
    versions: {},
  });
  assert.deepEqual(r.byField[0].aliasMap, { 野生: ["a"], 组: ["x", "y"] });
});

test("红队A4/A5/A7：脏形态经 normalizeEnums 收口后与运行时同观", () => {
  const enums = {
    layers: [{ id: "gw" }, { id: "plate", entity_layer: "false" }],
    tags: { g1: ["a", 5], g2: ["b"] },
    lifecycle: { status: ["灰度", 7], default_status: 42 },
  };
  const fields = {
    fields: [
      { name: "arch_layer", scope: ["entity"], value_domain: { source: "layers", resolve: { op: "ids", filter: "entity_usable" } } },
      { name: "tags", scope: ["entity"], value_domain: { source: "tags", resolve: { op: "tags_union" } } },
    ],
  };
  const r = resolveValueDomains({ fields, enums, versions: {} });
  const rs = buildRuleSet(enums);
  assert.deepEqual([...r.byField[0].values].sort(), [...rs.archLayers].sort()); // 脏层降级后同观
  assert.deepEqual([...r.byField[1].values].sort(), [...new Set(rs.formalTags)].sort()); // 脏组降级后同观
});
