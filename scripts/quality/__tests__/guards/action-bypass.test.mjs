// 写路由×工厂旁路哨兵——红绿双向（WP-171 / SPEC-095 §3.3）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 探测逻辑内嵌（WP-143 门禁冻结纪律：不新增顶层 check-*.mjs——哨兵即普通测试）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ROUTES_DIR = path.join(ROOT, "server", "routes");
// 豁免单源（route → 理由）——只减不增；新增须随批记录为何不经工厂
const ALLOWED = new Map(Object.entries({
  "POST /api/schema/dependencies/validate": "依赖校验预览——纯计算无持久化（读侧）",
  "POST /api/entity/repair/preview": "实体修复预览——纯计算无持久化（读侧）",
  "POST /api/schema/enums/preview": "枚举写入预览——纯计算无持久化（读侧）",
  "POST /api/documents/index/rebuild": "派生索引维护通道（非文章域写）——后续动作化候选，WP-171 不扩域",
  "POST /api/kg/rebuild-index": "派生索引维护通道（非文章域写）——同上",
  "POST /api/kg/impact-analysis": "影响分析——纯计算无持久化（读侧）",
  // 以下五条＝红队F-1修正窗后首扫显形（旧窗被邻路由遮蔽）：三条预览/校验＝纯计算读侧；
  // 两条 PUT approval＝退役墓碑（legacyApprovalGone 410，retired-routes 在册）非写
  "POST /api/article-associations/preview": "关联预览——纯计算无持久化（读侧）",
  "POST /api/schema/dependencies/preview": "依赖写入预览——纯计算无持久化（读侧）",
  "POST /api/schema/versions/validate": "版本登记校验——纯计算无持久化（读侧）",
  "PUT /api/articles/precleaned/:id/approval": "退役墓碑（legacy 410）——非写",
  "PUT /api/articles/precleaned/approval": "退役墓碑（legacy 批量 410）——非写",
}));

function scanRoutes(dir = ROUTES_DIR) {
  const violations = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".cjs")) continue;
    const file = path.join(dir, entry.name);
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const re = /registerRoute\("(POST|PUT|PATCH|DELETE)",\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const key = `${m[1]} ${m[2]}`;
      if (ALLOWED.has(key)) continue;
      // 红队F-1修正：窗口右界＝下一 registerRoute( 或文件尾——原 700 字符头窗可吞同文件
      // 邻路由的 executeAction（实测 validate 自身回退旁路仍假绿，假绿面 14/49 写路由）
      const nextRoute = src.indexOf("registerRoute(", m.index + 1);
      const handler = src.slice(m.index, nextRoute === -1 ? src.length : nextRoute);
      if (!/executeAction\(/.test(handler)) {
        violations.push(`${rel}: ${key} 写路由未经 executeAction（旁路直调或缺失）——收编或登记豁免`);
      }
    }
  }
  return violations;
}

test("绿：仓内现状零旁路（validate 收编后写路由全经工厂或在册豁免）", () => {
  assert.deepEqual(scanRoutes(), []);
});

test("红：旁路写路由即被检出（判据有判力——tmp 树探针）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "action-bypass-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "probe-routes.cjs"),
      'registerRoute("POST", "/api/probe/bypass", function (req, res) { return service.directWrite(req.body); });\n');
    const violations = scanRoutes(dir);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /POST \/api\/probe\/bypass/);
    fs.writeFileSync(path.join(dir, "probe-routes.cjs"),
      'registerRoute("POST", "/api/probe/via-factory", function (req, res) { return executeAction({ actionId: "probe.x", executor, request: req, reply: res }); });\n');
    assert.deepEqual(scanRoutes(dir), [], "经工厂形态零报");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("红队F-1回归钉：邻路由 executeAction 不得遮蔽本路由旁路（真实布局交叉形态）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "action-bypass-adjacent-"));
  try {
    // 同文件双路由紧邻：前者旁路、后者经工厂——旧 700 头窗下前者假绿（红队探针实证 14/49 面之一）
    fs.writeFileSync(path.join(dir, "adjacent-routes.cjs"), [
      'registerRoute("POST", "/api/probe/first-bypass", function (req, res) { return service.directWrite(req.body); });',
      'registerRoute("POST", "/api/probe/second-factory", function (req, res) { return executeAction({ actionId: "probe.second", executor, request: req, reply: res }); });',
      '',
    ].join("\n"));
    const violations = scanRoutes(dir);
    assert.equal(violations.length, 1, `旁路由工厂不得遮蔽旁路（实得 ${violations.length}）`);
    assert.match(violations[0], /first-bypass/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("豁免单源棘轮：在册豁免条目对应路由仍存在于仓内（悬空豁免即红——防豁免永久化）", () => {
  const routeFiles = fs.readdirSync(path.join(process.cwd(), "server", "routes")).filter((f) => f.endsWith(".cjs"));
  const corpus = routeFiles.map((f) => fs.readFileSync(path.join(process.cwd(), "server", "routes", f), "utf8")).join("\n");
  const allowed = [...corpus.matchAll(/registerRoute\("([A-Z]+)",\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  for (const key of ALLOWED.keys()) { // 单源：棘轮键自 ALLOWED 派生（红队记档1——消灭双清单手抄）
    assert.ok(allowed.includes(key), `豁免悬空：${key} 已不在路由面（应摘除豁免）`);
  }
});
