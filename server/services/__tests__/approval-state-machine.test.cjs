const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitFixtureEnv } = require("../../../scripts/quality/shared/git-fixture-env.cjs");
const { createApprovalStateMachine } = require("../release-governance/approval-state-machine-service.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

function fixtureVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-test-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-pin-"); // Master 加固批：镜像写通道钉 /tmp
  // 默认 probe：文章已标准化（有哈希）——主链路测试通过
  const standardizationProbe = () => ({ standardizationStatus: "standardized", formalContentHash: "abc".padEnd(64, "0") });
  return { dir, sm: createApprovalStateMachine({ vaultPath: dir, logger: { info(){}, error(){} }, standardizationProbe }) };
}

// 未标准化场景：probe 返回 pending_standardization（无哈希）
function fixtureUnstandardized() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-test-"));
  const standardizationProbe = () => ({ standardizationStatus: "pending_standardization", formalContentHash: null });
  return { dir, sm: createApprovalStateMachine({ vaultPath: dir, logger: { info(){}, error(){} }, standardizationProbe }) };
}

// 文章不存在场景：probe 返回 null
function fixtureMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-test-"));
  const standardizationProbe = () => null;
  return { dir, sm: createApprovalStateMachine({ vaultPath: dir, logger: { info(){}, error(){} }, standardizationProbe }) };
}

