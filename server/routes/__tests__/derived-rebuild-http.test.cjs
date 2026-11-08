// Layer: HTTP integration（真实Fastify与npm生成器）· PR-261：派生重建的正常、污染、重复及失败路径。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRouteHarness, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const { initRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
const { openPersistenceDb } = require("../../shared/persistence/sqlite-adapter.cjs");
const mod = require("../data-roles-routes.cjs");
const REPO = path.resolve(__dirname, "..", "..", "..");
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr261-rebuild-"));
  const repo = path.join(root, "repo");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(repo);
  // 复制真实生成器及依赖，保留相对模块/数据路径；不复制.env，不用替身生成器。
  for (const rel of ["server", "scripts", "contracts", "data/theschema", "package.json"]) {
    fs.cpSync(path.join(REPO, rel), path.join(repo, rel), {
      recursive: true, filter: (source) => !source.split(path.sep).includes("__tests__"),
    });
  }
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(repo, "node_modules"), "dir");
  const envKeys = ["VAULT_PATH", "THESCHEMA_DIR", "THESCHEMA_REPO_FALLBACK_DIR"];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  // 明确钉住生成目录＝路由计算哈希的目录，父环境无法把输出导向另一个知识库。
  process.env.THESCHEMA_DIR = path.join(repo, "data/theschema");
  delete process.env.THESCHEMA_REPO_FALLBACK_DIR;
  process.env.VAULT_PATH = vault;
  setupActionRuntime({ vaultPath: vault });
  const db = openPersistenceDb({ path: ":memory:" });
  initRuntimeStateStore(db);
  const h = createRouteHarness();
  mod.register(h.registerRoute, { repoRoot: repo });
  t.after(async () => {
    await h.close();
    teardownActionRuntime();
    db.close();
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { repo, vault, call: () => h.request("POST /api/schema/derived/rebuild") };
}

function success(response) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true, JSON.stringify(response.body));
  return response.body.data;
}

for (const round of [1, 2]) {
  test(`PR-261真实重建第${round}轮：生成、污染修复、重复均隔离`, { timeout: 120_000 }, async (t) => {
    const { repo, vault, call } = createFixture(t);
    const entries = require(path.join(repo, "contracts/theschema-roles.json")).entries
      .filter((entry) => entry.role === "derived" && entry.generator);
    const originalHashes = new Map(entries.map((entry) => [entry.file, hash(path.join(REPO, entry.file))]));
    const ready = success(await call());
    assert.equal(ready.total, entries.length, "清单以真实登记表为准");
    assert.ok(ready.artifacts.every((entry) => entry.ok));
    const stable = success(await call());
    assert.ok(stable.artifacts.every((entry) => entry.changed === false));
    const rel = "data/theschema/resolved-domains.json";
    const target = path.join(repo, rel);
    const original = fs.readFileSync(target);
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from("\n// 污染探针")]));
    const repaired = success(await call());
    const result = repaired.artifacts.find((entry) => entry.artifact === rel);
    assert.equal(result.changed, true);
    assert.deepEqual(fs.readFileSync(target), original, "真实生成器修复同一个路由目标");
    assert.equal(result.hash, "sha256:" + hash(target));
    const repeat = success(await call());
    assert.ok(repeat.artifacts.every((entry) => entry.ok && entry.changed === false));
    for (const [file, before] of originalHashes) {
      assert.equal(hash(path.join(REPO, file)), before, "真实仓库派生文件不能被改写");
    }
    assert.equal(fs.existsSync(path.join(vault, "知识库/TheSchema")), false, "临时vault只承接审计，生成不跨目录");
  });
}

