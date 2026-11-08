// Component: Entity-Growth-Edit Tests（SPEC-005 A3 契约层）
// @responsible: 验证裁定通道写回——create 出生语义（origin/grown_from/first_seen）与
//               link-existing 别名归并（F02c aliases 承接）；R1（唯一写路径=absorb）。
// @inputs: schema-write-service.discoveryEdit（field=entity）+ 临时 vault
// @outputs: node:test 断言
// @context: SPEC-005 §3.2；先例=schema-write-service.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSchemaWriteService } = require("../../schema-manager/schema-write-service.cjs");

function makeVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "growedit-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

function svcOf(vault) {
  return createSchemaWriteService({ vaultPath: vault, logger: { info() {}, warn() {}, error() {} } });
}

test("A3 create：出生即带 origin/grown_from/first_seen（article-grown 语义）", () => {
  const vault = makeVault({});
  const out = svcOf(vault).discoveryEdit({
    patch: { field: "entity", value: "消息队列", assignMode: "create", sources: ["知识库/wiki/articles/b.md 提及×2"] },
  });
  assert.equal(out.action, "create");
  const raw = fs.readFileSync(path.join(vault, "知识库/wiki/entities/消息队列.md"), "utf8");
  assert.match(raw, /origin: article-grown/, "origin 字段");
  assert.match(raw, /grown_from:\n  - "知识库\/wiki\/articles\/b\.md 提及×2"/, "来源链（H2）");
  assert.match(raw, /first_seen: \d{4}-\d{2}-\d{2}/, "首现日期");
  assert.match(raw, /architecture-node-id: grown-/, "node id 派生");
});

test("A3 create：同名实体已存在 → 409（F02b 唯一性在出生路径执法）", () => {
  const vault = makeVault({ "知识库/wiki/entities/知识图谱.md": "---\ntitle: 知识图谱\n---\n" });
  assert.throws(
    () => svcOf(vault).discoveryEdit({ patch: { field: "entity", value: "知识图谱", assignMode: "create" } }),
    (e) => e.status === 409 && e.code === "SCHEMA_VALUE_CONFLICT",
  );
});

test("A3 link-existing：候选名归并进已有实体 aliases", () => {
  const vault = makeVault({
    "知识库/wiki/entities/可观测性.md": "---\ntitle: 可观测性\narchitecture-node-id: obs-1\n---\nbody\n",
  });
  const out = svcOf(vault).discoveryEdit({
    patch: { field: "entity", value: "observability", assignMode: "link-existing", targetEntity: "可观测性" },
  });
  assert.equal(out.action, "link-existing");
  const raw = fs.readFileSync(path.join(vault, "知识库/wiki/entities/可观测性.md"), "utf8");
  assert.match(raw, /aliases:\n  - "observability"/, "别名追加");
  assert.match(raw, /---\nbody/, "正文保持不动");
});

test("A3 link-existing：已有 aliases 追加不重复；目标不存在 404", () => {
  const vault = makeVault({
    "知识库/wiki/entities/可观测性.md": "---\ntitle: 可观测性\naliases:\n  - \"监控\"\n---\n",
  });
  const svc = svcOf(vault);
  svc.discoveryEdit({ patch: { field: "entity", value: "observability", assignMode: "link-existing", targetEntity: "可观测性" } });
  svc.discoveryEdit({ patch: { field: "entity", value: "observability", assignMode: "link-existing", targetEntity: "可观测性" } });
  const raw = fs.readFileSync(path.join(vault, "知识库/wiki/entities/可观测性.md"), "utf8");
  const hits = raw.match(/observability/g) || [];
  assert.equal(hits.length, 1, "重复 link 不重复写");
  assert.match(raw, /"监控"/, "原别名保留");
  assert.throws(
    () => svc.discoveryEdit({ patch: { field: "entity", value: "x", assignMode: "link-existing", targetEntity: "不存在" } }),
    (e) => e.status === 404,
  );
});

test("A3 边界：非法 assignMode 400", () => {
  assert.throws(
    () => svcOf(makeVault({})).discoveryEdit({ patch: { field: "entity", value: "x", assignMode: "ignore" } }),
    (e) => e.status === 400,
  );
});

// WP-A/WP-B（2026-10-09 借镜 dictionary-of-ai-coding）：实体内容契约五件套 + 出生反查
test("WP-A create：正文带五件套骨架（机制/Surfaces/Diagnostic/Avoid/Usage）", () => {
  const vault = makeVault({});
  svcOf(vault).discoveryEdit({ patch: { field: "entity", value: "消息队列", assignMode: "create", sources: ["知识库/wiki/articles/b.md col:42"] } });
  const raw = fs.readFileSync(path.join(vault, "知识库/wiki/entities/消息队列.md"), "utf8");
  ["## 机制", "## Surfaces as（表现症状）", "## Diagnostic test（可判别测试）", "## Avoid（防误用边界）", "## Usage（使用实录）"]
    .forEach((h) => assert.ok(raw.includes(h), `骨架含 ${h}`));
  assert.match(raw, /- 知识库\/wiki\/articles\/b\.md col:42/, "Usage 段回填来源样例");
});

test("WP-B create：返回体带 backlinks（提及反查，消费扫描器数据）", () => {
  const vault = makeVault({
    "知识库/raw/x.md": "---\ntitle: X\n---\n文中两次提到 [[分布式锁]]。\n",
  });
  const out = svcOf(vault).discoveryEdit({ patch: { field: "entity", value: "分布式锁", assignMode: "create" } });
  assert.equal(Array.isArray(out.backlinks), true, "backlinks 数组存在");
  // vault fixture 内 x.md 提及未解析目标——建实体前该名是候选，反查应含该文件
  assert.ok(out.backlinks.some((b) => b.file && b.file.includes("x.md")), "反查含提及文件");
});

// 第一性修正②：guide⑥「派生总目」机制兑现（entityCatalog 纯派生）
test("实体总目：discovery 数据含 entityCatalog（分组+计数+origin）", () => {
  const { discoveryData } = require("../../../routes/schema-discovery-routes.cjs");
  const vault = makeVault({
    "知识库/wiki/entities/甲.md": "---\ntitle: 甲\nmodule: 前端\norigin: article-grown\n---\nb\n",
    "知识库/wiki/entities/乙.md": "---\ntitle: 乙\n---\nb\n",
    "知识库/raw/y.md": "---\ntitle: Y\n---\n看 [[甲]]。\n",
  });
  const d = discoveryData(vault);
  assert.ok(Array.isArray(d.entityCatalog) && d.entityCatalog.length >= 1, "总目存在");
  const fe = d.entityCatalog.find((g) => g.group === "前端");
  const un = d.entityCatalog.find((g) => g.group === "未分组");
  assert.ok(fe && fe.items.some((i) => i.name === "甲" && i.mentionCount === 1), "甲入前端组且提及×1");
  assert.ok(un && un.items.some((i) => i.name === "乙" && i.origin === "seed"), "无 module 落未分组 origin=seed");
});
