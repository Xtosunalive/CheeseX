// check-fields-registry 红绿夹具（ADR-008 D2 / SPEC-015 追踪矩阵 #9）：
// ⚠ PR-099 教训：反例用例的子进程输出会回显到链日志（TAP # 注释）——其中的 FAIL 行与
// 相对路径（如 data/theschema/entity-frontmatter-schema.md）属**临时夹具仓**（mkdtemp 镜像同名
// 路径），非真实门禁结论；真实门禁结论以 CI「Registered CI gates」段的 gate 输出为准。勿据回显立案。
// 反例（未登记字段被消费 → 红）＋正例（全在册 → 绿）＋ advisory 语义（无锚点触碰只提示不拦截）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "scripts", "quality", "check-fields-registry.mjs");

function runGate({ vault }) {
  try {
    const stdout = execFileSync("node", [SCRIPT], { env: { ...process.env, VAULT_PATH: vault, THESCHEMA_DIR: path.join(vault, "知识库", "TheSchema") }, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout || "") + String(e.stderr || "") };
  }
}

function resolveVaultPath() {
  if (process.env.VAULT_PATH && fs.existsSync(process.env.VAULT_PATH)) return process.env.VAULT_PATH;
  try {
    const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
    const v = line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
    if (v && fs.existsSync(v)) return v;
  } catch (_e) { /* 无 .env */ }
  return "";
}

function buildVault({ fields }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fields-gate-"));
  fs.mkdirSync(path.join(dir, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库", "TheSchema", "fields.yaml"), fields, "utf8");
  fs.writeFileSync(path.join(ROOT, ".env.fields-gate-probe"), "", "utf8"); // 不落真 .env——env 变量直传
  return dir;
}

const BASE_FIELDS = `schema_version: 1
fields:
  - name: module
    label: 模块
    type: list
    required: 是
    scope: [entity, article]
    layer: 业务属性
    description: 测试字典。
`;

test("反例：消费锚点字段未在 fields.yaml 登记 → 门禁红（防校验代码读未登记字段）", () => {
  // 临时改锚点文件会污染工作区——改用「字典缺声明」法：真实锚点消费 module+article_type 等，
  // 字典只声明 module → 其余消费字段全部未登记 → 红。
  const vault = buildVault({ fields: BASE_FIELDS });
  const { code, stdout } = runGate({ vault });
  assert.equal(code, 1, "未登记消费必须红");
  assert.match(stdout, /未登记消费/);
  assert.match(stdout, /article_type|arch_layer|tags/);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("正例：真实 vault fields.yaml 全登记 → 门禁绿（含 advisory 不拦截）", () => {
  const vault = resolveVaultPath();
  if (!vault || !fs.existsSync(path.join(vault, "知识库", "TheSchema", "fields.yaml"))) return; // 环境无 vault 跳过
  const { code, stdout } = runGate({ vault });
  assert.equal(code, 0);
  assert.match(stdout, /check-fields-registry: ok/);
});

test("缺字典：fields.yaml 不存在 → 红（fail-closed，不算绿）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fields-gate-empty-"));
  fs.mkdirSync(path.join(dir, "知识库", "TheSchema"), { recursive: true });
  const { code, stdout } = runGate({ vault: dir });
  assert.equal(code, 1);
  assert.match(stdout, /fields\.yaml 不存在/);
  fs.rmSync(dir, { recursive: true, force: true });
});


// ── PR-151 续·根治：补齐三方对账纯函数红绿夹具（字典必填↔契约↔选项包）──
const PARITY_BASE = {
  fieldsDoc: { fields: [
    { name: "title", required: "是", scope: ["article"] },
    { name: "product", required: "是", scope: ["article"] },
    { name: "arch_layer", required: "是", scope: ["entity", "article"] },
  ] },
  rulesArticle: {
    required: ["title", "article_id", "product", "arch_layer"],
    fields: {
      title: { control: "text", required: true },
      article_id: {},
      product: { control: "select", required: true, optionsKey: "products" },
      arch_layer: { control: "select", required: true, optionsKey: "archLayers" },
    },
  },
  articleFieldOptions: {
    required: ["products", "archLayers"],
    properties: { articleFields: { items: { properties: { optionsKey: { enum: ["products", "archLayers"] } } } } },
  },
};

test("PR-151 续·正例：字典必填全登记＋选项包齐 → 无红", async () => {
  const { checkCompletionParity } = await import("../check-fields-registry.mjs");
  assert.deepEqual(checkCompletionParity(PARITY_BASE), []);
});

test("PR-151 续·反例①：字典新增必填（priority）漏登记契约 → 补齐缺口＋必填漂移双红，报错给出补齐链路", async () => {
  const { checkCompletionParity } = await import("../check-fields-registry.mjs");
  const errors = checkCompletionParity({
    ...PARITY_BASE,
    fieldsDoc: { fields: [...PARITY_BASE.fieldsDoc.fields, { name: "priority", required: "是", scope: ["article"] }] },
  });
  assert.ok(errors.some((e) => e.includes("补齐缺口") && e.includes("priority") && e.includes("article.fields")));
  assert.ok(errors.some((e) => e.includes("必填漂移") && e.includes("priority")));
});

test("PR-151 续·反例②：契约必填滞留（字典已非必填）→ 平行账回潮红；optionsKey 悬空双红", async () => {
  const { checkCompletionParity } = await import("../check-fields-registry.mjs");
  const errors = checkCompletionParity({
    ...PARITY_BASE,
    rulesArticle: {
      required: [...PARITY_BASE.rulesArticle.required, "legacy_field"],
      fields: { ...PARITY_BASE.rulesArticle.fields, legacy_field: { control: "select", required: true, optionsKey: "noSuchBag" } },
    },
  });
  assert.ok(errors.some((e) => e.includes("必填滞留") && e.includes("legacy_field")));
  assert.ok(errors.some((e) => e.includes("选项包悬空") && e.includes("noSuchBag")));
});
