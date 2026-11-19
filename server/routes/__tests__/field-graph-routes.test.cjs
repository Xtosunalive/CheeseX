// field-graph-routes 红绿夹具（SPEC-020 波 3）：
// ①fields＋解析物齐全→200 图谱行（配方从结构渲染）②缺解析物→503 明示 ③缺 fields→503。
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const { register } = require("../field-graph-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

function makeVault({ withArtifact }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "field-graph-"));
  const schema = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schema, { recursive: true });
  // WP-195 v2 类属主形态：属性归两类属主（同名＝两个独立属性），scope 由属主类承载；
  // required 分域照真实字典（category-path entity=建议／article=是）。article 类殿后——
  // 红队高-2 用例经文件尾追加属性行注入漂移。
  fs.writeFileSync(
    path.join(schema, "fields.yaml"),
    `schema_version: 2
keys:
  entity: {primary: architecture-node-id, display: title}
  article: {primary: article_id, display: title}
classes:
  entity:
    properties:
      - name: tags
        display: 标签
        type: list
        required: 否
        layer: 内容属性
        value_domain: { source: tags, resolve: { op: tags_union }, normalize: { aliases: tag_aliases } }
        description: 测试。
      - name: category-path
        display: 分类路径
        type: string
        required: 建议
        layer: 内容属性
        value_domain:
          source: free
          composite:
            - { source: domains, resolve: { op: keys } }
            - { source: subdomains, resolve: { op: ids }, scoped_by: previous }
            - { resolve: { op: free_slug } }
        description: 测试。
  article:
    properties:
      - name: tags
        display: 标签
        type: list
        required: 否
        layer: 内容属性
        value_domain: { source: tags, resolve: { op: tags_union }, normalize: { aliases: tag_aliases } }
        description: 测试。
      - name: category-path
        display: 分类路径
        type: string
        required: 是
        layer: 内容属性
        value_domain:
          source: free
          composite:
            - { source: domains, resolve: { op: keys } }
            - { source: subdomains, resolve: { op: ids }, scoped_by: previous }
            - { resolve: { op: free_slug } }
        description: 测试。
`,
    "utf8",
  );
  fs.writeFileSync(path.join(schema, "enums.yaml"), "tags:\n  g1: [a, b]\ntag_aliases: {}\ndomains: {ref: 参考资料}\nsubdomains:\n  ref:\n    - id: overview\n", "utf8");
  fs.writeFileSync(path.join(schema, "versions.yaml"), "schema_version: 1\nproducts: {}\n", "utf8");
  if (withArtifact) {
    execFileSync("node", [path.join(ROOT, "scripts", "quality", "project-resolved-domains.mjs")], {
      // V11 收编：投影写经 repoWrite 目的地执法——夹具 TheSchema 须显式钉 THESCHEMA_DIR（隐式窗口写被拦）
      env: { ...process.env, VAULT_PATH: dir, THESCHEMA_DIR: schema },
      encoding: "utf8",
    });
  }
  return dir;
}

async function callRoute(vault) {
  const h = createRouteHarness();
  register(h.registerRoute, { vaultPath: vault });
  assert.equal(h.routes.size, 1);
  assert.equal(h.routes.has("GET /api/schema/field-graph"), true);
  const res = await h.call("GET /api/schema/field-graph");
  await h.close();
  return { status: res.statusCode, body: res.body };
}

test("齐全→200：图谱行含结构渲染的配方与值数", async () => {
  const vault = makeVault({ withArtifact: true });
  const { status, body } = await callRoute(vault);
  assert.equal(status, 200);
  const row = body.data.byField.find((r) => r.name === "tags" && r.scope[0] === "entity");
  assert.equal(row.valueCount, 2);
  assert.equal(row.domainKind, "closed");
  assert.match(row.recipe, /各分组并集 − disabled_tags/);
  assert.match(row.recipe, /tag_aliases 归一/);
  // WP-195 v2：label 取类属主 display（中文绑定名），scope 由属主类生成＝[cls]
  assert.equal(row.label, "标签");
  assert.deepEqual(row.scope, ["entity"]);
  // 红队高-1：复合域必须显式 composite 态（不再混译「自由」）
  const cp = body.data.byField.find((r) => r.name === "category-path" && r.scope[0] === "article");
  assert.equal(cp.domainKind, "composite");
  assert.ok(Array.isArray(cp.composite) && cp.composite.length === 3);
  assert.equal(cp.label, "分类路径");
  assert.deepEqual(cp.scope, ["article"]);
  assert.equal(cp.required, "是"); // 文章类 category-path 必填（分域语义）
  fs.rmSync(vault, { recursive: true, force: true });
});

test("缺解析物→503 明示（不降级空表）", async () => {
  const vault = makeVault({ withArtifact: false });
  const { status, body } = await callRoute(vault);
  assert.equal(status, 503);
  assert.equal(body.error_code, "FIELD_GRAPH_UNAVAILABLE");
  assert.match(body.message, /resolved-domains/);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红队高-2：配方与解析物不同步→行级 stale 明示（不混译自由/闭合）", async () => {
  const vault = makeVault({ withArtifact: true });
  const fieldsPath = path.join(vault, "知识库", "TheSchema", "fields.yaml");
  // 正向漂移：改 fields.yaml 加配方行，不重跑生成器（v2：追加到文末＝article 类 properties 成员）
  fs.appendFileSync(fieldsPath, "      - name: drifted\n        display: 漂移\n        type: enum\n        required: 否\n        layer: 内容属性\n        value_domain: { source: tags, resolve: { op: tags_union } }\n        description: 测试。\n", "utf8");
  const r1 = await callRoute(vault);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.data.byField.find((x) => x.name === "drifted" && x.scope[0] === "article").domainKind, "stale");
  // 反向漂移：删 tags 配方（变 free），解析物粘滞旧值（v2：首个命中＝实体类 tags 行）
  const s2 = fs.readFileSync(fieldsPath, "utf8").replace("value_domain: { source: tags, resolve: { op: tags_union }, normalize: { aliases: tag_aliases } }", "value_domain: { source: free }");
  fs.writeFileSync(fieldsPath, s2, "utf8");
  const r2 = await callRoute(vault);
  assert.equal(r2.body.data.byField.find((x) => x.name === "tags" && x.scope[0] === "entity").domainKind, "stale");
  fs.rmSync(vault, { recursive: true, force: true });
});
