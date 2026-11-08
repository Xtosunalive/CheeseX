// WP-031/PR-146（SPEC-033 C1/C3 真进程证据）：文档级豁免闭环实弹。分层：
//   L3 服务进程实弹——真起 server/main.cjs（夹具 vault＋staging master_graph 带豁免节点）：
//      GET /api/dashboard/topology → gaps 清单中 A（exempt_rules: [isolated_entity]）的
//      isolated_entity 不在列、B（无豁免）的在列（正反例同请求闭环）；
//      gapsExempted=1 且 gapsExemptedItems[0].exemptedBy=A（豁免可追溯不静默）。
//   抽取器→图 的 frontmatter 链路由 scripts/vault-py/graph/__tests__/test_exempt_rules.py 覆盖；
//   引擎过滤正反例由 gap-engine.test.cjs 用例 9-13 覆盖——本测试补齐「端点→引擎→响应」实弹面。
// 验证对象：dashboard-routes buildNodesById 透传＋computeGaps 同管道双粒度过滤＋响应透出（经公开 HTTP 端点）。
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

test("L3 真进程：文档级豁免闭环——豁免方不进清单、未豁免方在列、豁免可追溯", { timeout: 120_000 }, async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "gapexempt-vault-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gapexempt-data-"));
  write(vault, "知识库/wiki/entities/.keep", "");
  write(vault, "知识库/raw/precleaned/.keep", "");
  write(vault, "知识库/raw/drafts/.keep", "");
  // 夹具图必须来自真实抽取（两轮教训实录）：dashboard 读图面吃 derived-index store，server 启动
  // 链会摄取/重抽——手写图与文档集不一致时被空图覆盖（手写两实体 vs 空文档集）。文档集与图
  // 一致时重建幂等：两实体文档（其一 frontmatter 声明豁免）→ 真跑 extract_graph --apply 产图。
  write(vault, "知识库/wiki/entities/svc-exempt.md", "---\ntitle: 豁免实体A\nexempt_rules:\n  - isolated_entity\n---\n正文");
  write(vault, "知识库/wiki/entities/svc-plain.md", "---\ntitle: 普通实体B\n---\n正文");
  // PR-159 夹具密封：钉扎 vault 侧 TheSchema（仓内拷贝＋dependencies/versions 置空）——
  // 原「解除钉扎走仓回落」在仓内 dependencies/versions 载活库 in-flight 状态时必炸
  // （依赖交叉校验/版本快照索求对夹具恒失败）；密封后真抽取器本意不变。
  const sealedSchema = path.join(vault, "知识库", "TheSchema");
  fs.mkdirSync(sealedSchema, { recursive: true });
  const repoSchemaDir = path.join(REPO_ROOT, "data", "theschema");
  for (const name of ["enums.yaml", "ontology.yaml"]) {
    const src = path.join(repoSchemaDir, name);
    if (fs.existsSync(src)) fs.writeFileSync(path.join(sealedSchema, name), fs.readFileSync(src, "utf8"));
  }
  fs.writeFileSync(path.join(sealedSchema, "dependencies.yaml"), "dependencies: []\n");
  fs.writeFileSync(path.join(sealedSchema, "versions.yaml"), "schema_version: 1\nproducts: {}\n");
  // WP-049 L3：直拉 extract 前先物化词表信封（生产链由 Node 拉起点自动做；直拉测试须先 dump）
  const envelopePath = path.join(vault, ".ledger", "vocab-envelope.json");
  const dumpRun = require("node:child_process").spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "vault-runtime", "dump-vocab-envelope.mjs"), "--vault", vault, "--out", envelopePath],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.ok(dumpRun.status === 0, `信封物化应成功：${String(dumpRun.stderr || "").slice(-400)}`);
  // WP-117 批2：文档信封同款物化注入（extract_graph 文档面走信封 fail-closed——SPEC-084 §二.2）
  const docEnvelopePath = path.join(vault, ".ledger", "doc-envelope.json");
  const docDumpRun = require("node:child_process").spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "vault-runtime", "dump-doc-envelope.mjs"), "--vault", vault, "--out", docEnvelopePath],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.ok(docDumpRun.status === 0, `文档信封物化应成功：${String(docDumpRun.stderr || "").slice(-400)}`);
  const extractEnv = { ...process.env, KB_VAULT: vault, KB_DATA_DIR: dataDir, THESCHEMA_DIR: sealedSchema, VOCAB_ENVELOPE_PATH: envelopePath, DOC_ENVELOPE_PATH: docEnvelopePath };
  // 真跑 python 抽取器产图——解释器经 python-path 单源解析（ADR-002 禁裸 python3 调用点）
  const pyBin = require("../../shared/python-path.cjs").resolvePythonPath();
  const extractPy = require("node:child_process").spawnSync(pyBin, [path.join(REPO_ROOT, "scripts", "vault-py", "graph", "extract_graph.py"), "--apply"], { env: extractEnv, encoding: "utf8", timeout: 120_000 });
  assert.ok(extractPy.status === 0, `预抽取应成功：${String(extractPy.stderr || "").slice(-500)}`);
  write(dataDir, "master_graph.db", "x");
  write(dataDir, "staging/extract_manifest.json", "{}");
  const port = await freePort();
  const env = { ...process.env, VAULT_PATH: vault, KB_DATA_DIR: dataDir, API_PORT: String(port), THESCHEMA_DIR: sealedSchema };
  const server = spawn(process.execPath, [path.join(REPO_ROOT, "server", "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 60_000;
      const poll = async () => {
        try {
          const res = await fetch(`${base}/api/health`);
          if (res.ok) return resolve(undefined);
        } catch { /* not up yet */ }
        if (Date.now() > deadline) return reject(new Error(`server 未就绪，日志尾部：${log.slice(-800)}`));
        setTimeout(poll, 300);
      };
      poll();
    });

    // health ok ≠图服务就绪（全量并发负载下 masterGraph 读取可能晚到——asGraph 兜底空图，
    // flaky 实录）；轮询直到夹具两实体可见或超时
    let data = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await fetch(`${base}/api/dashboard/topology?scope=full`);
      assert.ok(res.ok, `dashboard topology 应 200，实际 ${res.status}，日志尾部：${log.slice(-800)}`);
      const body = await res.json();
      const candidate = body.data || {};
      if ((candidate.totalNodes || 0) >= 2) { data = candidate; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(data, `dashboard 应读到夹具两实体（轮询超时），日志尾部：${log.slice(-800)}`);
    const gaps = data.gaps || [];
    const isolated = gaps.filter((g) => g.type === "isolated_entity");

    // 反例①：未豁免实体 svc-plain 的孤立缺口仍在列
    assert.ok(isolated.some((g) => g.targetId === "entity-svc-plain"), "未豁免实体 svc-plain 的 isolated_entity 仍报");
    // 正例：豁免实体 svc-exempt 的孤立缺口不进清单
    assert.ok(!isolated.some((g) => g.targetId === "entity-svc-exempt"), "豁免实体 svc-exempt 的 isolated_entity 不在 gaps");
    // 反例②：豁免只按类型——豁免方的未豁免类型（missing_document_ref）仍报
    assert.ok(gaps.some((g) => g.type === "missing_document_ref" && g.targetId === "entity-svc-exempt"), "豁免方的 missing_document_ref 仍报（类型精确匹配）");
    // 可追溯：计数＋明细＋豁免归属
    assert.equal(data.gapsExempted, 1, "gapsExempted=1");
    const items = data.gapsExemptedItems || [];
    assert.equal(items.length, 1, "豁免明细 1 条");
    assert.equal(items[0].type, "isolated_entity");
    assert.equal(items[0].exemptedBy, "entity-svc-exempt", "豁免归属=声明规则的源实体");
    // 文案人话：gaps 中无内部话术禁词
    for (const g of gaps) assert.ok(!/master_graph|labels:|入度\+出度|REFERENCES/.test(g.detail), `detail 人话化：${g.detail}`);
  } finally {
    server.kill("SIGKILL");
    try { fs.rmSync(vault, { recursive: true, force: true }); } catch { /* 清理失败不掩测试结果 */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 同上 */ }
  }
});
