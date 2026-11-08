// classify.py 写者收敛集成测试（SPEC-021 波 B）：
// 真脚本＋临时 vault——module-add 经统一写客户端落全协议（原子＋快照＋解析物联动），
// 直接写自实现（save_enums）已退役（grep 断言）。generate-sa.py 的 --sync-enums 走同款客户端调用（代码审查＋语法断言）。
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..", "..", "..");
// vault 侧 B/C 类脚本（classify.py / extract_graph.py 不进本仓）——路径沿 VAULT_PATH／.env 解析，缺省本机；
// 不在场（CI runner／无 vault）时相关用例显式 skip 并明示（theschema-loader.test「缺库时跳过」先例），
// 不再因写死本机绝对路径在 CI 必红（远端 quality 工作流 2026-10-20 起每跑三红的根因）。
function resolveVaultPath() {
  if (process.env.VAULT_PATH && fs.existsSync(process.env.VAULT_PATH)) return process.env.VAULT_PATH;
  try {
    const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
    const v = line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
    if (v && fs.existsSync(v)) return v;
  } catch (_e) { /* 无 .env */ }
  return "";
}
const VAULT_SCRIPTS = path.join(resolveVaultPath(), "知识库", ".claude", "scripts");
const VAULT_SCRIPTS_PRESENT = ["classify.py", "extract_graph.py"].every((n) => fs.existsSync(path.join(VAULT_SCRIPTS, n)));
const SKIP_NO_VAULT = VAULT_SCRIPTS_PRESENT ? false : "vault 侧 B/C 类脚本不在场（CI/无 vault）——跳过并明示，不算绿";
const FIXTURE_SCHEMA = path.join(ROOT, "test", "fixtures", "minimal-vault", "知识库", "TheSchema");

function buildEnv() {
  // 临时 vault＋临时脚本目录（classify 依赖同目录 kb_paths/客户端——真脚本原样拷贝，零改写）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classify-convergence-"));
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  for (const name of ["classify.py"]) fs.copyFileSync(path.join(VAULT_SCRIPTS, name), path.join(scripts, name));
  fs.copyFileSync(path.join(ROOT, "scripts", "vault-runtime", "kb_paths.py"), path.join(scripts, "kb_paths.py")); // kb_paths 事实源＝仓内（vault 侧系 symlink 跟随 main 旧版）
  // 客户端用 symlink（拷贝会破坏其对 server/ 服务的相对寻址；symlink 下 node 以真实路径运行）
  fs.symlinkSync(path.join(ROOT, "scripts", "vault-runtime", "schema-write-client.mjs"), path.join(scripts, "schema-write-client.mjs"));
  const schemaDir = path.join(root, "vault", "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of ["enums.yaml", "versions.yaml"]) fs.copyFileSync(path.join(FIXTURE_SCHEMA, name), path.join(schemaDir, name));
  fs.writeFileSync(
    path.join(schemaDir, "fields.yaml"),
    `schema_version: 1
fields:
  - name: module
    label: 模块
    type: list
    required: 是
    scope: [entity, article]
    layer: 业务属性
    value_domain: { source: modules, resolve: { op: keys } }
    description: 测试。
`,
    "utf8",
  );
  fs.mkdirSync(path.join(root, "vault", "知识库", "wiki", "entities"), { recursive: true });
  return { root, scripts, vault: path.join(root, "vault") };
}

function runPython(args, env) {
  // ADR-002 统一解释器：裸 python3 会被无 PyYAML 的沙箱解释器抢占（2026-10-21 CI node-tests 假红实证）
  return execFileSync(process.env.PYTHON_PATH || "python3", [path.join(env.scripts, "classify.py"), ...args], {
    env: { ...process.env, KB_VAULT: env.vault, THESCHEMA_DIR: path.join(env.vault, "知识库", "TheSchema") }, // SPEC-023 波 3：写通道钉扎领地
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("module-add 经统一写客户端：落盘＋快照＋解析物同步（全协议证据）", { skip: SKIP_NO_VAULT }, () => {
  const env = buildEnv();
  const out = runPython(["entity", "module-add", "新模块", "gw-01", "api"], env);
  assert.match(out, /经统一写客户端/);
  const enums = YAML.parse(fs.readFileSync(path.join(env.vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.deepEqual(enums.modules["新模块"], { subdomain: "api", system: "gw-01" });
  // SPEC-023 波 3：fs 快照仪式退役——git 即账
  const histDir = path.join(env.vault, "知识库", "TheSchema", "history");
  assert.ok(!fs.existsSync(histDir) || fs.readdirSync(histDir).length === 0, "不得再产生 fs 快照");
  const resolved = JSON.parse(fs.readFileSync(path.join(env.vault, "知识库", "TheSchema", "resolved-domains.json"), "utf8"));
  assert.ok(resolved.byField.find((x) => x.name === "module").values.includes("新模块"), "解析物联动同步");
  fs.rmSync(env.root, { recursive: true, force: true });
});

test("save_enums 直写自实现已退役（源码无实现体）", { skip: SKIP_NO_VAULT }, () => {
  const src = fs.readFileSync(path.join(VAULT_SCRIPTS, "classify.py"), "utf8");
  assert.match(src, /SPEC-021 波 B 退役〕save_enums/);
  assert.ok(!/def save_enums\(data\):/.test(src), "实现体必须不存在");
});

test("generate-sa.py --sync-enums 走统一写客户端（同款模式，代码审查面）", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "vault-runtime", "generate-sa.py"), "utf8");
  assert.match(src, /schema-write-client\.mjs/);
  assert.match(src, /enums-set-modules/);
  assert.match(src, /SPEC-021 波 B 退役〕snapshot_enums/);
  assert.match(src, /SPEC-021 波 B 退役〕atomic_write_yaml/);
  assert.ok(!/def snapshot_enums\(/.test(src) && !/def atomic_write_yaml\(/.test(src), "两自实现必须不存在");
});

test("extract_graph.py 自动注册裸写点已退役为顾问式", { skip: SKIP_NO_VAULT }, () => {
  const src = fs.readFileSync(path.join(VAULT_SCRIPTS, "extract_graph.py"), "utf8");
  // Master 加固批③：死代码已物理删除——断言升级为「函数体不存在＋指引注释在」
  assert.ok(!/def _flush_learnt_enums\(\):/.test(src), "裸写函数体必须物理不存在（复活面消除）");
  assert.match(src, /Master 加固批③：物理删除/);
  assert.match(src, /schema-write-client\.mjs modules-upsert/);
  assert.ok(!/yaml\.dump\(data, f, allow_unicode=True/.test(src), "裸 yaml.dump 写点必须不存在");
});
