// seq195 发现①回归锚（独立验证 BLOCKED 报告驱动）：assertSourceUnchanged 的 64-hex 真实形态行为测试。
// 背景：seq195 收敛 sha256 捕获组正则时曾引入 slice(8)（"sha256:" 前缀实长 7）——
//   storedHash(63) !== currentHash(64) 恒真 → 源未变也恒抛 ARTICLE_REVISION_CONFLICT 409 假冲突。
//   既有 38 用例的假 hash（sha256:<短label>）不过 SNAPSHOT_HASH_PATTERN 提前 return，回归路径不可见——
//   本文件用 64-hex 真实形态堵该盲区（规则 28 证据直接性：测试必须覆盖真实生产输入形态）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createApprovalStateMachine } = require("../release-governance/approval-state-machine-service.cjs");

const SOURCE = "知识库/raw/precleaned/a1.md";
const RAW = "# A1\n正文";
const REAL_HASH = crypto.createHash("sha256").update(RAW).digest("hex"); // 64-hex 真实形态

function fixture(formalContentHash) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-source-unchanged-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-pin-"); // Master 加固批：镜像写通道钉 /tmp
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE), RAW, "utf8");
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, warn() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash }),
  });
  return { dir, sm };
}

function cleanTmp(dir) {
  const store = path.join(dir, ".ledger");
  for (const name of fs.readdirSync(store)) if (name.includes(".tmp")) fs.rmSync(path.join(store, name), { force: true });
}

test("slice(7) equivalence anchor: storedHash extracted from 64-hex revision equals capture group", async () => {
  const revision = `sha256:${REAL_HASH}`;
  assert.strictEqual("sha256:".length, 7);
  assert.strictEqual(revision.slice(7).length, 64);
  assert.strictEqual(revision.slice(7), REAL_HASH);
});

test("source UNCHANGED (64-hex real form) passes confirm without 409 false conflict", async () => {
  const { dir, sm } = fixture(REAL_HASH);
  try {
    await sm.transition("a1", "standardize", { sourcePath: SOURCE });
    // 回归：slice(8) 时代此处恒抛 ARTICLE_REVISION_CONFLICT（storedHash 63 字符）
    await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
    assert.ok(true);
  } finally {
    cleanTmp(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("source CHANGED between standardize and confirm still throws ARTICLE_REVISION_CONFLICT 409", async () => {
  const changedHash = crypto.createHash("sha256").update("# A1\n被改动的正文").digest("hex");
  assert.notStrictEqual(changedHash, REAL_HASH);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-source-unchanged-"));
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE), RAW, "utf8");
  // 两阶段 probe：standardize 时源=RAW（revision 存 REAL_HASH）；confirm 时源文件已变（probe 返回 changedHash）
  let phase = "standardize";
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, warn() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: phase === "standardize" ? REAL_HASH : changedHash }),
  });
  try {
    await sm.transition("a1", "standardize", { sourcePath: SOURCE });
    phase = "confirm";
    await assert.rejects(
      () => sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH }),
      (error) => error.code === "ARTICLE_REVISION_CONFLICT" && error.status === 409,
    );
  } finally {
    cleanTmp(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy non-64-hex revision label short-circuits assertSourceUnchanged without new errors", async () => {
  const { dir, sm } = fixture(REAL_HASH);
  try {
    // 显式 revision 直存 state（runStandardizationPipeline 对显式 input.revision 不覆盖）——legacy 形态 sha256:rev1
    await sm.transition("a1", "standardize", { sourcePath: SOURCE, revision: "sha256:rev1" });
    // assertSourceUnchanged：revision 不过 SNAPSHOT_HASH_PATTERN → 提前 return（短路）→ confirm 经客户端 contentHash 通道放行
    const result = await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
    assert.strictEqual(result.status, "approved");
  } finally {
    cleanTmp(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
