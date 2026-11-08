// ⚠ PR-099 教训：反例用例的子进程输出会回显到链日志（TAP # 注释）——其中的 FAIL 行与
// 相对路径（如 data/theschema/entity-frontmatter-schema.md）属**临时夹具仓**（mkdtemp 镜像同名
// 路径），非真实门禁结论；真实门禁结论以 CI「Registered CI gates」段的 gate 输出为准。勿据回显立案。
// check-derivation-sync 红绿夹具（quality-gates 第 32 号 / SPEC-019 修订批）：
// 正例（临时 vault 投影与 fields.yaml 一致 → 绿）＋反例（篡改投影一字节 → 红）
// ＋选择函数直证（只有 derived 且 generator≠null 的行被选中——注册表派生的清单语义）。
// 走真实链路：真注册表 → 真 npm 别名 → 真生成器 --check，不用替身。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { selectDerivations, selectRepoDerivations } from "../check-derivation-sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "scripts", "quality", "check-derivation-sync.mjs");
const GENERATOR = path.join(ROOT, "scripts", "quality", "project-frontmatter-schema.mjs");
const GENERATOR_RESOLVED = path.join(ROOT, "scripts", "quality", "project-resolved-domains.mjs");
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "theschema-roles.json"), "utf8"));

function runNode(script, vault) {
  try {
    const stdout = execFileSync("node", [script], { env: { ...process.env, VAULT_PATH: vault, THESCHEMA_DIR: path.join(vault, "知识库", "TheSchema") }, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout || "") + String(e.stderr || "") };
  }
}

function buildVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "derivation-gate-"));
  fs.mkdirSync(path.join(dir, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "知识库", "TheSchema", "fields.yaml"),
    `schema_version: 1
fields:
  - name: module
    label: 模块
    type: list
    required: 是
    scope: [entity, article]
    layer: 业务属性
    description: 测试字典。
`,
    "utf8",
  );
  return dir;
}

test("选择函数：只挑 role=derived 且 generator≠null 的行", () => {
  const picked = selectDerivations({
    entries: [
      { file: "a.md", role: "derived", generator: "project:x" },
      { file: "b.md", role: "derived", generator: null }, // 管线产物无仓内生成器——不入本面
      { file: "c.yaml", role: "source", generator: "project:x" }, // source 不入
      { role: "derived" }, // 缺 file/generator——不炸不选
    ],
  });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].file, "a.md");
});

test("真注册表至少含一条可查派生（entity-frontmatter-schema）", () => {
  const picked = selectDerivations(REGISTRY);
  assert.ok(picked.length >= 1, "注册表应至少有一条 generator≠null 的派生行");
  assert.ok(picked.some((d) => d.file.includes("entity-frontmatter-schema.md")));
});

test("绿夹具：投影由生成器产出后一致 → exit 0", () => {
  const vault = buildVault();
  const gen = runNode(GENERATOR, vault); // 先生成（不带 --check）
  runNode(GENERATOR_RESOLVED, vault); // 解析物同生（注册表第 2 条派生行）
  assert.equal(gen.code, 0, `生成失败：${gen.stdout}`);
  const gate = runNode(SCRIPT, vault);
  assert.match(gate.stdout, /derivation-sync=ok derivations=\d+/);
  // PR-237（2026-11-04）：component-index 派生行已随外部源仓断联整件退役——注册表不再含该行，
  // vault 在场时其他派生行（投影）必须真跑不 skip
  assert.match(gate.stdout, /project-frontmatter-schema --check:/, "vault 在场投影派生必须真跑");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红夹具：篡改投影一字节 → exit 1 并点名文件", () => {
  const vault = buildVault();
  runNode(GENERATOR, vault);
  runNode(GENERATOR_RESOLVED, vault);
  const target = path.join(vault, "知识库", "TheSchema", "entity-frontmatter-schema.md");
  fs.appendFileSync(target, "\n<!-- 漂移注入 -->\n", "utf8");
  const gate = runNode(SCRIPT, vault);
  assert.notEqual(gate.code, 0, "投影漂移必须红");
  assert.match(gate.stdout, /derivation-sync: FAIL/);
  fs.rmSync(vault, { recursive: true, force: true });
});

// ── WP-133 扩第二登记源：reuse-domains 域行（仓内侧，不依赖 vault）──

test("真复用域表至少含一条仓内侧生成行（state-layering→gen:value-domains）", () => {
  const REUSE = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "reuse-domains.json"), "utf8"));
  const picked = selectRepoDerivations(REUSE);
  assert.ok(picked.length >= 1, "复用域表应至少有一条 generator≠null 生成行");
  assert.ok(picked.some((d) => d.generator === "gen:value-domains"), "state-layering 生成行应在册");
});

test("仓内侧选择函数直证：generator=null/缺失行不入清单", () => {
  const fake = { domains: [{ id: "a", generator: null }, { id: "b" }, { id: "c", generator: "gen:x" }] };
  assert.deepEqual(selectRepoDerivations(fake).map((d) => d.id), ["c"]);
});
