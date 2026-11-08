const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const routes = require("../schema-discovery-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");


(async function run() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "schema-discovery-"));
  const h = createRouteHarness();
  try {
    const schemaDir = path.join(vault, "知识库", "TheSchema");
    const entityDir = path.join(vault, "知识库", "wiki", "entities");
    fs.mkdirSync(schemaDir, { recursive: true }); fs.mkdirSync(entityDir, { recursive: true });
    const enumsPath = path.join(schemaDir, "enums.yaml");
    fs.writeFileSync(enumsPath, YAML.stringify({
      domains: { arch: "架构" }, subdomains: { arch: ["architecture"] },
      layers: [{ id: "service", label: "服务", color: "gray", layout: "central" }],
      arch_categories: ["服务"],
      architecture_projection: { layer_aliases: { backend: "service" }, category_aliases: {} },
    }));
    fs.writeFileSync(path.join(entityDir, "a.md"), "---\narchitecture-node-id: a\narch_layer: wild\narch_category: 未定义\narch_subdomain: new-sub\n---\n");
    fs.writeFileSync(path.join(entityDir, "b.md"), "---\narchitecture-node-id: b\narch_layer: wild\n---\n");
    // PR-088 接线一：正式组合（architecture×服务——双方均正式词）→ 进组合候选；a.md 的野生组合不进
    fs.writeFileSync(path.join(entityDir, "f.md"), "---\narchitecture-node-id: f\narch_category: 服务\narch_subdomain: architecture\n---\n");
    mergeW1aActionTypes(path.join(schemaDir, "ontology.yaml")); // WP-048 W1-A：absorb 已动作化
    setupActionRuntime({ vaultPath: vault });
    // 波3b：注入 anomalyListIssues mock（信号门槛面）——两条同款违规（F01）
    routes.register(h.registerRoute, {
      vaultPath: vault,
      anomalyListIssues: () => [
        { issueId: "i1", issueKind: "missing_field", evidence: [{ path: "a.md", ruleId: "F01" }] },
        { issueId: "i2", issueKind: "missing_field", evidence: [{ path: "b.md", ruleId: "F01" }] },
        { issueId: "i3", issueKind: "wild_tag", evidence: [{ path: "c.md", ruleId: "W01" }] },
      ],
    });
    const get = (url) => h.call("GET /api/schema/discovery", url);
    const found = await get("/api/schema/discovery");
    assert.equal(found.statusCode, 200);
    assert.equal(found.body.data.discovery.layers[0].value, "wild");
    assert.equal(found.body.data.discovery.layers[0].count, 2);
    // 波2（SPEC-007 §3.1）：响应含 vocabularyProfile（波1 引擎接线）——默认阈值 1
    assert.ok(found.body.data.vocabularyProfile, "vocabularyProfile 缺失");
    assert.equal(found.body.data.vocabularyProfile.summary.verifiedThreshold, 1);
    assert.ok(found.body.data.vocabularyProfile.dimensions.layer, "layer 维度缺失");
    // 波3b：ruleCandidates 默认门槛 2——F01（2 次）出信号，W01（1 次）被滤
    assert.ok(found.body.data.ruleCandidates, "ruleCandidates 缺失");
    assert.equal(found.body.data.ruleCandidates.minCount, 2);
    assert.equal(found.body.data.ruleCandidates.signals.length, 1);
    assert.equal(found.body.data.ruleCandidates.signals[0].ruleId, "F01");
    // PR-088 接线一：matrixCandidates 挂载——观察期（矩阵未配置）、只收正式组合 architecture×服务
    assert.ok(found.body.data.matrixCandidates, "matrixCandidates 缺失");
    assert.equal(found.body.data.matrixCandidates.stage, "observe");
    assert.deepEqual(found.body.data.matrixCandidates.candidates.map((c) => `${c.subdomain}|${c.category}`), ["architecture|服务"]);
    assert.equal(found.body.data.matrixCandidates.candidates[0].domainId, "arch");
    assert.equal(found.body.data.matrixCandidates.candidates[0].occurrences, 1);
    // 波3b：?minCount=1 放宽——W01 也出信号（3 条全出）
    const m1 = await get("/api/schema/discovery?minCount=1");
    assert.equal(m1.body.data.ruleCandidates.minCount, 1);
    assert.equal(m1.body.data.ruleCandidates.signals.length, 2);
    // 非法值回落 2
    const mBad = await get("/api/schema/discovery?minCount=abc");
    assert.equal(mBad.body.data.ruleCandidates.minCount, 2);
    // §3.2 阈值透传：?verifiedThreshold=5 生效；非法值回落 1；既有字段不破坏
    const t5 = await get("/api/schema/discovery?verifiedThreshold=5");
    assert.equal(t5.body.data.vocabularyProfile.summary.verifiedThreshold, 5);
    assert.equal(t5.body.data.discovery.layers[0].value, "wild", "既有字段被破坏");
    for (const bad of ["abc", "0", "-1", "3.5", "999"]) {
      const t = await get(`/api/schema/discovery?verifiedThreshold=${bad}`);
      assert.equal(t.body.data.vocabularyProfile.summary.verifiedThreshold, 1, `非法值 ${bad} 应回落 1`);
    }
    const before = fs.readFileSync(enumsPath);
    // PR-085：原断言在 main 上是假绿（直调 handler 从不 emit("end")，await 永不 resolve，后续断言从未执行、进程静默 0 退出）。
    // 现经 inject 真实执行：未装配 schemaWriteService → 契约校验 400 或 503 SCHEMA_WRITE_UNAVAILABLE，enums.yaml 一律不得被改动。
    const absorb = await h.call("POST /api/schema/discovery/absorb", undefined, { items: [] });
    assert.ok([400, 503].includes(absorb.statusCode), "absorb 未装配写服务须被拒：" + JSON.stringify(absorb.body));
    assert.deepEqual(fs.readFileSync(enumsPath), before);
    // B1=b 执法＋WP-064 分离：absorb field=arch_categories → 403 DERIVED_SEGMENT_READ_ONLY（派生视图冻结维持）；
    // field=categories（声明宿主）放行走写闸——写入落地 enums.yaml（WP-057 实测先例同链）。
    const h2 = createRouteHarness();
    try {
      const { createSchemaWriteService } = require("../../services/schema-manager/schema-write-service.cjs");
      routes.register(h2.registerRoute, { vaultPath: vault, schemaWriteService: createSchemaWriteService({ vaultPath: vault }) });
      const b1 = await h2.call("POST /api/schema/discovery/absorb", undefined, { revision: require("node:crypto").createHash("sha256").update(before).digest("hex"), patch: { field: "arch_categories", value: "新类别", mode: "formal" } });
      assert.equal(b1.statusCode, 403, "absorb arch_categories 须映射 403：" + JSON.stringify(b1.body));
      assert.equal(b1.body.error_code, "DERIVED_SEGMENT_READ_ONLY");
      assert.deepEqual(fs.readFileSync(enumsPath), before, "403 拒收不得改动 enums.yaml");
    } finally { await h2.close(); }
  } finally { await h.close(); fs.rmSync(vault, { recursive: true, force: true }); }
  console.log("Schema discovery routes tests passed");
})().catch((error) => { console.error(error); process.exit(1); });

