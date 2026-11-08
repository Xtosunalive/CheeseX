// 层级：纯单元＋exec 真实拉起（interpreter=node 探针，零外部依赖）。
// 被测对象：WP-069 §3.1 唯一拉起点——env 全集组装契约（回落/透传/身份变量禁携）＋exec 组装面。
// buildSpawnEnv（PR-134）单测退役后由此承接（见 pipeline-due-service.test.cjs 头注）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildVaultRuntimeEnv, execVaultRuntimeScript, IDENTITY_SCOPE_ENV } = require("../vault-runtime-spawn.cjs");

function tempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vr-spawn-"));
}

test("buildVaultRuntimeEnv：身份变量语义注入＋KB_DATA_DIR 缺省回落仓内 data/", () => {
  const vault = tempVault();
  const saved = process.env.KB_DATA_DIR;
  delete process.env.KB_DATA_DIR;
  try {
    const env = buildVaultRuntimeEnv({ vaultPath: vault });
    assert.equal(env.KB_VAULT, path.resolve(vault), "vaultPath 语义锚 → KB_VAULT");
    assert.ok(env.ARCH_REPO, "ARCH_REPO 缺省仓根");
    assert.equal(env.KB_DATA_DIR, path.join(env.ARCH_REPO, "data"), "缺省回落仓内 data/（SPEC-012 WP-A）");
  } finally {
    if (saved === undefined) delete process.env.KB_DATA_DIR; else process.env.KB_DATA_DIR = saved;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("buildVaultRuntimeEnv：显式 KB_DATA_DIR（extraEnv）不被回落覆盖——测试隔离/部署覆盖位", () => {
  const vault = tempVault();
  try {
    const env = buildVaultRuntimeEnv({ vaultPath: vault, extraEnv: { KB_DATA_DIR: "/custom/data" } });
    assert.equal(env.KB_DATA_DIR, "/custom/data", "显式值优先于回落");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("buildVaultRuntimeEnv：vaultPath 缺失拒绝静默作用域（装配缺陷大声失败）", () => {
  assert.throws(() => buildVaultRuntimeEnv({}), (e) => e instanceof TypeError && /VAULT_RUNTIME_SPAWN_UNRESOLVED/.test(e.message));
});

test("buildVaultRuntimeEnv：extraEnv 携带身份作用域变量即 TypeError（后门自拼禁令）", () => {
  const vault = tempVault();
  try {
    for (const key of IDENTITY_SCOPE_ENV) {
      assert.throws(
        () => buildVaultRuntimeEnv({ vaultPath: vault, extraEnv: { [key]: "/x" } }),
        (e) => e instanceof TypeError && /VAULT_RUNTIME_SCOPE_OWNED/.test(e.message) && e.message.includes(key),
        `${key} 必须经语义选项进入`,
      );
    }
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("buildVaultRuntimeEnv：父环境陈旧 VOCAB_ENVELOPE_PATH 不得继承（红队 2026-11-02 必修①）", () => {
  const vault = tempVault();
  const saved = process.env.VOCAB_ENVELOPE_PATH;
  process.env.VOCAB_ENVELOPE_PATH = "/parent-stale-envelope.json";
  try {
    const off = buildVaultRuntimeEnv({ vaultPath: vault, vocabEnvelope: false });
    assert.equal(off.VOCAB_ENVELOPE_PATH, undefined, "vocabEnvelope=false 时父环境陈旧值必须剥离（信封是本次装载产出，继承即陈旧面）");
    const on = buildVaultRuntimeEnv({ vaultPath: vault, vocabEnvelope: true });
    assert.notEqual(on.VOCAB_ENVELOPE_PATH, "/parent-stale-envelope.json", "vocabEnvelope=true 时必须是本次物化路径");
    assert.ok(on.VOCAB_ENVELOPE_PATH.startsWith(path.resolve(vault)));
  } finally {
    if (saved === undefined) delete process.env.VOCAB_ENVELOPE_PATH; else process.env.VOCAB_ENVELOPE_PATH = saved;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("buildVaultRuntimeEnv：vocabEnvelope=true 物化词表信封并注入路径（缺件库也产出缺件态信封）", () => {
  const vault = tempVault();
  try {
    const env = buildVaultRuntimeEnv({ vaultPath: vault, vocabEnvelope: true });
    assert.ok(env.VOCAB_ENVELOPE_PATH, "信封路径已注入");
    assert.ok(fs.existsSync(env.VOCAB_ENVELOPE_PATH), "信封文件已物化");
    assert.ok(env.VOCAB_ENVELOPE_PATH.startsWith(path.resolve(vault)), "信封落在该库运行时槽");
    const body = JSON.parse(fs.readFileSync(env.VOCAB_ENVELOPE_PATH, "utf8"));
    assert.ok(body.files, "信封携带词表载荷结构");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("execVaultRuntimeScript：family=vault-py-graph 真实拉起（REPO_ROOT 层级回归钉——2026-11-02 E2E 咬出三级误写）", async () => {
  const vault = "/tmp/boot-test-wp069";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vr-py-graph-"));
  try {
    if (!fs.existsSync(vault)) return; // 夹具缺失（CI 无该 tmp 库）则跳过真实库断言——REPO_ROOT 断言无条件执行
    const result = await execVaultRuntimeScript("pipeline_due.py", ["--check"], {
      vaultPath: vault, family: "vault-py-graph", extraEnv: { KB_DATA_DIR: dataDir },
    });
    assert.equal(result.status, 0, `vault-py 族脚本必须经仓根解析可执行（stderr=${result.stderr.slice(150)}）`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
  // 无条件断言：family 解析落在真实仓根（不存在脚本→python 报错文本里必须是仓内路径）
  const missing = await execVaultRuntimeScript("__no_such_script__.py", [], { vaultPath: vault, family: "vault-py-graph" });
  assert.ok(missing.status !== 0, "不存在脚本必须非零退出");
  assert.ok(!missing.stderr.includes("/xqy/cheeseh-v1/scripts"), "vault-py 族路径不得指到仓外（REPO_ROOT 层级）");
  assert.ok(missing.stderr.includes("vault-py/graph/__no_such_script__.py"), `脚本路径须在仓内 vault-py/graph 下（实际：${missing.stderr.slice(160)}）`);
});

test("execVaultRuntimeScript：真实 exec（interpreter=node 探针）——调用点零自拼 env 仍拿到全集", async () => {
  const vault = tempVault();
  const scripts = fs.mkdtempSync(path.join(os.tmpdir(), "vr-spawn-scripts-"));
  fs.writeFileSync(path.join(scripts, "env-probe.cjs"),
    "process.stdout.write(JSON.stringify({ kb: process.env.KB_VAULT, data: process.env.KB_DATA_DIR }));\n");
  const saved = process.env.VAULT_RUNTIME_SCRIPTS_DIR;
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scripts;
  try {
    const result = await execVaultRuntimeScript("env-probe.cjs", [], { vaultPath: vault, interpreter: "node", vocabEnvelope: false });
    assert.equal(result.status, 0, `探针退出码 0（stderr=${result.stderr.slice(100)}）`);
    const seen = JSON.parse(result.stdout);
    assert.equal(seen.kb, path.resolve(vault), "子进程拿到 KB_VAULT");
    assert.ok(seen.data, "子进程拿到 KB_DATA_DIR");
  } finally {
    if (saved === undefined) delete process.env.VAULT_RUNTIME_SCRIPTS_DIR; else process.env.VAULT_RUNTIME_SCRIPTS_DIR = saved;
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(scripts, { recursive: true, force: true });
  }
});
