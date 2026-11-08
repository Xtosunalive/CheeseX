// @tests: server/services/schema-manager/relations-write-service.cjs（EDGE-RELATION-GOV-001 对象本体批）
// 层级：纯单元＋Adapter 契约（THESCHEMA_DIR 钉扎 tmp TheSchema 自含领地——repoWrite 目的地执法豁免通道；
//   字典端点对账吃真仓 contracts/object-dictionary.json，类型对账吃钉扎 ontology）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const svc = require("../relations-write-service.cjs");

function pinTheSchema() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relations-write-"));
  const the = path.join(dir, "theschema");
  fs.mkdirSync(the, { recursive: true });
  fs.writeFileSync(path.join(the, "ontology.yaml"), [
    "relation_types:",
    "  derivation:",
    "    description: 治理语义边——派生",
    "    label_cn: 派生",
    "    fact_encoding: governance_assertion",
    "    projected: true",
    "  containment:",
    "    description: 治理语义边——包含",
    "    label_cn: 包含",
    "    fact_encoding: governance_assertion",
    "    projected: true",
    "node_types: {}",
    "inference_rules: []",
    "constraints: []",
    "",
  ].join("\n"), "utf8");
  const saved = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = the;
  return { dir, the, restore: () => { if (saved === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = saved; } };
}

const ROW = {
  source: "知识本体",
  target: "关系类型",
  type: "containment",
  note: "段级独立对象化（D3）",
  asserted_by: "human",
  asserted_at: "2026-10-24",
};

// PR-200：写侧乐观锁基线必填——各例先读基线再写（合法调用形＝读后写）；缺基线的拒写面见 write-guards.test.cjs。

test("写回三要件＋读回：合法行落盘、revision 前进、文件即 yaml", () => {
  const pin = pinTheSchema();
  try {
    const before = svc.readRelationsFile("v");
    assert.deepEqual(before.data.relations, [], "文件缺省＝空账（真实零值）");
    const written = svc.writeRelations({ expectedRevision: svc.readRelationsFile("v").revision, vaultPath: "v", relations: [ROW] });
    assert.equal(written.data.relations.length, 1);
    assert.notEqual(written.revision, before.revision, "revision 前进");
    assert.match(fs.readFileSync(path.join(pin.the, "relations.yaml"), "utf8"), /^relations:/);
    const again = svc.readRelationsFile("v");
    assert.deepEqual(again.data.relations[0].source, "知识本体");
  } finally {
    pin.restore();
    fs.rmSync(pin.dir, { recursive: true, force: true });
  }
});

test("写侧两项对账：悬空端点拒写／类型不在册拒写／身份重复拒写——均未落盘", () => {
  const pin = pinTheSchema();
  try {
    for (const bad of [
      [{ ...ROW, target: "不存在的对象" }],
      [{ ...ROW, type: "BELONGS_TO" }],
      [ROW, ROW],
      ROW, // 非数组整体拒绝（fail-closed，不静默清空）
    ]) {
      assert.throws(
        () => svc.writeRelations({ expectedRevision: svc.readRelationsFile("v").revision, vaultPath: "v", relations: bad }),
        (e) => e.code === "RELATIONS_INVALID" && e.status === 400,
        JSON.stringify(bad).slice(0, 60),
      );
    }
    assert.equal(svc.readRelationsFile("v").data.relations.length, 0, "拒写不落盘");
  } finally {
    pin.restore();
    fs.rmSync(pin.dir, { recursive: true, force: true });
  }
});

test("形态严校验：缺 asserted_at／asserted_by 越界 → 400 未落盘", () => {
  const pin = pinTheSchema();
  try {
    const { asserted_at, ...noDate } = ROW;
    void asserted_at;
    assert.throws(() => svc.writeRelations({ expectedRevision: svc.readRelationsFile("v").revision, vaultPath: "v", relations: [noDate] }), (e) => e.code === "RELATIONS_INVALID");
    assert.throws(() => svc.writeRelations({ expectedRevision: svc.readRelationsFile("v").revision, vaultPath: "v", relations: [{ ...ROW, asserted_by: "robot" }] }), (e) => e.code === "RELATIONS_INVALID");
  } finally {
    pin.restore();
    fs.rmSync(pin.dir, { recursive: true, force: true });
  }
});

