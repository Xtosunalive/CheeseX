// 层级：L1 纯单元＋源树扫描 tripwire（WP-069 S4／SPEC-069 §3.4——生命周期决定面单源执法）。
// 被测对象：nextState/requiredFrom/dirFor 由 contracts/article-lifecycle.json transitions 边表
// 单源驱动（表驱动测试：每条边逐一问函数，不另抄期望值——表改则测试随行，假绿无处藏）；
// 服务侧目标状态字面量清零（决定只经 nextState/requiredFrom/dirFor）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CONTRACT = require("../../../contracts/article-lifecycle.json");
const transitions = require("../article-lifecycle-transitions.cjs");

test("nextState：逐边表驱动——每条边 from×action 恰答 to（表即期望，不另抄）", () => {
  assert.ok(CONTRACT.transitions.length >= 4, "边表至少四边（promote/publish/archive/retire）");
  for (const edge of CONTRACT.transitions) {
    assert.equal(transitions.nextState(edge.from, edge.action), edge.to, `${edge.from}--${edge.action}-->${edge.to}`);
  }
});

test("nextState：未知边一律 null（不在册转移拒绝决定）", () => {
  assert.equal(transitions.nextState("source-archive", "promote"), null, "终态无 promote");
  assert.equal(transitions.nextState("draft", "publish"), null, "draft 无 publish 边（必须先提升）");
  assert.equal(transitions.nextState("不存在的状态", "promote"), null);
});

test("requiredFrom：每动作答边起点；ACTIONS 与边表动作集一致", () => {
  for (const edge of CONTRACT.transitions) {
    assert.equal(transitions.requiredFrom(edge.action), edge.from, `${edge.action} 起点=${edge.from}`);
  }
  assert.deepEqual([...transitions.ACTIONS].sort(), [...new Set(CONTRACT.transitions.map((e) => e.action))].sort());
});

test("dirFor：四角色落位目录映射（roundtrip 到 paths 模块）", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "lc-dirfor-"));
  try {
    assert.ok(transitions.dirFor("draft", vault).includes("drafts"));
    assert.ok(transitions.dirFor("standard-working", vault).length > vault.length);
    assert.ok(transitions.dirFor("standard-formal", vault).includes("articles"));
    assert.ok(transitions.dirFor("source-archive", vault).includes("archive"));
    assert.throws(() => transitions.dirFor("不存在的角色", vault), /ROLE_UNMAPPED/);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("源树 tripwire：服务侧零目标状态字面量决定（注释/日志标签不咬）", () => {
  const serviceDir = path.join(ROOT, "server", "services", "article-workflow");
  const offenders = [];
  for (const e of fs.readdirSync(serviceDir, { withFileTypes: true })) {
    if (!e.name.endsWith(".cjs") || e.name.endsWith(".test.cjs")) continue;
    const rel = `server/services/article-workflow/${e.name}`;
    const lines = fs.readFileSync(path.join(serviceDir, e.name), "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, ""); // 剥行注释（角色可变性等文档性引用合法）
      if (/['"](standard-working|standard-formal|source-archive)['"]/.test(code)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "目标态决定只经 nextState/dirFor（字面量＝第二决定源）");
});
