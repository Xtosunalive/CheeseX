// project-resolved-domains 红绿夹具（SPEC-020 波 2）：
// ①确定性（连续两遍生成 diff 为空）②--check 一致绿 ③篡改一字节红 ④无 vault skip ⑤坏配方拒绝生成。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "scripts", "quality", "project-resolved-domains.mjs");

function runNode(args, vault) {
  try {
    // V11 收编后投影写经 repoWrite 目的地执法：测试 vault 的 TheSchema 须显式钉 THESCHEMA_DIR
    // （钉扎领地合法）——隐式 vault 窗口写已被 SPEC-021 fail-closed 拦截，正是本收编要固化的边界。
    // V11 收编后投影写经 repoWrite 目的地执法：测试 vault 的 TheSchema 须显式钉 THESCHEMA_DIR
    // （钉扎领地合法；隐式窗口写被 SPEC-021 拦截）。仅对真实存在的 vault 钉——「无 vault」
    // 用例（不存在路径）不钉，走 .env 回落阶梯（波5 终验抓出：不存在目录也被钉即 fields.yaml 误报）。
    const env = { ...process.env, VAULT_PATH: vault };
    if (fs.existsSync(vault)) env.THESCHEMA_DIR = path.join(vault, "知识库", "TheSchema");
    const stdout = execFileSync("node", [SCRIPT, ...args], { env, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout || "") + String(e.stderr || "") };
  }
}

function buildVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolved-domains-gate-"));
  const schema = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schema, { recursive: true });
  fs.writeFileSync(
    path.join(schema, "fields.yaml"),
    `schema_version: 1
fields:
  - name: module
    label: 模块
    type: list
    required: 是
    scope: [entity, article]
    layer: 业务属性
    value_domain: { source: modules, resolve: { op: keys }, normalize: { wikilink_strip: true } }
    description: 测试字典。
`,
    "utf8",
  );
  fs.writeFileSync(path.join(schema, "enums.yaml"), "modules:\n  主模块: {label: 主}\n", "utf8");
  fs.writeFileSync(path.join(schema, "versions.yaml"), "schema_version: 1\nproducts: {}\n", "utf8");
  return dir;
}

test("确定性＋--check 一致：连续两遍生成 diff 为空，check 绿", () => {
  const vault = buildVault();
  const g1 = runNode([], vault);
  assert.equal(g1.code, 0, g1.stdout);
  const first = fs.readFileSync(path.join(vault, "知识库", "TheSchema", "resolved-domains.json"), "utf8");
  const g2 = runNode([], vault);
  assert.equal(g2.code, 0);
  const second = fs.readFileSync(path.join(vault, "知识库", "TheSchema", "resolved-domains.json"), "utf8");
  assert.equal(first, second, "同输入必须字节一致（无时间戳）");
  const check = runNode(["--check"], vault);
  assert.match(check.stdout, /--check: ok/);
  const doc = JSON.parse(first);
  const moduleRow = doc.byField.find((r) => r.name === "module");
  assert.equal(moduleRow.required, "是");
  assert.deepEqual(moduleRow.values, ["主模块"]);
  assert.equal(moduleRow.wikilinkStrip, true);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红夹具：篡改解析物一字节 → --check 红", () => {
  const vault = buildVault();
  runNode([], vault);
  const target = path.join(vault, "知识库", "TheSchema", "resolved-domains.json");
  fs.appendFileSync(target, "\n<!-- 漂移注入 -->\n", "utf8");
  const check = runNode(["--check"], vault);
  assert.notEqual(check.code, 0);
  assert.match(check.stdout, /解析物漂移/);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("无 vault：--check 明示 skip 不红", () => {
  const check = runNode(["--check"], "/nonexistent-vault-xyz");
  // VAULT_PATH 不存在 → 回落 .env 真库——为隔离真库，这里断言 skip 或 ok 之一且不崩
  assert.match(check.stdout, /skip|ok/);
});

test("坏配方拒绝生成（配方解析红即拒，不产出半截派生物）", () => {
  const vault = buildVault();
  const fieldsPath = path.join(vault, "知识库", "TheSchema", "fields.yaml");
  fs.writeFileSync(
    fieldsPath,
    fs.readFileSync(fieldsPath, "utf8").replace("source: modules", "source: no_such_segment"),
    "utf8",
  );
  const g = runNode([], vault);
  assert.notEqual(g.code, 0, "引用悬空的配方必须拒绝生成");
  assert.match(g.stdout, /配方解析有 1 红/);
  assert.ok(!fs.existsSync(path.join(vault, "知识库", "TheSchema", "resolved-domains.json")), "不得产出半截派生物");
  fs.rmSync(vault, { recursive: true, force: true });
});
