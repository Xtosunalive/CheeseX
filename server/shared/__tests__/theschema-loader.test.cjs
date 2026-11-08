// Component: TheSchema-Loader Contract Tests（PR-053）
// @responsible: 验证 TheSchema 全量形态收口（contracts/theschema.registry.json + theschema-loader.cjs 通用引擎）的行为契约：
//   契约① 注册表五文档登记齐全，引擎对未登记名抛错（禁绕过咽喉）
//   契约② 脏形态 → 局部降级不抛错（ontology 节点类型脏值 / dependencies 行脏值 / versions 版本脏值 / 账本条目脏值）
//   契约③ 严格实例真报错（写侧闸门同源），合法文档零降级
//   契约④ Python 咽喉（schema_loader.normalize_the_schema）与 Node 引擎同源消费同一份注册表与 schema 文件
//   契约⑤ 真实库五份 yaml 零降级（KB_VAULT_PR053/VAULT_PATH 注入 vault 根，缺省经 resolveTheSchemaDir
//        落仓内主源 data/theschema——SPEC-023 迁移后真实库即仓内主源；缺目录时跳过）
// @inputs: contracts/theschema.*.schema.json、server/shared/theschema-loader.cjs、scripts/vault-runtime/schema_loader.py
// @outputs: 单元/集成测试断言结果
// @context: Schema-Manager

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeDocument, validateDocumentStrict, getSchema, listDocuments } = require("../theschema-loader.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PY_LOADER = path.join(ROOT, "scripts", "vault-runtime", "schema_loader.py");

function test(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
    return true;
  } catch (error) {
    console.log(`NOT ok  ${name}`);
    console.log(String((error && error.stack) || error).split("\n").slice(0, 6).join("\n"));
    return false;
  }
}