test("主链路：standardize→confirm→publish 状态流转（B1 重写：releaseId 唯一来源=publishArticle）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-test-"));
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库/raw/precleaned/a1.md"), "# A1\n正文", "utf8");
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: "abc".padEnd(64, "0") }),
    publishArticle: () => ({ releaseId: "release-x", snapshotPath: "y" }),
  });
  await sm.transition("a1", "standardize", { revision: "sha256:rev1", sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(sm.getStatus("a1").status, "pending");
  // B2/D2：confirm 证据经 sourcePath 服务端现算（真实哈希绑定，publish 来源重验的对照锚）
  await sm.transition("a1", "confirm", { revision: "sha256:rev1", sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(sm.getStatus("a1").status, "approved");
  const result = await sm.transition("a1", "publish", { revision: "sha256:rev1", sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(result.status, "snapshot");
  assert.equal(result.releaseId, "release-x", "releaseId 只能来自 publishArticle 返回值");
  assert.equal(sm.getStatus("a1").status, "snapshot");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("非法转移 fail-closed（approved 后不能再次 confirm）", async () => {
  const { dir, sm } = fixtureVault();
  await sm.transition("a1", "standardize", { revision: "sha256:r" });
  await sm.transition("a1", "confirm", { revision: "sha256:r", contentHash: "abc" });
  await assert.rejects(() => sm.transition("a1", "confirm", { revision: "sha256:r", contentHash: "abc" }), { code: "STATE_TRANSITION_FORBIDDEN" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("乐观锁：来源 revision 变化拒绝 confirm（ARTICLE_REVISION_CONFLICT）", async () => {
  const { dir, sm } = fixtureVault();
  await sm.transition("a1", "standardize", { revision: "sha256:rev1" });
  await assert.rejects(() => sm.transition("a1", "confirm", { revision: "sha256:rev2", contentHash: "abc" }), { code: "ARTICLE_REVISION_CONFLICT" });
  await sm.transition("a1", "confirm", { revision: "sha256:rev1", contentHash: "abc" }); // 同 revision 通过
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejected 可修改重提（resubmit → pending）", async () => {
  const { dir, sm } = fixtureVault();
  await sm.transition("a1", "standardize");
  await sm.transition("a1", "reject", { contentHash: "abc" });
  assert.equal(sm.getStatus("a1").status, "rejected");
  await sm.transition("a1", "resubmit", { revision: "sha256:new" });
  assert.equal(sm.getStatus("a1").status, "pending");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("审计记录：decisions.jsonl 追加且 schema 复用 normalizeDecision", async () => {
  const { dir, sm } = fixtureVault();
  await sm.transition("a1", "standardize");
  await sm.transition("a1", "confirm", { contentHash: "abc" });
  const lines = fs.readFileSync(path.join(dir, ".ledger", "decisions.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.decision, "approved");
  assert.equal(entry.contentHash, "abc");
  assert.ok(entry.decisionId);
  assert.ok(entry.decidedAt);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("证据绑定兜底：confirm 缺 contentHash 时从 sourcePath 文件现算 sha256", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asm-fallback-"));
  const vaultPath = path.join(tmp, "vault");
  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库/raw/precleaned/强制入主.md"), "# 强制入主\n正文内容", "utf8");
  const sm = createApprovalStateMachine({ vaultPath, logger: {} });
  await sm.transition("强制入主", "standardize");
  // 不传 contentHash，只传 sourcePath → 服务端从文件现算
  const result = await sm.transition("强制入主", "confirm", { sourcePath: "知识库/raw/precleaned/强制入主.md" });
  assert.equal(result.status, "approved");
  const lines = fs.readFileSync(path.join(vaultPath, ".ledger/decisions.jsonl"), "utf8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  assert.equal(entry.decision, "approved");
  assert.match(entry.contentHash, /^[0-9a-f]{64}$/);
  const expected = require("node:crypto").createHash("sha256").update("# 强制入主\n正文内容").digest("hex");
  assert.equal(entry.contentHash, expected, "应从源文件现算哈希");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("源头校验：未标准化文章 standardize → 409 ARTICLE_NOT_STANDARDIZED", async () => {
  const { dir, sm } = fixtureUnstandardized();
  await assert.rejects(() => sm.transition("a1", "standardize"), { code: "ARTICLE_NOT_STANDARDIZED" });
  assert.equal(sm.getStatus("a1").status, "draft", "状态不得改变");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("源头校验：文章不存在 standardize → 409 ARTICLE_NOT_STANDARDIZED", async () => {
  const { dir, sm } = fixtureMissing();
  await assert.rejects(() => sm.transition("a1", "standardize"), { code: "ARTICLE_NOT_STANDARDIZED" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI：standardize 不再产快照（PD-2：snapshotArticle 不被调用）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-snap-"));
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库/raw/precleaned/a1.md"), "# A1\n正文", "utf8");
  const snapCalls = [];
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info(){}, error(){} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: "a".repeat(64) }),
    snapshotArticle: (article) => { snapCalls.push(article); return { snapshotPath: "知识库/wiki/articles/x.md" }; },
  });
  await sm.transition("a1", "standardize", { sourcePath: "知识库/raw/precleaned/a1.md", contentHash: "a".repeat(64), title: "A1" });
  assert.equal(snapCalls.length, 0, "SPEC-030 派②（PD-2）：standardize 管线不写快照——快照物理写唯一驱动＝publish");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI：publish 真打包（publishArticle 被调用，releaseId 真实值）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-pub-"));
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库/raw/precleaned/a1.md"), "# A1\n正文", "utf8");
  const pubCalls = [];
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info(){}, error(){} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: "b".repeat(64) }),
    publishArticle: (article) => { pubCalls.push(article); return { releaseId: "release-abc", manifestHash: "sha256:x", snapshotPath: "知识库/wiki/articles/y.md" }; },
  });
  await sm.transition("a1", "standardize", { sourcePath: "知识库/raw/precleaned/a1.md", contentHash: "b".repeat(64) });
  // B2/D2：confirm 证据经 sourcePath 服务端现算（客户端假哈希不再是对照锚）
  await sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" });
  const result = await sm.transition("a1", "publish", { contentHash: "b".repeat(64), sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(pubCalls.length, 1, "publish 应调用 publishArticle");
  assert.equal(result.releaseId, "release-abc", "releaseId 应为真实值（非 null）");
  assert.equal(sm.getStatus("a1").status, "snapshot");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("红灯：confirm 应把审批凭据存进 record 且 publish 传给 publishArticle", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-red-"));
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库/raw/precleaned/a1.md"), "# A1\n正文", "utf8");
  // 确定性身份源：fixture 目录本身是 git 仓，服务端 resolveDecidedBy 以 cwd=vaultPath
  // 读 git config（仓库本地配置恒优先于全局）——CI runner 无全局 git 身份时结果依旧稳定，
  // 不得回落写死的 local-architect。
  execFileSync("git", ["init", "-q"], { env: gitFixtureEnv(process.env), cwd: dir});
  execFileSync("git", ["config", "user.name", "红灯测试架构师"], { env: gitFixtureEnv(process.env), cwd: dir});
  execFileSync("git", ["config", "user.email", "red-fixture@invalid"], { env: gitFixtureEnv(process.env), cwd: dir});
  const pubCalls = [];
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info(){}, error(){} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: "c".repeat(64) }),
    publishArticle: (article) => { pubCalls.push(article); return { releaseId: "release-red", manifestHash: "sha256:x", snapshotPath: "x" }; },
  });
  await sm.transition("a1", "standardize", { sourcePath: "知识库/raw/precleaned/a1.md", contentHash: "c".repeat(64) });
  // B2/D2：confirm 证据经 sourcePath 服务端现算
  await sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" });
  await sm.transition("a1", "publish", { contentHash: "c".repeat(64), sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(pubCalls.length, 1);
  assert.ok(pubCalls[0].approval, "publish 的 article 应带 approval 审批凭据");
  assert.ok(pubCalls[0].approval.decidedBy, "approval.decidedBy 应为真实操作者");
  assert.equal(pubCalls[0].approval.decidedBy, "红灯测试架构师 <red-fixture@invalid>", "decidedBy 应解析为 fixture 仓 git 身份（而非写死 local-architect）");
  assert.ok(pubCalls[0].approval.decidedAt, "approval.decidedAt 应为审批时间");
  assert.equal(pubCalls[0].approval.contentHash, require("node:crypto").createHash("sha256").update("# A1\n正文").digest("hex"), "approval.contentHash 应为源文件现算哈希（非客户端自报）");
  fs.rmSync(dir, { recursive: true, force: true });
});

// S3 红灯：confirm 必须重算源哈希（standardizationProbe）——文章源文件变化后，
// 用旧 revision 调 confirm 必须 409 ARTICLE_REVISION_CONFLICT（旧审批资格失效），
// 而不是凭「调用方传入 revision == 存储 revision」放行（approval-state-machine-service.cjs:132-140 缺陷）。
test("S3 红灯：confirm 重算源哈希——来源变化使旧审批资格失效（ARTICLE_REVISION_CONFLICT）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-s3-red-"));
  let probeHash = "a".repeat(64); // standardize 时源哈希
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: probeHash }),
  });
  await sm.transition("a1", "standardize"); // 未传 revision → 存储 revision = sha256:aaa…
  probeHash = "b".repeat(64); // 源文件已变化（probe 返回新哈希）
  // 用旧 revision 调 confirm：调用方 revision 与存储 revision 一致，但源已变化 → 必须 409
  await assert.rejects(
    () => sm.transition("a1", "confirm", { revision: `sha256:${"a".repeat(64)}`, contentHash: "a".repeat(64) }),
    { code: "ARTICLE_REVISION_CONFLICT" },
    "源变化后旧 revision 的 confirm 应 409 ARTICLE_REVISION_CONFLICT",
  );
  // 不传 revision（只传 contentHash）同样必须 409——重算源哈希是 confirm 的固有职责，不能依赖调用方传旧 revision
  await assert.rejects(
    () => sm.transition("a1", "confirm", { contentHash: "a".repeat(64) }),
    { code: "ARTICLE_REVISION_CONFLICT" },
    "源变化后无 revision 的 confirm 也应 409 ARTICLE_REVISION_CONFLICT",
  );
  assert.equal(sm.getStatus("a1").status, "pending", "来源变化后状态不得推进到 approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

// S3 绿灯伴随：源未变化时 confirm 正常通过（probe 当前哈希 == 存储 revision）
test("S3 绿灯：源未变化时 confirm 正常通过（probe 哈希 == 存储 revision）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-s3-ok-"));
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: "d".repeat(64) }),
  });
  await sm.transition("a1", "standardize");
  const result = await sm.transition("a1", "confirm", { contentHash: "d".repeat(64) });
  assert.equal(result.status, "approved");
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

// S3 边界：probe 返回 null（文章不存在/探针不可用）→ 不额外拦截（保持 assertRevision 调用方协议），
// revision 一致时 confirm 正常通过——源哈希重算只在「存储 revision 与 probe 哈希均为 64 位 hex」时可验证时生效。
test("S3 边界：probe 返回 null 时不额外拦截（revision 一致则 confirm 通过）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-s3-null-"));
  let probeOk = true; // standardize 时 probe 有效（否则 standardize 自身会 ARTICLE_NOT_STANDARDIZED）；confirm 时模拟探针不可用
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => (probeOk ? { standardizationStatus: "standardized", formalContentHash: "e".repeat(64) } : null),
  });
  await sm.transition("a1", "standardize"); // 存储 revision = sha256:eee…
  probeOk = false; // confirm 时 probe 返回 null（源暂不可验证）
  const result = await sm.transition("a1", "confirm", { revision: `sha256:${"e".repeat(64)}` });
  assert.equal(result.status, "approved", "probe 不可验证时不应被源哈希重算拦截");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── PR-047：pending 态源文件变化的重绑恢复路径 ──

test("PR-047：pending 态源变化 → 重新标准化重绑 revision → confirm 放行", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-p047-rebind-"));
  let currentHash = "a".repeat(64);
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: currentHash }),
  });
  await sm.transition("a1", "standardize"); // 绑定 sha256:aaa…
  currentHash = "b".repeat(64);       // 源文件变化（文章准入页已重新标准化，probe 现给新哈希）
  const rebound = await sm.transition("a1", "standardize"); // PR-047：pending 态合法重绑
  assert.equal(rebound.status, "pending", "重绑后仍回待审");
  const stored = getRuntimeStateStore(dir).approval.get("a1"); // PR-047 用例：状态账本经 runtime-state store 读取（SPEC-012 WP-A）
  assert.equal(stored.revision, `sha256:${"b".repeat(64)}`, "revision 已由机器重绑到新哈希");
  const result = await sm.transition("a1", "confirm", { revision: `sha256:${"b".repeat(64)}` });
  assert.equal(result.status, "approved", "重绑后 confirm 不再被源哈希重算拦截");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PR-047：pending 态源变化但未重新标准化 → confirm 仍 409（fail-closed 保持）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-p047-stale-"));
  let currentHash = "a".repeat(64);
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: currentHash }),
  });
  await sm.transition("a1", "standardize");
  currentHash = "b".repeat(64); // 源变化，但没走重绑
  await assert.rejects(() => sm.transition("a1", "confirm"),
    (e) => e.code === "ARTICLE_REVISION_CONFLICT" && e.status === 409,
    "未重绑前 confirm 必须仍被拦截");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PR-047：pending 态源变化但候选未重新标准化（probe 非 standardized）→ standardize 被拒", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-p047-notstd-"));
  let probeState = { standardizationStatus: "standardized", formalContentHash: "a".repeat(64) };
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, error() {} },
    standardizationProbe: () => probeState,
  });
  await sm.transition("a1", "standardize");
  probeState = { standardizationStatus: "pending_standardization", formalContentHash: null }; // 源变化后已降级未重标准化
  await assert.rejects(() => sm.transition("a1", "standardize"),
    (e) => e.code === "ARTICLE_NOT_STANDARDIZED" && e.status === 409,
    "probe 未标准化时重绑必须 fail-closed");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── B3 机器校验闸门：confirm 前 validation_status fail-closed（对齐 promote-article.py:292-299）──

