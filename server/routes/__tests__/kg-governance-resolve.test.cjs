// PR-317（WP-178）：治理 resolve 幂等拒绝——同 gapId 已处置再 resolve 即 409，账本不重复追加。
// 退出路径显式登记：账本 append-only 无系统内撤销通道，恢复=人工账本侧处理（不建 revert 端点，另案）。
const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const kgRoutes = require("../kg-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs");
const { createGovernanceActionStore } = require("../../services/governance/governance-action-store.cjs");

test("PR-317 同 gapId 第二次 resolve → 409 GAP_ALREADY_RESOLVED 且账本不重复追加", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "kg-governance-"));
  try {
    setupActionRuntime({ vaultPath: vault });
    const store = createGovernanceActionStore({ vaultPath: vault });
    const h = createRouteHarness();
    kgRoutes.setVaultPath(vault);
    kgRoutes.register(h.registerRoute, {
      readSemanticArchitecture: () => null,
      readMasterGraph: () => ({ nodes: [], connections: [] }),
      addGovernanceAction: store.addAction,
      getResolvedGapIds: store.getResolvedGapIds,
    });
    const first = await h.call("POST /api/governance/resolve", undefined, { gapId: "gap-arch-layer", action: "ignored", note: "首次处置" });
    assert.equal(first.statusCode, 200, `first=${JSON.stringify(first.payload)}`);
    assert.equal(store.getResolvedGapIds().has("gap-arch-layer"), true);

    const second = await h.call("POST /api/governance/resolve", undefined, { gapId: "gap-arch-layer", action: "ignored", note: "重复点击" });
    assert.equal(second.statusCode, 409);
    assert.equal(second.payload.error_code, "GAP_ALREADY_RESOLVED");
    assert.equal(store.readActions().filter((a) => a.gapId === "gap-arch-layer").length, 1, "账本不重复追加");

    const other = await h.call("POST /api/governance/resolve", undefined, { gapId: "gap-other", action: "exempted", note: "另一缺口不受影响" });
    assert.equal(other.statusCode, 200);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
