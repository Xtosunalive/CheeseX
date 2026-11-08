// e2e 作用域守卫测试（复用域 runtime-scope 波1／PR-120，2026-10-26）
// 验证对象：scripts/e2e/lib/e2e-env.mjs 的 buildE2EEnv（起链构造器）与 requireE2EServiceScope
// （服务端作用域证明）。层级：纯单元（http stub 起在本机临时端口，不触真实服务/真库）。
// 反例内建：信封缺 vaultId／vaultId 不等／服务不可达三态必须拒（fail-closed），防守卫空转。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { buildE2EEnv, requireE2EServiceScope, E2E_SCOPE_PINS } from "../../../scripts/e2e/lib/e2e-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");

function makeFixture() {
  // 最小 fixture：只需守卫消费的字段（知识库/TheSchema/enums.yaml 与 vault 根）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-scope-fixture-"));
  fs.mkdirSync(path.join(dir, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库", "TheSchema", "enums.yaml"), "lifecycle: {}\n", "utf8");
  return dir;
}

test("buildE2EEnv 钉 contracts/runtime-scope 声明的写面全集，且各落临时目录/fixture", async () => {
  const fixture = makeFixture();
  const env = buildE2EEnv(fixture, {});
  for (const key of E2E_SCOPE_PINS) assert.ok(env[key], `${key} 未钉`);
  assert.equal(env.VAULT_PATH, fixture);
  assert.equal(env.KB_VAULT, fixture);
  assert.equal(env.THESCHEMA_DIR, path.join(fixture, "知识库", "TheSchema")); // 显式钉死，不走三级阶梯
  for (const key of ["KB_DATA_DIR", "PIPELINE_TRAJECTORIES_DIR", "DECISIONS_MIRROR_DIR"]) {
    assert.match(env[key], /e2e-/, `${key} 应落 e2e- 前缀临时目录`);
    assert.ok(fs.existsSync(env[key]), `${key} 目录未创建`);
  }
  assert.ok(env.TAXONOMY_OBSERVATIONS_FILE.endsWith("taxonomy-observations.jsonl"));
  // 显式给出不覆盖（与 buildRunnerEnv 同约定）
  const preset = buildE2EEnv(fixture, { KB_DATA_DIR: "/tmp/keep-me" });
  assert.equal(preset.KB_DATA_DIR, "/tmp/keep-me");
  // fixture 缺 TheSchema 即 fail-closed，不隐式回落
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-scope-bare-"));
  assert.throws(() => buildE2EEnv(bare, {}), /TheSchema/);
  // 与域契约对账：E2E_SCOPE_PINS ⊇ 契约 e2e-harness 起链应钉的 write_sensitive 变量
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "runtime-scope.json"), "utf8"));
  const declared = contract.launch_chains.find((c) => c.id === "e2e-harness");
  for (const v of declared.pins) assert.ok(E2E_SCOPE_PINS.includes(v), `契约钉 ${v} 但构造器缺`);
});

function stubServer(payload) {
  return new Promise((resolve) => {
    const srv = http.createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(payload)); });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("requireE2EServiceScope 三态：等→过；不等/缺字段/不可达→fail-closed 拒", async () => {
  const fixture = makeFixture();
  const { computeVaultId } = await import(path.join(ROOT, "server", "shared", "vault-id.cjs"));
  const expected = computeVaultId(fixture);

  const ok = await stubServer({ success: true, data: { vaultId: expected, readyState: "ready" } });
  const got = await requireE2EServiceScope(ok.base, fixture);
  assert.equal(got.vaultId, expected);
  ok.srv.close();

  const bad = await stubServer({ success: true, data: { vaultId: "de4843dafe9ca6d5", readyState: "ready" } });
  await assert.rejects(() => requireE2EServiceScope(bad.base, fixture), /E2E_GUARD: service scope mismatch/);
  bad.srv.close();

  const noField = await stubServer({ success: true, data: { readyState: "ready" } });
  await assert.rejects(() => requireE2EServiceScope(noField.base, fixture), /vaultId missing/);
  noField.srv.close();

  await assert.rejects(() => requireE2EServiceScope("http://127.0.0.1:1", fixture, { timeoutMs: 300 }), /unreachable|fetch failed|E2E_GUARD/);
});

test("requireE2EServiceScope 与主树常驻 dev 服务对账即拒（先红口径，条件性）", { skip: process.env.RESIDENT_E2E_BASE ? false : "无 RESIDENT_E2E_BASE 时跳过（需常驻服务在线）" }, async () => {
  const fixture = makeFixture();
  await assert.rejects(() => requireE2EServiceScope(process.env.RESIDENT_E2E_BASE, fixture), /E2E_GUARD: service scope mismatch/);
});
