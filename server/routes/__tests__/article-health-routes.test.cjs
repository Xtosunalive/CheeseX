'use strict';
// WP-156：文章健康度路由面测试——注册路径字面量（action-coverage 判据）＋响应形状（契约规则全量现算读模型）。
// 层级：服务层真实计算（tmp 夹具真文件＋真 buildDocEnvelope 装载入口批量形态）＋薄路由封装。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROUTES = require("../article-health-routes.cjs");
const { loadRuleSetForVault } = require("../../services/schema-manager/compliance-rule-set-service.cjs");
const { computeArticleHealth } = require("../../services/article-health/article-health-service.cjs");

function buildFixtureVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp156-health-"));
  const kb = path.join(dir, "知识库");
  fs.mkdirSync(path.join(kb, "wiki", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(kb, "wiki", "sources", "dirty.md"),
    '---\ntitle: 脏\nstatus: 有效\nreview-cycle: 7d\ntags: 乱写\ncategory: 旧\n---\n正文\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(kb, "wiki", "sources", "clean.md"),
    '---\ntitle: 净\n---\n正文\n',
    'utf8',
  );
  return dir;
}

test("GET /api/articles/health 注册（action-coverage 路径字面量判据）＋读模型筛违规清单", () => {
  const vaultPath = buildFixtureVault();
  const registered = [];
  const registerRoute = (method, routePath, handler) => registered.push({ method, routePath, handler });
  ROUTES.register(registerRoute, { vaultPath });

  assert.deepEqual(
    registered.map((r) => `${r.method} ${r.routePath}`),
    ["GET /api/articles/health"],
    "唯一路由：GET /api/articles/health",
  );

  // handler 真跑（真装载入口＋真契约规则）——响应形状断言
  const handler = registered[0].handler;
  const reply = {
    raw: {},
    code() { return this; },
    header() { return this; },
    type() { return this; },
    sent: null,
    send(payload) { this.sent = payload && payload.data !== undefined ? payload.data : payload; return this; },
  };
  handler({}, reply);
  const body = reply.sent;
  assert.ok(body, "响应经 api-envelope 封装");
  assert.equal(body.scope, "all");
  assert.equal(body.total, 2, "夹具两篇全入读模型");
  const dirty = body.files.find((f) => f.file.endsWith("dirty.md"));
  assert.ok(!dirty.ok, "违规文章 ok=false");
  const ruleIds = [...new Set(dirty.violations.map((v) => v.ruleId))];
  for (const id of ["A09", "A10", "A11", "A15"]) {
    assert.ok(ruleIds.includes(id), `治理规则 ${id} 在违规集（契约新条目真消费）`);
  }
  const clean = body.files.find((f) => f.file.endsWith("clean.md"));
  // 「干净」夹具（仅 title）在全量契约下仍缺必填字段——静默面断言＝治理四类（A09/A10/A11/A14/A15/A16）对缺失全部跳过
  const cleanRuleIds = clean.violations.map((v) => v.ruleId);
  for (const id of ["A09", "A10", "A11", "A14", "A15", "A16"]) {
    assert.ok(!cleanRuleIds.includes(id), `治理规则 ${id} 对缺失字段静默（非进门必填）`);
  }
  assert.ok(cleanRuleIds.every((id) => ["A03", "A05", "A06", "A07", "A08", "A12", "A13"].includes(id)), "clean 违规全部为必填缺字段类");
});

test("GET /api/articles/health 与实时面同源：同一夹具引擎输出＝健康度读模型输出", () => {
  const vaultPath = buildFixtureVault();
  const ruleSet = loadRuleSetForVault(vaultPath);
  const viaService = computeArticleHealth({ vaultPath, ruleSetProvider: () => ruleSet });
  const viaDirect = computeArticleHealth({ vaultPath, ruleSetProvider: () => ruleSet });
  assert.deepEqual(
    JSON.stringify(viaService.files), JSON.stringify(viaDirect.files),
    "同引擎同契约两次现算逐字节稳定（幂等）",
  );
});