function writeDraftWithFrontmatter(dir, name, fm) {
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库/raw/precleaned/" + name), fm + "\n# 正文\n", "utf8");
}

test("B3：validation_status=failed 且无 override → confirm 被拒（fail-closed 409）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-fail-"));
  writeDraftWithFrontmatter(dir, "a1.md", `---
title: A1
validation_status: failed
validation_errors: 3
---`);
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  await assert.rejects(() => sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" }),
    (e) => e.code === "ARTICLE_VALIDATION_FAILED" && e.status === 409);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B3：failed 但 validation_override=true → confirm 放行（人工豁免留痕）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-override-"));
  writeDraftWithFrontmatter(dir, "a1.md", `---
title: A1
validation_status: failed
validation_override: true
---`);
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  const result = await sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(result.status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

// WP-116 红队修复批（P1-1）：override 行尾注释形态两案——手工实测宿主 docField 语义后钉方向：
// yaml 库按 YAML 规范剥离行尾注释，`true # 注释` 仍解析为布尔 true（豁免生效）；`false # 注释`
// 解析为布尔 false（不豁免，落入现场机器校验）。夹具同上案（无 TheSchema 回落真字典，现场必败）。
test("B3：failed 但 validation_override=true # 操作者已裁定（行尾注释）→ confirm 放行（豁免咬注释形态）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-ovr-cmt-"));
  writeDraftWithFrontmatter(dir, "a1.md", `---
title: A1
validation_status: failed
validation_override: true # 操作者已裁定
---`);
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  // 夹具现场机器校验必败（同上案）——若注释形态未被豁免咬住，此处即 ARTICLE_VALIDATION_FAILED
  const result = await sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(result.status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B3：failed 且 validation_override=false # 注释（行尾注释的 false）→ confirm 被拒（注释不造豁免）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-false-cmt-"));
  writeDraftWithFrontmatter(dir, "a1.md", `---
title: A1
validation_status: failed
validation_override: false # 注释
---`);
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  await assert.rejects(() => sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" }),
    (e) => e.code === "ARTICLE_VALIDATION_FAILED" && e.status === 409);
  fs.rmSync(dir, { recursive: true, force: true });
});

