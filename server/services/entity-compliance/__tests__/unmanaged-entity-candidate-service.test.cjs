const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { findUnmanagedEntityCandidates } = require("../unmanaged-entity-candidate-service.cjs");

test("finds matching pages outside the governed entity directory", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "unmanaged-entity-"));
  try {
    fs.mkdirSync(path.join(vaultPath, "知识库", "wiki", "entities"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, "anybackup.md"), "# AnyBackup\n");
    fs.writeFileSync(path.join(vaultPath, "知识库", "wiki", "entities", "anyshare.md"), "# AnyShare\n");
    assert.deepEqual(findUnmanagedEntityCandidates(vaultPath, ["anybackup", "anyshare"]), [{ target: "anybackup", sourcePath: "anybackup.md" }]);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});
