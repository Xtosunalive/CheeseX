// G2/D9-2 红灯先行：current 指针读取 TOCTOU 错误码漂移。
// 修复前行为（红灯原因）：existsSync(:24) 与 readFileSync(:26) 之间指针被删 → ENOENT 落入
// 笼统 catch → 500 CURRENT_POINTER_INVALID（语义应为 404 NO_CURRENT_RELEASE，与 ：24 同码）。
// 修复后：catch 内 error.code === "ENOENT" 分流 404 NO_CURRENT_RELEASE（复用既有码，零新码）；
// 解析错误/非法 releaseId 仍 500 CURRENT_POINTER_INVALID（T5 负例守卫，防过度分流）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createReleaseReaderService } = require("../release-reader-service.cjs");

const SOURCE_COMMIT = "39ace82a91c167e26461e5b307e651b270a04545";
const RELEASE_ID = `release-${"a".repeat(64)}`;
const VALID_POINTER = { releaseId: RELEASE_ID, sourceCommit: SOURCE_COMMIT, manifestHash: "sha256:x" };

function fixtureReader({ pointer } = {}) {
  const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "reader-toctou-"));
  const builderService = {
    verifyRelease: () => ({ valid: true }),
    readRelease: () => ({ sourceCommit: SOURCE_COMMIT, manifestHash: "sha256:x" }),
  };
  const reader = createReleaseReaderService({ builderService, releasesDir });
  if (pointer !== undefined) fs.writeFileSync(path.join(releasesDir, "current.json"), JSON.stringify(pointer));
  return { releasesDir, reader };
}

test("G2/T4 TOCTOU：existsSync 与 readFileSync 之间指针被删 → 404 NO_CURRENT_RELEASE", () => {
  const { releasesDir, reader } = fixtureReader({ pointer: VALID_POINTER });
  const originalExistsSync = fs.existsSync;
  try {
    fs.existsSync = () => true; // 注入：守卫恒真（模拟检查通过后、读取前文件被删的竞争窗口）
    fs.rmSync(path.join(releasesDir, "current.json"), { force: true });
    assert.throws(
      () => reader.resolveCurrentReleaseId(),
      (e) => e.code === "NO_CURRENT_RELEASE" && e.status === 404,
    );
  } finally {
    fs.existsSync = originalExistsSync;
    fs.rmSync(releasesDir, { recursive: true, force: true });
  }
});

test("G2/T5 负例守卫：损坏 JSON 仍 500 CURRENT_POINTER_INVALID（分流不得过度）", () => {
  const { releasesDir, reader } = fixtureReader();
  fs.writeFileSync(path.join(releasesDir, "current.json"), "{bad", "utf8");
  assert.throws(
    () => reader.resolveCurrentReleaseId(),
    (e) => e.code === "CURRENT_POINTER_INVALID" && e.status === 500,
  );
  fs.rmSync(releasesDir, { recursive: true, force: true });
});