// PR-158 批次一：B3 现场计算后，旧「章语义」测试需自含 TheSchema 最小真身——否则回落仓内真字典，
// 夹具文章现场必败（新律让夹具假绿现形）。最小字典：title/product 必填＋products 闭合枚举。
function writeMinimalSchema(dir) {
  const schemaDir = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "fields.yaml"), [
    "schema_version: 1",
    "last_updated: \"2026-10-30\"",
    "fields:",
    "  - name: title",
    "    label: 标题",
    "    type: string",
    "    required: 是",
    "    scope: [article]",
    "    layer: 内容属性",
    "    value_domain: { source: free, note: 自由标题 }",
    "  - name: product",
    "    label: 产品",
    "    type: string",
    "    required: 是",
    "    scope: [article]",
    "    layer: 业务属性",
    "    value_domain: { source: products }",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), "products:\n  - 通用\n");
  process.env.THESCHEMA_DIR = schemaDir; // repo-schema-io 钉扎领地：tmp vault 写解析物的合法通道（同 b3-receipt 夹具）
  execFileSync("node", [path.resolve(__dirname, "..", "..", "..", "scripts", "quality", "project-resolved-domains.mjs")], { stdio: "pipe", env: { ...process.env, VAULT_PATH: dir } });
  return schemaDir;
}

