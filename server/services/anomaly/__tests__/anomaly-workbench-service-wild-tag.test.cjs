const assert = require("node:assert/strict");
const test = require("node:test");
const { createAnomalyWorkbenchService } = require("../anomaly-workbench-service.cjs");

test("D5 裁决：wild_tag 不阻断任何业务动作（与 standardization_warning 同立场，裁定通道是待沉淀标签）", () => {
  const vaultPath = "/tmp/anomaly-blocked-wild-tag";
  const service = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => [
      { issueId: "i-w", issueKind: "wild_tag", title: "t", evidence: [{ kind: "wild-tag", path: "p" }], handling: "fix" },
      { issueId: "i-s", issueKind: "standardization_warning", title: "t", evidence: [{ kind: "vault-document", path: "p" }], handling: "fix" },
    ],
    getPipelineStatus: () => null,
  });
  const issues = service.list().issues;
  assert.deepEqual(issues.find((i) => i.issueKind === "wild_tag").blockedActions, [], "wild_tag 不阻断");
  assert.deepEqual(issues.find((i) => i.issueKind === "standardization_warning").blockedActions, [], "standardization_warning 不阻断");
});