async function main() {
  let passed = 0;
  let failed = 0;
  const run = (name, fn) => { if (test(name, fn)) passed++; else failed++; };

  run("契约① 注册表登记十文档且与预期一致（ADR-008 +fields；ADR-009 +subjects/subject-enums；WP-054 +entity-aliases）", () => {
    assert.deepEqual(listDocuments().sort(), ["article_associations", "dependencies", "entity-aliases", "enums", "fields", "ontology", "relations", "subject-enums", "subjects", "versions"]);
  });

  run("契约①b 未登记文档名抛错（禁绕过注册表取形态）", () => {
    assert.throws(() => normalizeDocument("nonexistent", {}), /THE_SCHEMA_UNKNOWN_DOCUMENT/);
  });

  run("契约② ontology 脏节点局部降级：relation_types 值为标量 → 该节点丢弃、其余保留、不抛", () => {
    const dirty = {
      node_types: { System: { description: "x", category: "服务", color: "blue", icon: "server", allows_relations: ["USES"] } },
      relation_types: "not-an-object",
      constraints: [{ id: "c1", description: "d", check: "c", severity: "error" }],
    };
    const { data, degradedNodes } = normalizeDocument("ontology", dirty);
    assert.equal(degradedNodes.length, 1);
    assert.equal(degradedNodes[0].path, "relation_types");
    assert.deepEqual(data.node_types.System.allows_relations, ["USES"]);
    assert.deepEqual(data.constraints, [{ id: "c1", description: "d", check: "c", severity: "error" }]);
    assert.equal(data.relation_types, undefined);
  });

  run("契约②b dependencies 行脏值降级：source 为数字 → 该行占位 null（消费方过滤），不抛", () => {
    const dirty = {
      dependencies: [
        { source: "comp-a", target: "comp-b", type: "DEPENDS_ON" },
        { source: 42, target: "comp-x", type: "DEPENDS_ON" },
      ],
    };
    const { data, degradedNodes } = normalizeDocument("dependencies", dirty);
    assert.equal(degradedNodes.length, 1);
    assert.equal(data.dependencies[0].source, "comp-a");
    assert.equal(data.dependencies[1], null);
  });

  run("契约②c versions 版本别名脏形态降级：aliases 标量 → 产品节点丢弃，其余产品保留", () => {
    const dirty = {
      schema_version: 1,
      reserved_products: ["通用"],
      products: {
        As: { versions: [{ id: "7.0.6.7", label: "L", status: "draft", release_date: null, aliases: ["7067"], snapshot: null }] },
        Bad: { versions: [{ id: "1.0", label: "B", status: "draft", release_date: null, aliases: "not-an-array", snapshot: null }] },
      },
    };
    const { data, degradedNodes } = normalizeDocument("versions", dirty);
    assert.ok(degradedNodes.some((node) => node.path === "products.Bad"));
    assert.equal(data.products.Bad, undefined);
    assert.equal(data.products.As.versions[0].id, "7.0.6.7");
  });

  run("契约②d 账本条目脏形态降级：componentIds 标量 → 该条目占位 null，历史其余条目不受牵连", () => {
    const dirty = {
      schema_version: 1,
      decisions: [
        { decisionId: "d1", articleId: "a1", action: "replace", componentIds: ["arch"], versionIds: ["v1"] },
        { decisionId: "d2", articleId: "a2", action: "replace", componentIds: "arch", versionIds: ["v1"] },
      ],
    };
    const { data, degradedNodes } = normalizeDocument("article_associations", dirty);
    assert.ok(degradedNodes.length >= 1);
    assert.equal(data.decisions[1], null);
    assert.equal(data.decisions[0].decisionId, "d1");
  });

  run("契约③ 严格实例真报错（写侧闸门同源）：脏形态返回人读错误文案", () => {
    const errors = validateDocumentStrict("dependencies", { dependencies: [{ source: 42 }] });
    assert.ok(Array.isArray(errors) && errors.length > 0);
    assert.ok(errors.every((line) => typeof line === "string" && line.length > 0));
  });

  run("契约③b 合法最小文档零降级零痕迹", () => {
    for (const name of listDocuments()) {
      const { degradedNodes, normalizationTrail } = normalizeDocument(name, {});
      assert.deepEqual(degradedNodes, [], `${name} 空对象不应降级`);
      assert.deepEqual(normalizationTrail, [], `${name} 空对象不应有转化痕迹`);
    }
  });

  run("契约③c schema 文件存在且 draft-07、x-lenientPaths 显式声明", () => {
    for (const name of listDocuments()) {
      const schema = getSchema(name);
      assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#", `${name} 应为 draft-07`);
      assert.ok(Array.isArray(schema["x-lenientPaths"]), `${name} 宽容口径必须显式声明（空数组=全严格）`);
    }
    // enums 保留 A 口径唯一宽容位
    assert.deepEqual(getSchema("enums")["x-lenientPaths"], ["/tag_aliases"]);
  });

  run("契约④ Python 咽喉与 Node 同源：同一 schema 文件、同一降级语义（有 jsonschema 环境时）", () => {
    let python;
    try {
      const stdout = execFileSync(
        process.env.PYTHON_PATH || "python3",
        ["-c", "import jsonschema, sys; sys.path.insert(0, sys.argv[1]); import schema_loader; import json; d, trail, deg = schema_loader.normalize_the_schema(\"dependencies\", {\"dependencies\": [{\"source\": 42}]}); print(json.dumps({\"data\": d, \"degraded\": deg}))", path.dirname(PY_LOADER)],
        { encoding: "utf-8", timeout: 30000 },
      );
      python = JSON.parse(stdout.trim().split("\n").pop());
    } catch (error) {
      const missing = /No module named '(jsonschema|yaml)'/.test(String(error));
      assert.ok(missing, `Python 咽喉探针失败（非缺库）：${error.message}`);
      console.log("    （跳过断言：当前解释器缺 jsonschema/yaml，带 PYTHON_PATH 重跑即测）");
      return;
    }
    assert.ok(python.degraded.length >= 1, "Python 侧应同样降级脏 dependencies 行");
    assert.equal(python.data.dependencies[0], null, "Python 侧脏行应降级为 null 占位（与 Node dropNode 同语义）");
    assert.ok(!Array.isArray(python.data.dependencies) || python.data.dependencies.every((row) => row === null || (row && typeof row.source === "string")), "Python 侧不应残留脏形态行");
  });

  run("契约⑤ 真实库 yaml 零降级（库存在时；ADR-009 后含 subjects 注册表）", () => {
    const vault = process.env.KB_VAULT_PR053 || process.env.VAULT_PATH || path.resolve(__dirname, "..", "..", "..");
    const { resolveTheSchemaDir } = require("../theschema-root.cjs");
    const dir = resolveTheSchemaDir(vault);
    if (!fs.existsSync(dir)) {
      console.log("    （跳过：真实库不存在）");
      return;
    }
    const YAML = require("yaml");
    for (const name of listDocuments()) {
      // 文档名 → 物理路径映射：subjects.yaml 直存根；subject-enums 住 subjects/<id>/enums.yaml（ADR-009 D1
      // 目录隔离——无主体层文件时跳过，有则逐本校验）
      if (name === "subject-enums") {
        const subjectsRoot = path.join(dir, "subjects");
        if (!fs.existsSync(subjectsRoot)) continue;
        for (const entry of fs.readdirSync(subjectsRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const subjectFile = path.join(subjectsRoot, entry.name, "enums.yaml");
          if (!fs.existsSync(subjectFile)) continue;
          const parsed = YAML.parse(fs.readFileSync(subjectFile, "utf-8")) || {};
          const { degradedNodes, normalizationTrail } = normalizeDocument(name, parsed);
          assert.deepEqual(degradedNodes, [], `${name}/${entry.name} 真实库不应有降级节点`);
          assert.deepEqual(normalizationTrail, [], `${name}/${entry.name} 真实库不应有 coercion 痕迹`);
        }
        continue;
      }
      const file = path.join(dir, `${name}.yaml`);
      if (!fs.existsSync(file)) continue;
      const parsed = YAML.parse(fs.readFileSync(file, "utf-8")) || {};
      const { degradedNodes, normalizationTrail } = normalizeDocument(name, parsed);
      assert.deepEqual(degradedNodes, [], `${name} 真实库不应有降级节点`);
      assert.deepEqual(normalizationTrail, [], `${name} 真实库不应有 coercion 痕迹`);
    }
  });

  console.log(`TheSchema loader contract tests: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
