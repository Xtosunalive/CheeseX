// G1/D9-1 红灯先行：release-runtime 不再向 publisher 传 validateSourceCommit 死参数。
// 背景：E2'/E4' 绞杀者迁移后 publisher 已不接收该 option（release-publisher-service.cjs
// 只解构 builderService/logger/releasesDir/pointerWriter），传参留在活代码路径上，
// 制造「发布器会校验 sourceCommit」的误读（写入一致性 步骤4 死能力，F4/D9-1）。
// T-B3 同时钉死 publisher 的 options 解构白名单行为：多传的校验钩子不产生任何效果。
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createReleaseBuilderService } = require("../release-builder-service.cjs");
const { createReleasePublisherService } = require("../release-publisher-service.cjs");

const RUNTIME_SRC = fs.readFileSync(path.join(__dirname, "..", "release-runtime.cjs"), "utf8");
const ASSEMBLY_SRC = fs.readFileSync(path.join(__dirname, "..", "release-governance-assembly.cjs"), "utf8");

describe("G1/D9-1: release-runtime 死接线清零（绞杀者终式）", () => {
  it("runtime 源码不再出现 validateSourceCommit / sourceCommitProvider", () => {
    assert.ok(!RUNTIME_SRC.includes("validateSourceCommit"), "validateSourceCommit 死传参必须删除");
    assert.ok(!RUNTIME_SRC.includes("sourceCommitProvider"), "sourceCommitProvider 随死传参一并退役");
  });

  it("assembly 不再注入 sourceCommitProvider", () => {
    assert.ok(!ASSEMBLY_SRC.includes("sourceCommitProvider"), "assembly 传参随 runtime 退役删除");
  });
});

describe("G1/D9-1: publisher options 解构白名单（回归守卫）", () => {
  let releasesDir;

  before(() => {
    releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-whitelist-"));
  });

  after(() => {
    // builder 把 release 目录树 chmod 成只读（0o555/0o444），直接 rmSync 必 ENOTEMPTY——
    // 清理前先递归还目录写权限（独立验证者发现的测试卫生缺陷，2026-08-31）。
    try { chmodTreeWritable(releasesDir); } catch { /* best-effort */ }
    fs.rmSync(releasesDir, { recursive: true, force: true });
  });

  function chmodTreeWritable(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) chmodTreeWritable(p);
    }
    fs.chmodSync(dir, 0o700);
  }

  it("多传 validateSourceCommit（恒 false）不影响指针恢复——发布器不校验 sourceCommit", () => {
    const builderService = createReleaseBuilderService({ releasesDir });
    const built = builderService.build({
      sourceCommit: crypto.randomBytes(20).toString("hex"),
      buildConfiguration: { note: "whitelist-guard" },
      artifacts: { "wiki/entities/a.md": "# a\n" },
    });
    const pointerWrites = [];
    const publisherService = createReleasePublisherService({
      builderService,
      releasesDir,
      validateSourceCommit: () => false, // 若发布器真在校验 sourceCommit，恢复会在此失败
      pointerWriter: (temp, target, bytes) => pointerWrites.push({ temp, target, bytes }),
    });
    const pointer = publisherService.restoreCurrent({ releaseId: built.releaseId });
    assert.equal(pointer.restored, true);
    assert.equal(pointer.releaseId, built.releaseId);
    assert.equal(pointerWrites.length, 1);
    assert.ok(pointerWrites[0].target.endsWith("current.json"));
    assert.ok(pointerWrites[0].bytes.includes(built.releaseId));
  });
});