// ── WP-116 批1 行为钉：scanArticleTags 切分改经文档装载宿主（loadDocument＋docField）——
// 文章侧 tags 采集对边界输入的产出与迁移前基线探针实测逐字一致（无 frontmatter/空文件/
// 未闭合块/空块/BOM 照旧跳过；多 --- 只取第一块；CRLF 宿主可解析——旧行级正则整文跳过，
// 为切分口径收敛的如实增列）。经 discoveryData 公开出口钉（scanArticleTags 为模块内私有）。
(async function runTagsBoundaryPins() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "schema-discovery-tags-"));
  try {
    const schemaDir = path.join(vault, "知识库", "TheSchema");
    const entityDir = path.join(vault, "知识库", "wiki", "entities");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.mkdirSync(entityDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "enums.yaml"), YAML.stringify({
      domains: { arch: "架构" }, subdomains: { arch: ["architecture"] },
      layers: [], arch_categories: [],
      architecture_projection: { layer_aliases: {}, category_aliases: {}, subdomain_aliases: {} },
    }));
    const precleaned = path.join(vault, "知识库", "raw", "precleaned");
    const drafts = path.join(vault, "知识库", "raw", "drafts");
    fs.mkdirSync(precleaned, { recursive: true });
    fs.mkdirSync(drafts, { recursive: true });
    fs.writeFileSync(path.join(precleaned, "flow.md"), "---\ntags: [野生A, 野生B]\n---\n正文\n");
    fs.writeFileSync(path.join(precleaned, "scalar.md"), "---\ntags: 野生C, 野生D\n---\n正文\n");
    fs.writeFileSync(path.join(precleaned, "block.md"), "---\ntags:\n  - 野生E\n  - 野生F\n---\n正文\n");
    fs.writeFileSync(path.join(precleaned, "quoted.md"), "---\ntags: '野生G, 野生H'\n---\n正文\n");
    fs.writeFileSync(path.join(precleaned, "no-fm.md"), "没有frontmatter\ntags: 野生I\n");
    fs.writeFileSync(path.join(precleaned, "empty.md"), "");
    fs.writeFileSync(path.join(precleaned, "unclosed.md"), "---\ntags: 野生J\n");
    fs.writeFileSync(path.join(precleaned, "empty-block.md"), "---\n---\ntags: 野生K\n");
    fs.writeFileSync(path.join(precleaned, "multi.md"), "---\ntags: [野生L]\n---\n正文\n---\ntags: [野生M]\n---\n");
    fs.writeFileSync(path.join(precleaned, "bom.md"), "﻿---\ntags: [野生N]\n---\n正文");
    fs.writeFileSync(path.join(precleaned, "crlf.md"), "---\r\ntags:\r\n  - 野生O\r\n---\r\n正文");
    fs.writeFileSync(path.join(drafts, "draft-tag.md"), "---\ntags: [野生P]\n---\n正文\n");

    const data = routes.discoveryData(vault);
    const tagValue = (v) => data.discovery.tags.find((t) => t.value === v);
    // 常规四形态（行内数组/标量串/块列表/引号标量）照旧收，逐值归一口径不变
    for (const v of ["野生A", "野生B", "野生C", "野生D", "野生E", "野生F", "野生G", "野生H"]) {
      assert.ok(tagValue(v), `常规形态野生 tag ${v} 应被采集：${JSON.stringify(data.discovery.tags)}`);
    }
    // 边界输入照旧跳过（迁移前基线同产出）
    for (const v of ["野生I", "野生J", "野生K", "野生M", "野生N"]) {
      assert.ok(!tagValue(v), `边界输入 ${v} 不得被采集（无 frontmatter/空文件/未闭合/空块/BOM）`);
    }
    assert.ok(tagValue("野生L"), "多 --- 只取第一块的 tags");
    assert.ok(tagValue("野生O"), "CRLF 文件宿主可解析（旧行级正则跳过——WP-116 切分口径收敛的如实增列）");
    assert.ok(tagValue("野生P"), "drafts 目录照扫");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  console.log("Schema discovery tags boundary pins passed");
})().catch((error) => { console.error(error); process.exit(1); });
