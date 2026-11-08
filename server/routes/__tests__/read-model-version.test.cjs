'use strict';
// WP-055 W-B（SPEC-049 Q2/Q4）：版本查询一等出口＋rebuild 翻新接线＋dashboard status 追加。
// 层级：Adapter 契约（route harness；真实装载面经 .env）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fsx = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { register } = require('../../routes/read-model-routes.cjs');
const { createRouteHarness } = require('./helpers/route-harness.cjs');

test('Q2 GET /api/read-model/version：200 信封携带 readModelVersion（version/components/computedAt）', async () => {
  const vault = fsx.mkdtempSync(path.join(os.tmpdir(), 'rm-route-'));
  const ts = path.join(vault, '知识库', 'TheSchema');
  fsx.mkdirSync(ts, { recursive: true });
  fsx.writeFileSync(path.join(ts, 'enums.yaml'), 'domains: {}\n');
  const h = createRouteHarness();
  register(h.registerRoute, { vaultPath: vault, dataDir: path.join(vault, 'data') });
  const { statusCode, body } = await h.call('GET /api/read-model/version');
  assert.equal(statusCode, 200, JSON.stringify(body));
  assert.ok(body.data.readModelVersion, 'readModelVersion 在场（信封 data 面）');
  assert.match(body.data.readModelVersion.version, /^rm1:/);
  assert.ok(body.data.readModelVersion.components, '组件面在场');
  fsx.rmSync(vault, { recursive: true, force: true });
});

test('Q2 rebuild 翻新：执行器报告携带 readModelVersion＝重建后现场计算（同源函数）', () => {
  // data-roles-routes 执行器为 async 工厂内函数——行为断言走源码同源检查＋GET 面同函数验证
  const src = fsx.readFileSync(path.join(ROOT, 'server/routes/data-roles-routes.cjs'), 'utf8');
  assert.match(src, /readModelVersion: deps\.vaultPath\s*\?\s*require\("\.\.\/shared\/read-model-port\.cjs"\)\.getReadModelVersion/,
    'rebuild 报告携带同一 port 版本（同源＝Q2）');
  const mainSrc = fsx.readFileSync(path.join(ROOT, 'server/main.cjs'), 'utf8');
  assert.match(mainSrc, /data-roles-routes\.cjs"\)\.register\(registerRoute, \{ repoRoot[^\n]*vaultPath \}\)/,
    'rebuild 路由装配注入 vaultPath（版本计算可达）');
});

test('Q4 dashboard status 追加 readModelVersion：追加非破坏（getStatus 字段保留）', () => {
  const src = fsx.readFileSync(path.join(ROOT, 'server/routes/pipeline-routes.cjs'), 'utf8');
  assert.match(src, /\.\.\.service\.getStatus\(\), readModelVersion/, '展开追加——既有字段全保留');
  const mainSrc = fsx.readFileSync(path.join(ROOT, 'server/main.cjs'), 'utf8');
  assert.match(mainSrc, /getReadModelVersion: \(\) => require\("\.\/shared\/read-model-port\.cjs"\)\.getReadModelVersion/, '版本取数注入（main 装配面）');
});

test('Q4 OpenAPI 出生即账：新端点在契约', () => {
  const openapi = JSON.parse(fsx.readFileSync(path.join(ROOT, 'contracts/http-api.openapi.json'), 'utf8'));
  assert.ok(openapi.paths['/api/read-model/version'], 'GET /api/read-model/version 在册');
});