test("乐观锁：旧 revision 写入 → 409 RELATIONS_REVISION_CONFLICT；幂等覆盖＝同身份单行更新", () => {
  const pin = pinTheSchema();
  try {
    const first = svc.writeRelations({ expectedRevision: svc.readRelationsFile("v").revision, vaultPath: "v", relations: [ROW] });
    // 幂等覆盖：同身份重写（带当前 revision）→ 单行、note 更新、revision 前进
    const second = svc.writeRelations({ vaultPath: "v", relations: [{ ...ROW, note: "更新后的注记" }], expectedRevision: first.revision });
    assert.equal(second.data.relations.length, 1);
    assert.equal(second.data.relations[0].note, "更新后的注记");
    assert.notEqual(second.revision, first.revision);
    // 旧 revision（first 已过时）→ 409
    assert.throws(
      () => svc.writeRelations({ vaultPath: "v", relations: [], expectedRevision: first.revision }),
      (e) => e.code === "RELATIONS_REVISION_CONFLICT" && e.status === 409,
    );
    assert.equal(svc.readRelationsFile("v").data.relations.length, 1, "409 不落盘");
  } finally {
    pin.restore();
    fs.rmSync(pin.dir, { recursive: true, force: true });
  }
});

// ── SPEC-027 C11：图域端点校验变体（双域各一例＋未接线 fail-closed）──
test("C11 图域行：端点在图谱节点集 → 过（含 confidence_band 档位）", () => {
  const pin = pinTheSchema();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relations-graph-"));
    fs.writeFileSync(path.join(dir, "relations.yaml"), "relations: []\n", "utf8");
    const graphNodes = ["tech:cms", "tech:search"];
    const written = svc.writeRelations({

      expectedRevision: svc.readRelationsFile(dir).revision,      vaultPath: dir,
      relations: [{ source: "tech:cms", target: "tech:search", type: "containment", asserted_by: "human", asserted_at: "2026-10-24", endpoint_domain: "graph", confidence_band: "medium" }],
      listGraphNodeIds: () => graphNodes,
    });
    assert.equal(written.revision.length > 0, true);
    const back = svc.readRelationsFile(dir);
    assert.equal(back.data.relations[0].confidence_band, "medium");
    assert.equal(back.data.relations[0].endpoint_domain, "graph");
  } finally { pin.restore(); }
});

test("C11 图域行：端点不在图谱节点集 → 拒（图域悬空）", () => {
  const pin = pinTheSchema();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relations-graph-dangling-"));
    fs.writeFileSync(path.join(dir, "relations.yaml"), "relations: []\n", "utf8");
    assert.throws(() => svc.writeRelations({

      expectedRevision: svc.readRelationsFile(dir).revision,      vaultPath: dir,
      relations: [{ source: "tech:cms", target: "tech:ghost", type: "containment", asserted_by: "human", asserted_at: "2026-10-24", endpoint_domain: "graph" }],
      listGraphNodeIds: () => ["tech:cms", "tech:search"],
    }), /图域悬空/);
  } finally { pin.restore(); }
});

test("C11 字典悬空仍拒（治理载荷校验不放松）＋图域未接线 fail-closed", () => {
  const pin = pinTheSchema();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relations-mixed-"));
    fs.writeFileSync(path.join(dir, "relations.yaml"), "relations: []\n", "utf8");
    assert.throws(() => svc.writeRelations({

      expectedRevision: svc.readRelationsFile(dir).revision,      vaultPath: dir,
      relations: [{ source: "不存在的对象", target: "another", type: "derivation", asserted_by: "human", asserted_at: "2026-10-24" }],
    }), /对象字典在册名集/);
    assert.throws(() => svc.writeRelations({

      expectedRevision: svc.readRelationsFile(dir).revision,      vaultPath: dir,
      relations: [{ source: "tech:cms", target: "tech:search", type: "containment", asserted_by: "human", asserted_at: "2026-10-24", endpoint_domain: "graph" }],
      // 不传 listGraphNodeIds —— fail-closed
    }), /图域校验未接线/);
  } finally { pin.restore(); }
});
