const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildPlan, applyPlan } = require("../migrate-readable-paths.cjs");

test("旧哈希文件先预览、确认计划哈希后迁移；重名加序号且重试幂等", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readable-migrate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (id) => {
    const raw = `---\narticle_id: ${id}\ntitle: 架构说明\nversion: 1.0\ncategory-path: 运维:维护\n---\n${id}`;
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const file = path.join(root, "知识库/wiki/articles/运维", id, `${hash}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
    return { file, raw };
  };
  const first = write("a1"), second = write("a2");
  const plan = buildPlan(root);
  assert.equal(plan.moves.length, 2);
  assert(fs.existsSync(first.file) && fs.existsSync(second.file), "预览不能修改原件");
  assert.notEqual(plan.moves[0].to, plan.moves[1].to);
  assert.throws(() => applyPlan(plan, "wrong"), /计划哈希不匹配/);
  applyPlan(plan, plan.planHash);
  for (const move of plan.moves) assert.equal(fs.readFileSync(path.join(root, move.to), "utf8"), move.articleId === "a1" ? first.raw : second.raw);
  assert.equal(buildPlan(root).moves.length, 0);
});

test("旧文件与现行文件 article_id 重复时迁移拒绝且不改原件", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readable-duplicate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const raw = "---\narticle_id: same\ntitle: 同名\n---\n正文";
  const old = path.join(root, "知识库/wiki/articles/ops/old", `${crypto.createHash("sha256").update(raw).digest("hex")}.md`);
  const readable = path.join(root, "知识库/wiki/articles/ops/同名.md");
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, raw);
  fs.writeFileSync(readable, raw);
  assert.throws(() => buildPlan(root), /article_id 重复/);
  assert(fs.existsSync(old) && fs.existsSync(readable));
});
