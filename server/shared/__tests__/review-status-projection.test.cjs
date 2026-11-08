// PR-095：读侧合并对派生章的保留语义——账本优先（人裁覆盖机器章）＋白名单外仍 fail-closed。
// 层级：纯单元（graph 形状直喂 mergeReviewStatus）。
const test = require("node:test");
const assert = require("node:assert");
const { mergeReviewStatus } = require("../review-status-projection.cjs");

function graphWith(status) {
  return {
    connections: [
      { edgeId: "e1", source: "a", target: "b", relationType: "BELONGS_TO", reviewStatus: status },
    ],
  };
}

test("deterministic 派生章无账本记录时保留（PR-095）", () => {
  const merged = mergeReviewStatus(graphWith("deterministic"), []);
  assert.equal(merged.connections[0].reviewStatus, "deterministic");
});

test("inherited_approved 派生章同理保留", () => {
  const merged = mergeReviewStatus(graphWith("inherited_approved"), []);
  assert.equal(merged.connections[0].reviewStatus, "inherited_approved");
});

test("人裁账本覆盖派生章——approved 与 rejected 双向", () => {
  const approve = [{ edgeId: "e1", action: "approved", decidedAt: "2026-10-25T00:00:00Z" }];
  assert.equal(mergeReviewStatus(graphWith("deterministic"), approve).connections[0].reviewStatus, "approved");
  const reject = [{ edgeId: "e1", action: "rejected", decidedAt: "2026-10-25T00:00:00Z" }];
  assert.equal(mergeReviewStatus(graphWith("inherited_approved"), reject).connections[0].reviewStatus, "rejected");
});

test("K-P1-1 基线保持：白名单外图内状态无账本记录仍回 pending（防管道污染回潮）", () => {
  // 图内自称 approved 但账本无记录 → 不认（旧 fail-closed 语义不动）
  assert.equal(mergeReviewStatus(graphWith("approved"), []).connections[0].reviewStatus, "pending");
  assert.equal(mergeReviewStatus(graphWith("bogus"), []).connections[0].reviewStatus, "pending");
});

test("无 reviewStatus 的边仍默认 pending（合并语义兜底）", () => {
  const merged = mergeReviewStatus({ connections: [{ edgeId: "e2", source: "x", target: "y" }] }, []);
  assert.equal(merged.connections[0].reviewStatus, "pending");
});
