// gen-value-domains 生成器自测——红绿双证（P0 纪律：反例先红）：
// 绿＝仓内三机真身≡openapi 三段投影≡前端钉子键集；红①＝服务端真身加值（投影漂移即拦，
// --write 后投影更新且三段 enum 外内容逐字节保留）；红②＝前端钉子键集漂移（死显示键即拦）。
// 走真实链路：真服务端源→真生成器→真 openapi 定点替换，夹具根经 VALUE_DOMAINS_ROOT 注入。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO, "scripts", "quality", "gen-value-domains.mjs");
const FIXTURE_FILES = [
  "contracts/http-api.openapi.json",
  "server/services/article-workflow/article-upload-status.cjs",
  "server/services/release-governance/approval-state-machine-service.cjs",
  "server/services/article-workflow/article-workflow-service.cjs",
  "src/lib/domain/StatusDisplay.ts",
];

function makeFixture(dir = fs.mkdtempSync(path.join(os.tmpdir(), "value-domains-fixture-"))) {
  for (const rel of FIXTURE_FILES) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), dest);
  }
  return dir;
}

function runGen(root, args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      env: { ...process.env, VALUE_DOMAINS_ROOT: root },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status, out: String(error.stdout || "") + String(error.stderr || "") };
  }
}

const taskEnumOf = (openapiPath) => {
  const doc = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
  return doc.components.schemas.ArticleWorkflowTask.properties.status.enum;
};

test("绿：仓内三机真身≡契约投影≡钉子键集（真实源全量校验）", () => {
  const dir = makeFixture();
  try {
    const { code, out } = runGen(dir, []);
    assert.equal(code, 0, out);
    assert.match(out, /state_value_domains=ok/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("红①：服务端真身加值 → --check 红（投影漂移即拦）", () => {
  const dir = makeFixture();
  try {
    const uploadPath = path.join(dir, "server/services/article-workflow/article-upload-status.cjs");
    fs.writeFileSync(uploadPath, fs.readFileSync(uploadPath, "utf8").replace('"digested"]', '"digested", "ghost_state"]'));
    const { code, out } = runGen(dir, []);
    assert.equal(code, 1);
    assert.match(out, /任务派生①契约投影漂移/);
    assert.match(out, /ghost_state/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("绿②：--write 投影更新、三段 enum 外逐字节保留、钉子跟上后复绿（退出路径可走通）", () => {
  const dir = makeFixture();
  try {
    // 破坏：任务机真身加 ghost_state（服务端单源先行——生成链语义：改真身→重投影）
    const uploadPath = path.join(dir, "server/services/article-workflow/article-upload-status.cjs");
    fs.writeFileSync(uploadPath, fs.readFileSync(uploadPath, "utf8").replace('"digested"]', '"digested", "ghost_state"]'));
    // --write 落盘投影，但钉子键集未跟→尾随钉子对账红（整体 exit 1＝尚未达绿的诚实信号）
    const write = runGen(dir, ["--write"]);
    assert.equal(write.code, 1, "--write 后钉子未同步必须红");
    assert.match(write.out, /钉子键集漂移/);
    // 投影面：契约 enum 已含新值
    assert.equal(taskEnumOf(path.join(dir, "contracts/http-api.openapi.json")).includes("ghost_state"), true);
    // 保留面：旧文档深拷贝＋仅三段替换 ≡ 实际写盘内容（三段外逐字节保留的内容级证明）
    const before = JSON.parse(fs.readFileSync(path.join(REPO, "contracts/http-api.openapi.json"), "utf8"));
    const after = JSON.parse(fs.readFileSync(path.join(dir, "contracts/http-api.openapi.json"), "utf8"));
    const expected = structuredClone(before);
    expected.components.schemas.ArticleWorkflowTask.properties.status.enum.push("ghost_state");
    assert.deepEqual(after, expected);
    // 复绿：钉子补上 ghost_state 后 --check 即绿（退出路径可走通）
    const displayPath = path.join(dir, "src/lib/domain/StatusDisplay.ts");
    fs.writeFileSync(displayPath, fs.readFileSync(displayPath, "utf8").replace(
      'digested: { label: TERM.TASK_DIGESTED, tone: "neutral" },',
      'digested: { label: TERM.TASK_DIGESTED, tone: "neutral" },\n  ghost_state: { label: "幻影", tone: "neutral" },',
    ));
    const rerun = runGen(dir, []);
    assert.equal(rerun.code, 0, rerun.out);
    assert.match(rerun.out, /state_value_domains=ok/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("红③：前端钉子键集漂移（死显示键）→ --check 红", () => {
  const dir = makeFixture();
  try {
    const displayPath = path.join(dir, "src/lib/domain/StatusDisplay.ts");
    fs.writeFileSync(displayPath, fs.readFileSync(displayPath, "utf8").replace(
      'digested: { label: TERM.TASK_DIGESTED, tone: "neutral" },',
      'digested: { label: TERM.TASK_DIGESTED, tone: "neutral" },\n  ghost_state: { label: "幻影", tone: "neutral" },',
    ));
    const { code, out } = runGen(dir, []);
    assert.equal(code, 1);
    assert.match(out, /任务派生①钉子键集漂移/);
    assert.match(out, /死显示键.*ghost_state/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
