const test = require("node:test");
const assert = require("node:assert/strict");
const routes = require("../entity-compliance-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：repair/apply 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "repair-boundary-actions-")) });

test("Entity Compliance confirms repair through a direct formal-Vault apply (E2'b)", async () => {
  const h = createRouteHarness();
  let directApplyCalls = 0;
  routes.register(h.registerRoute, {
    vaultPath: "/unused",
    repairService: {
      preview() { return {}; },
      apply(input) {
        directApplyCalls += 1;
        assert.equal(input.confirmed, true);
        assert.equal(input.previewId, "preview-1");
        return { entityId: "x", writtenFields: ["module"], backupPath: "", sourceRevision: { contentHash: "sha256:x", size: 10, mtimeMs: 1 }, postCheck: { blockerCount: 0, warningCount: 0 } };
      },
    },
  });

  assert.equal(h.routes.has("POST /api/entity/repair/propose"), false, "the graph-fact Proposal confirmation route must be retired (ADR043)");
  assert.equal(h.routes.has("POST /api/entity/repair/apply"), true, "a direct formal-Vault apply route must replace Proposal confirmation");
  const res = await h.call("POST /api/entity/repair/apply", undefined, { previewId: "preview-1", confirmed: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.entityId, "x");
  assert.deepEqual(res.body.data.writtenFields, ["module"]);
  assert.equal(directApplyCalls, 1);
});
