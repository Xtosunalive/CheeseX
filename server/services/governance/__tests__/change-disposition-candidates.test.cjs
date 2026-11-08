const assert = require("node:assert/strict");
const test = require("node:test");
const { createChangeDispositionCandidateService } = require("../change-disposition-candidate-service.cjs");

test("produces ASSERT and BLOCK candidates from released usage and stale source", () => {
  const service = createChangeDispositionCandidateService();
  const candidates = service.produce({ affectedVersions: [
    { product: "AnyShare", version: "7.0.6.8", status: "released", componentIds: ["gateway"], removed: [{ source: "gateway", type: "DEPENDS_ON", target: "auth" }], paths: [] },
    { product: "AnyShare", version: "7.0.6.9", status: "draft", componentIds: ["gateway"], removed: [], paths: [], stale: true },
  ] });
  assert.deepEqual(candidates.map((item) => item.effect), ["BLOCK", "ASSERT"]);
  assert.equal(candidates.find((item) => item.effect === "ASSERT").evidence[0], "relation:gateway|DEPENDS_ON|auth");
});

test("waives isolated draft changes and suspends pending review", () => {
  const service = createChangeDispositionCandidateService();
  const candidates = service.produce({ affectedVersions: [
    { product: "AnyShare", version: "1.0", status: "draft", componentIds: ["a"], removed: [], paths: [], documents: [] },
    { product: "AnyShare", version: "2.0", status: "released", componentIds: ["a"], removed: [], paths: [{ nodeIds: ["a", "b"] }], documents: [], pendingReview: true },
  ] });
  assert.deepEqual(candidates.map((item) => item.effect).sort(), ["SUSPEND", "WAIVE"]);
});
