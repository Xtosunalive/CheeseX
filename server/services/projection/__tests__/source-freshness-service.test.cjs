const assert = require("node:assert/strict");
const test = require("node:test");
const { compareFreshness, fingerprint } = require("../source-freshness-service.cjs");

const values = { sourceHash: "sha256:source", sourceRevision: "sha256:file", factRevision: "sha256:fact", ruleRevision: "sha256:rule", snapshotHash: "sha256:snapshot" };

test("returns fresh when all tracked revisions match", () => {
  assert.deepEqual(compareFreshness(values, { ...values }, () => new Date("2026-07-19T00:00:00.000Z")), { status: "fresh", checkedAt: "2026-07-19T00:00:00.000Z", changedFields: [] });
});

test("returns stale with changed fields", () => {
  const result = compareFreshness(values, { ...values, sourceHash: "sha256:new" });
  assert.equal(result.status, "stale");
  assert.deepEqual(result.changedFields, ["sourceHash"]);
});

test("returns unknown when a required revision is absent", () => {
  assert.equal(compareFreshness(values, { ...values, snapshotHash: null }).status, "unknown");
});

test("fingerprint is stable for the same structured input", () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
});