// 缺配置应明确报错，不能把环境缺失改成成功；此处复用真实npm子进程。
test("PR-261缺少VAULT_PATH：500错误详情可见且派生物不变", { timeout: 60_000 }, async (t) => {
  const { repo, call } = createFixture(t);
  // WP-128 红线复核②：免 vault 派生行改由夹具注入——真注册表不越界登记 server/shared 行
  //（data-roles 三红清零：辖区=data/theschema/）。本测试的混合注册表语义不变：缺 VAULT_PATH
  // 只打依赖 vault 的生成器，免 vault 行照常成功；夹具内登记同一行为，意图与断言全保留。
  const rolesPath = path.join(repo, "contracts/theschema-roles.json");
  const roles = JSON.parse(fs.readFileSync(rolesPath, "utf8"));
  roles.entries.push({ file: "server/shared/error-registry.generated.cjs", role: "derived", writer: "system", derives_from: "server/**/*.cjs 抛点（error-throw-scan.mjs 收集器）", generator: "gen:error-registry", segments: [], referenced_by: ["error-codes"] });
  fs.writeFileSync(rolesPath, JSON.stringify(roles, null, 2) + "\n");
  delete process.env.VAULT_PATH;
  const target = path.join(repo, "data/theschema/resolved-domains.json");
  const before = hash(target);
  const response = await call();
  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error_code, "DERIVATION_REBUILD_FAILED");
  // WP-122 起 theschema-roles 含免 vault 派生行（server/shared/error-registry.generated.cjs，
  // 真身=仓内抛点扫描，不读 vault）：缺 VAULT_PATH 只打依赖 vault 的生成器，免 vault 行照常
  // 成功——500 语义（failed>0 即失败）不因混合注册表漂移，逐条失败仍点名 VAULT_PATH 缺失。
  const arts = response.body.details.artifacts;
  const failedArts = arts.filter((entry) => !entry.ok);
  assert.ok(failedArts.length >= 1, `缺 VAULT_PATH 至少依赖 vault 的生成器失败，实得 ${JSON.stringify(arts)}`);
  assert.equal(response.body.details.failed, failedArts.length);
  assert.ok(failedArts.every((entry) => /VAULT_PATH/.test(entry.error)));
  const free = arts.find((entry) => entry.artifact === "server/shared/error-registry.generated.cjs");
  assert.ok(free, "免 vault 派生行在册（WP-122 登记）");
  assert.equal(free.ok, true, "免 vault 生成器不受缺失环境影响");
  assert.equal(hash(target), before);
});

// ── PR-169 回归（F1 契约信封化＋F2 生成器失败判定） ──
test("PR-169/F1：200 信封与 500 错误信封均过响应契约探针（enforce 不再拦成 500）", () => {
  const { createContractResponseProbe } = require("../../shared/api-schema-validator.cjs");
  const probe = createContractResponseProbe();
  const ok = probe("/api/schema/derived/rebuild", "POST", 200, {
    success: true,
    trace_id: "tr_probe_200_ok",
    data: { rebuiltAt: new Date().toISOString(), total: 2, failed: 0, durationMs: 5, artifacts: [
      { artifact: "contracts/theschema-roles.json", generator: "gen:a", ok: true, changed: false, hash: "sha256:" + "a".repeat(64) },
    ] },
  });
  assert.notEqual(ok && ok.action, "block", "200 信封不得被拦：" + JSON.stringify(ok && ok.violations));
  const fail = probe("/api/schema/derived/rebuild", "POST", 500, {
    success: false, error: "x", error_code: "DERIVATION_REBUILD_FAILED", message: "a: boom", trace_id: "tr_probe_500",
    details: { rebuiltAt: new Date().toISOString(), total: 1, failed: 1, artifacts: [
      { artifact: "a", generator: "g", ok: false, changed: null, error: "boom" },
    ] },
  });
  assert.notEqual(fail && fail.action, "block", "500 错误信封不得被拦：" + JSON.stringify(fail && fail.violations));
});

test("PR-169/F2：生成器非零退出→500及完整失败报告", { timeout: 60_000 }, async (t) => {
  const { repo, call } = createFixture(t);
  fs.writeFileSync(path.join(repo, "contracts/theschema-roles.json"), JSON.stringify({
    schema_version: 1,
    entries: [{ role: "derived", file: "contracts/fake.json", generator: "wp048:nonexistent-generator" }],
  }));
  const response = await call();
  assert.equal(response.status, 500);
  assert.equal(response.body.error_code, "DERIVATION_REBUILD_FAILED");
  assert.equal(response.body.details.failed, 1);
  assert.equal(response.body.details.artifacts[0].ok, false);
  assert.equal(response.body.details.artifacts[0].changed, null);
  assert.match(response.body.message, /fake.json/);
});
