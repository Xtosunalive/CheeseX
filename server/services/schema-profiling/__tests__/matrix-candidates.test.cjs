// Component: Matrix-Candidates Tests（PR-088 接线一·红绿夹具）
// @responsible: ①只收双方正式词的组合（野生子域/野生类别不进组合裁定——词表通道先行）②已在矩阵 allow 的组合不再是候选、stage 随矩阵配置翻面
//               ③观察账本史加持（首见/累计轮次/累计出现 含本轮）④样例文件 ≤3 相对路径
// @inputs: matrix-candidates.cjs＋临时 vault（实体 frontmatter）＋临时观察账本（TAXONOMY_OBSERVATIONS_FILE 钉扎）
// @outputs: node:test 断言
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildMatrixCandidates } = require("../matrix-candidates.cjs");

const ENTITY = (id, sd, cat) => `---\narchitecture-node-id: ${id}\ntitle: ${id}\narch_subdomain: ${sd}\narch_category: ${cat}\n---\n\n# ${id}\n`;

function makeVault(entities) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-cand-"));
  const dir = path.join(root, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(entities)) fs.writeFileSync(path.join(dir, `${name}.md`), content, "utf8");
  return root;
}

const ENUMS = {
  domains: { ops: "运维" },
  subdomains: { ops: ["maintain", { id: "deploy", label: "部署" }] },
  arch_categories: ["服务", "应用组件"],
};

function withLedger(lines, fn) {
  const file = path.join(os.tmpdir(), `matrix-cand-ledger-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length ? "\n" : ""), "utf8");
  const prior = process.env.TAXONOMY_OBSERVATIONS_FILE;
  process.env.TAXONOMY_OBSERVATIONS_FILE = file;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.TAXONOMY_OBSERVATIONS_FILE;
    else process.env.TAXONOMY_OBSERVATIONS_FILE = prior;
    fs.rmSync(file, { force: true });
  }
}

test("红：野生词组合不进组合裁定——只收双方正式词；正式组合计数与样例齐", () => {
  const vault = makeVault({
    a: ENTITY("a", "maintain", "服务"),
    b: ENTITY("b", "maintain", "服务"),
    c: ENTITY("c", "maintain", "野生类别"), // 野生类别 → 词表通道
    d: ENTITY("d", "wildsub", "服务"), // 野生子域 → 词表通道
    e: ENTITY("e", "deploy", "应用组件"), // 对象形态词条 id 也算正式
  });
  const out = withLedger([], () => buildMatrixCandidates({ vaultPath: vault, enumsData: ENUMS }));
  assert.equal(out.stage, "observe");
  assert.deepEqual(out.candidates.map((c) => `${c.subdomain}|${c.category}`), ["maintain|服务", "deploy|应用组件"]);
  const top = out.candidates[0];
  assert.equal(top.occurrences, 2);
  assert.equal(top.domainId, "ops");
  assert.equal(top.rounds, 1);
  assert.equal(top.total, 2);
  assert.equal(top.firstSeen, "本轮");
  assert.deepEqual(top.sampleFiles, ["知识库/wiki/entities/a.md", "知识库/wiki/entities/b.md"]);
});

test("绿→候选退场：已在矩阵 allow 的组合不再是候选，stage=configured（立契期只剩矩阵外新组合）", () => {
  const vault = makeVault({ a: ENTITY("a", "maintain", "服务"), e: ENTITY("e", "deploy", "应用组件") });
  const out = buildMatrixCandidates({
    vaultPath: vault,
    enumsData: { ...ENUMS, subdomain_constraints: { maintain: { domain_id: "ops", allowed_categories: ["服务"] } } },
  });
  assert.equal(out.stage, "configured");
  assert.deepEqual(out.candidates.map((c) => `${c.subdomain}|${c.category}`), ["deploy|应用组件"]);
});

test("观察账本史加持：首见取账本首轮，轮次/累计含本轮；他库记录不串台", () => {
  const vault = makeVault({ a: ENTITY("a", "maintain", "服务") });
  const out = withLedger([
    { ts: "2026-10-01T00:00:00.000Z", vault, entities: 2, combos: { "maintain|服务": 2 } },
    { ts: "2026-10-02T00:00:00.000Z", vault: "/elsewhere/vault", entities: 9, combos: { "maintain|服务": 9 } },
    { ts: "2026-10-03T00:00:00.000Z", vault, entities: 1, combos: { "maintain|服务": 1 } },
  ], () => buildMatrixCandidates({ vaultPath: vault, enumsData: ENUMS }));
  const c = out.candidates[0];
  assert.equal(c.firstSeen, "2026-10-01T00:00:00.000Z");
  assert.equal(c.rounds, 3, "账本两轮＋本轮");
  assert.equal(c.total, 4, "2＋1＋本轮 1——他库的 9 不计");
});

test("样例文件封顶 3", () => {
  const vault = makeVault(Object.fromEntries(["a", "b", "c", "d", "e"].map((n) => [n, ENTITY(n, "maintain", "服务")])));
  const out = buildMatrixCandidates({ vaultPath: vault, enumsData: ENUMS });
  assert.equal(out.candidates[0].occurrences, 5);
  assert.equal(out.candidates[0].sampleFiles.length, 3);
});
