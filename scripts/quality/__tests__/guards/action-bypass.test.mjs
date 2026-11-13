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
      const window = src.slice(m.index, m.index + 700); // handler 头窗（注册到体首）
      if (!/executeAction\(/.test(window)) {
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

test("豁免单源棘轮：在册豁免条目对应路由仍存在于仓内（悬空豁免即红——防豁免永久化）", () => {
  const routeFiles = fs.readdirSync(path.join(process.cwd(), "server", "routes")).filter((f) => f.endsWith(".cjs"));
  const corpus = routeFiles.map((f) => fs.readFileSync(path.join(process.cwd(), "server", "routes", f), "utf8")).join("\n");
  const allowed = [...corpus.matchAll(/registerRoute\("([A-Z]+)",\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  for (const key of ["POST /api/schema/dependencies/validate", "POST /api/entity/repair/preview", "POST /api/schema/enums/preview", "POST /api/documents/index/rebuild", "POST /api/kg/rebuild-index", "POST /api/kg/impact-analysis"]) {
    assert.ok(allowed.includes(key), `豁免悬空：${key} 已不在路由面（应摘除豁免）`);
  }
});