const VALID_FM = (stamp) => `---
title: A1
product: 通用
article_id: a1
${stamp}---
`;

test("B3（新律·收据）：旧章 passed 但现场合法 → 放行（章不裁决）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-pass-"));
  writeMinimalSchema(dir);
  writeDraftWithFrontmatter(dir, "a1.md", VALID_FM("validation_status: passed\n"));
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  const result = await sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(result.status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B3（新律·收据）：legacy 无章 → 现场计算裁决（内容合法即放行）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-legacy-"));
  writeMinimalSchema(dir);
  writeDraftWithFrontmatter(dir, "a1.md", VALID_FM(""));
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  const result = await sm.transition("a1", "confirm", { sourcePath: "知识库/raw/precleaned/a1.md" });
  assert.equal(result.status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B3：confirm 未传 sourcePath → 闸门不生效（源不可定位时不重复判定，publish 前置准入兜底）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-b3-nopath-"));
  writeDraftWithFrontmatter(dir, "a1.md", `---
title: A1
validation_status: failed
---`);
  const sm = createApprovalStateMachine({ vaultPath: dir, logger: { info() {}, error() {} }, standardizationProbe: null });
  await sm.transition("a1", "standardize");
  // 无 sourcePath：闸门跳过；contentHash 证据由显式 revision 提供（publish 阶段有 PUBLISH_SOURCE_UNAVAILABLE 兜底）
  const result = await sm.transition("a1", "confirm", { revision: `sha256:${"f".repeat(64)}` });
  assert.equal(result.status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── WP-116 批1 行为钉：readCategoryPath 切分改经文档装载宿主（loadDocument＋docField）——
// publish 落位域段输入对边界输入的产出与迁移前基线探针实测对照：无 frontmatter/空文件/
// 空块/未闭合回空；多 --- 只取第一块；CRLF 同为可解析（旧正则同为容忍）；数字标量按文本；
// 单 token 全行锚定保持（含空白多词值回空，fail-closed 交落位口）。
test("WP-116 readCategoryPath 边界钉：宿主切分与旧正则同产出（含如实差异）", () => {
  const { dir, sm } = fixtureVault();
  try {
    const rcp = sm.readCategoryPath;
    assert.equal(rcp("正文没有frontmatter\n"), "");
    assert.equal(rcp(""), "");
    assert.equal(rcp("---\n---\nbody"), "");
    assert.equal(rcp("---\ntitle: t\ncategory-path: 架构:api\n---\n正文\n---\ncategory-path: 别域:x\n---\n"), "架构:api", "多 --- 只取第一块");
    assert.equal(rcp("---\r\ncategory-path: 架构:api\r\n---\r\n正文"), "架构:api", "CRLF 同为可解析（旧正则同为容忍）");
    assert.equal(rcp("---\ncategory-path: 789\n---\nbody"), "789", "数字标量按文本");
    assert.equal(rcp("---\ncategory-path: 架构 api\n---\nbody"), "", "含空白多词值回空（单 token 锚定保持，fail-closed 交落位口）");
    assert.equal(rcp("---\ncategory-path: [架构]\n---\nbody"), "", "数组形态回空（旧正则不匹配同回空）");
    // 如实差异①：引号值宿主按 YAML 规范去引号（旧正则原样带回引号字符→落位口判非受管域；
    // 口径收敛后被引号误伤的合法值恢复可落位）
    assert.equal(rcp("---\ncategory-path: \"架构:api\"\n---\nbody"), "架构:api");
    // 如实差异②：空值链旧正则 \s* 跨行泄漏抓到下一行键名——宿主按 YAML 空值回空（堵泄漏）
    assert.equal(rcp("---\ncategory-path:\nvalidation_override:\n---\nbody"), "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
