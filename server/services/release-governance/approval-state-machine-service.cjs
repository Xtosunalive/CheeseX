// Component: Approval-State-Machine-Service
// @responsible: Plan-B 审批状态机——替代 ADR020 Git Proposal 变更机制（ADR043 D2'/D4'）
// @inputs: 候选文件状态、审批动作（含重新标准化恢复）、来源 revision
// @outputs: 状态转移 + decisions.jsonl 追加审计
// @context: Vault
//
// 设计决策（ADR043，落死无二选一）：
// - approve（批准）与 publish（发布/打包快照）分离：approve 只改状态到 approved，publish 是独立动作到 snapshot
// - rejected 可修改重提（对齐 proposal REJECTION_PENDING，非 anomaly 纯审计）
// - 复用 anomaly-workbench APPROVAL_TRANSITIONS 集中转移表模式（规则 8 单源）
// - decisions.jsonl 记录复用 article-workflow-store normalizeDecision 字段集
// - 乐观锁复用 ARTICLE_REVISION_CONFLICT 模式（提交时校验来源 revision）
const crypto = require("node:crypto");
const { SNAPSHOT_HASH_PATTERN } = require("../../shared/version-contract.cjs"); // seq195：sha256 形状单源
const fs = require("node:fs");
const path = require("node:path");
const { normalizeDecision } = require("../article-workflow/article-workflow-store.cjs");
const { runCommand } = require("../../shared/async-exec.cjs"); // PR-056：审批人 git 身份读取异步化
const { createArticleValidator, computeRulesHash } = require("../../../scripts/vault-runtime/article-validator-lib.cjs"); // PR-158 批次一：B3 现场计算——裁决权收回唯一校验器

const STATUSES = ["draft", "pending", "approved", "rejected", "snapshot"];

// 集中转移表（规则 8 单源）：operation → 允许起始状态
const APPROVAL_TRANSITIONS = {
  // PR-047：standardize 增加 pending 起点——pending 态源文件变化后旧 revision 绑定失效，
  // 原先只有 draft 能走 standardize，pending 无任何合法路径刷新绑定 → 永久卡死（只能伪造驳回或手改账本）。
  // 语义：pending 态重新标准化 = 重新走 probe 校验 + 重快照 + revision 机器重绑，仍回 pending 待审；
  // fail-closed 不变——probe 显示未标准化（standardizationStatus !== "standardized"）照常 ARTICLE_NOT_STANDARDIZED 拒绝。
  standardize: ["draft", "pending", "approved"], // approved恢复条件见SPEC-080；正常批准未变化不撤销
  confirm: ["pending"],                      // 架构师确认：pending → approved（不写回）
  reject: ["pending"],                       // 架构师驳回：pending → rejected（可修改重提）
  resubmit: ["rejected"],                    // 投稿人修改后重新提交：rejected → pending
  publish: ["approved"],                     // 发布/打包快照：approved → snapshot（独立动作）
};

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, appendVaultJsonl } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）
// SPEC-012 WP-A：审批状态账本（③类）迁 runtime-state.db；decisions.jsonl（⑤类）留 vault 至 WP-I
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
// WP-116 批1（SPEC-083 §二.1）：`---` 边界切分与键直取收进文档装载宿主（docField 六态）
const { loadDocument, docField } = require("../../shared/document-load-port.cjs");
const stateError = bindErrorFactory({ status: 409 });

// 转移合法性校验（fail-closed 409，仿 anomaly assertOperationPrecondition）
function assertTransition(operation, status) {
  const allowed = APPROVAL_TRANSITIONS[operation];
  if (!allowed) throw stateError("UNKNOWN_OPERATION", `未知审批操作: ${operation}`, 400);
  if (!allowed.includes(status)) {
    throw stateError("STATE_TRANSITION_FORBIDDEN", `操作 ${operation} 不允许从状态 ${status} 执行`, 409, { operation, status, allowed });
  }
}

function createApprovalStateMachine({ vaultPath, logger, standardizationProbe, publishArticle, snapshotArticle, recordFailure, gitLedger, runtimeState }) {
  const decisionsPath = path.join(vaultPath, ".ledger", "decisions.jsonl");
  // SPEC-012 WP-A：状态账本经 runtime-state store（真事务）；recordPath 随迁移退役
  const approvalStore = (runtimeState || getRuntimeStateStore(vaultPath)).approval;
  // SPEC-010-W10 WP2：审批写回（决策审计/快照/发布产物）异步 git 落账；缺省 no-op
  // SPEC-012 WP-I：ledgerAnyshare 旁路落账退役——通道记账已含 decisions.jsonl（防同域双记）

  function readRecord(articleId) {
    return approvalStore.get(articleId) || null;
  }

  function writeRecord(articleId, record) {
    approvalStore.put(articleId, record);
  }

  function ensureStore() {
    fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
    if (!fs.existsSync(decisionsPath)) writeVaultExclusive(decisionsPath, "", { domain: "approval", summary: "决策流水初始化" }, { flag: "wx", mode: 0o600 }); // SPEC-012 WP-I：记账归通道（⑤类归位 git 提交流）
  }

  function getStatus(articleId) {
    ensureStore();
    const record = readRecord(articleId);
    return record ? { status: record.status, revision: record.revision, updatedAt: record.updatedAt } : { status: "draft", revision: null, updatedAt: null };
  }

  // 追加审计记录（decisions.jsonl，append-only；schema 复用 normalizeDecision 字段集）
  // 证据绑定（B2/D2）：服务端从源文件现算哈希为唯一权威；客户端传入值降级为交叉校验，
  // 不一致即 409 APPROVAL_EVIDENCE_STALE（内容已变化或证据陈旧——feature:83-88 场景⑥）。
  // 优先级：源文件现算 > 客户端 contentHash > sha256: revision；三者皆缺返回 null（INVALID_DECISION 兜底）。
  function resolveContentHash(input) {
    const clientHash = typeof input.contentHash === "string" && input.contentHash !== "" ? input.contentHash : null;
    let serverHash = null;
    if (typeof input.sourcePath === "string" && input.sourcePath !== "") {
      const abs = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(vaultPath, input.sourcePath);
      try { serverHash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"); } catch { serverHash = null; }
    }
    if (clientHash && serverHash && clientHash !== serverHash) {
      throw stateError("APPROVAL_EVIDENCE_STALE", "传入内容哈希与源文件现算值不一致（内容已变化或证据陈旧）", 409, { clientHash, actual: serverHash });
    }
    if (serverHash) return serverHash;
    if (clientHash) return clientHash;
    if (typeof input.revision === "string" && input.revision.startsWith("sha256:")) return input.revision.slice(7);
    return null;
  }
  // 审批人身份：优先显式传入；否则复用 git 身份（无登录但有身份，成熟先例 git commit author）
  async function resolveDecidedBy(input) { // PR-056：git config 读取异步化（请求路径禁同步子进程）
    if (input && typeof input.decidedBy === "string" && input.decidedBy.trim()) return input.decidedBy.trim();
    try {
      const name = (await runCommand("git", ["config", "--get", "user.name"], { cwd: vaultPath, encoding: "utf8" })).stdout.trim();
      const email = (await runCommand("git", ["config", "--get", "user.email"], { cwd: vaultPath, encoding: "utf8" })).stdout.trim();
      if (name) return email ? name + " <" + email + ">" : name;
    } catch (_error) { /* git 身份不可用则回退占位 */ }
    return "local-architect";
  }

  async function appendDecision(articleId, input, expectedRecord = null) { // PR-056：随 resolveDecidedBy 异步化
    const derivedHash = resolveContentHash(input);
    if (!derivedHash) throw stateError("INVALID_DECISION", "审批决策缺少 contentHash 证据绑定", 400);
    const decision = normalizeDecision({
      decisionId: crypto.randomUUID(),
      contentHash: derivedHash,
      decision: input.decision, // approved | rejected | standardized
      decidedAt: new Date().toISOString(),
      decidedBy: await resolveDecidedBy(input),
      proposalId: null, proposalCommit: null,
      checksId: input.checksId || null,
      previewHash: input.previewHash || null,
      rulesHash: input.rulesHash || null, // PR-158 批次一：审批现场计算的规则指纹（审计收据）
      releaseId: input.releaseId || null,
      sourceCommit: input.sourceCommit || null,
    });
    if (!decision) throw stateError("INVALID_DECISION", "审批决策字段不完整", 400);
    // B4/D5 幂等键（ADR043 增补节）：decisionId 确定性派生——len 分量（state 决策数）区分
    // 「状态写失败后的重试」（state 未推进 → 同键 → 跳过追加，返回既有决策）与「周期后再决策」
    // （reject 后 len 已变 → 必得新键，不吞真决策）；人工改文件等异常碰撞按既有键幂等处理（append-only 不改写）。
    const prior = readRecord(articleId);
    if (expectedRecord) {
      // 恢复请求在身份查询期间可能迟到；内容revision相同也可能已经重新确认并发布。
      // 比对完整状态后直到追加/提交之间不再await，不让旧请求覆盖新一轮审批。
      if (JSON.stringify(prior) !== JSON.stringify(expectedRecord)) {
        throw stateError("ARTICLE_REVISION_CONFLICT", "审批状态已变化，请刷新后重新判断恢复操作", 409, {
          expected: typeof expectedRecord.revision === "string" ? expectedRecord.revision : "",
          actual: prior && typeof prior.revision === "string" ? prior.revision : "",
        });
      }
      const latest = runStandardizationPipeline(articleId, {}, { ...input, revision: undefined }, "standardize");
      if (!latest || latest.formalContentHash !== derivedHash || resolveContentHash(input) !== derivedHash) {
        throw stateError("ARTICLE_REVISION_CONFLICT", "标准化内容已变化，请刷新后重新标准化", 409, {
          expected: derivedHash, actual: latest && typeof latest.formalContentHash === "string" ? latest.formalContentHash : "",
        });
      }
    }
    const dayBucket = new Date().toISOString().slice(0, 10);
    decision.decisionId = crypto
      .createHash("sha256")
      .update([articleId, input.decision, derivedHash, prior ? prior.decisions.length : 0, dayBucket].join("|"))
      .digest("hex");
    if (fs.existsSync(decisionsPath)) {
      for (const line of fs.readFileSync(decisionsPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && parsed.decisionId === decision.decisionId) return parsed;
        } catch (_error) { /* 半行写入容忍：跳过不可解析行 */ }
      }
    }
    const entry = JSON.stringify({ articleId, ...decision });
    appendVaultJsonl(decisionsPath, `${entry}\n`, { domain: "approval", summary: "决策流水追加", fsOptions: { encoding: "utf8" } }); // SPEC-012 WP-I：记账归通道
    // 裁定账本仓内只读镜像（Master 2026-10-19「做」）：写侧零改动，追加后 fire-and-forget 刷新镜像
    try {
      const { mirrorDecisions } = require("../../shared/decisions-mirror.cjs");
      const r = mirrorDecisions(vaultPath);
      if (!r.mirrored && r.error) logger.warn({ event: "decisions-mirror-refresh-failed", error: r.error });
    } catch (e) { /* best-effort——镜像自愈三时机之一，失败由钩子/手动兜底 */ }
    return decision;
  }

  // B4/D5（ADR043 增补节）：状态（指针语义）写失败 = 状态保旧值 + recordFailure 落持久 Issue +
  // 幂等重试（审计先行已落盘，重试经 decisionId 幂等键不双记）。错误照常上抛给调用方。
  function writeRecordChecked(articleId, current) {
    try {
      writeRecord(articleId, current);
    } catch (error) {
      if (typeof recordFailure === "function") {
        try { recordFailure("approval-state-write", { proposalId: articleId, sourceCommit: null }, error); } catch (_ignored) { /* Issue 落盘失败不掩盖原错误 */ }
      }
      if (logger && typeof logger.warn === "function") logger.warn(`[approval-state-machine] 状态写入失败（${articleId}）：${error.message}`);
      throw error;
    }
  }

  // 乐观锁：校验来源 revision（复用 ARTICLE_REVISION_CONFLICT 模式）
  // PR-201 注记（Master「都按推荐办」维持 WP-022 已签收形态）：本闸「缺省不锁」是 2026-10 WP-022
  // 签收的存量调用零行为变化形态（workflow_state/anomaly 族），不随 TheSchema 家族的 SCHEMA_REVISION_REQUIRED
  // 严闸收紧——如需归一属产品语义另裁，不得以「统一闸形」名义静默改已签收行为。
  function assertRevision(record, expectedRevision) {
    if (!expectedRevision) return;
    if (record && record.revision && record.revision !== expectedRevision) {
      throw stateError("ARTICLE_REVISION_CONFLICT", "文章源文件已变化，请重新预览", 409, { expected: expectedRevision, actual: record.revision });
    }
  }

  // S3 修复（gherkin 场景⑥）：confirm 时重算源哈希（standardizationProbe），来源变化使旧审批资格失效。
  // assertRevision 只比对「调用方传入 revision vs 存储 revision」——调用方与存储同持旧 revision 时仍放行
  // 旧审批；这里用 probe 拿当前源 formalContentHash，与存储 revision 绑定的内容哈希比对，不一致 → 409。
  // 只拦截可验证的真实内容哈希：存储 revision 必须形如 sha256:<64hex>（standardize 时由 probe 派生，
  // 或调用方传入了真实内容哈希），且 probe 当前返回的 formalContentHash 也是 64 位十六进制。
  // 边界（保持现状，不额外拦截）：probe 返回 null（文章不存在/探针不可用）、formalContentHash 缺失
  // 或非 64 位 hex、存储 revision 非真实内容哈希（如测试的 sha256:rev1）——这些交给 assertRevision
  // 处理调用方协议，不做源哈希重算。
  function assertSourceUnchanged(articleId, current) {
    if (typeof standardizationProbe !== "function") return;
    const revision = current && typeof current.revision === "string" ? current.revision : "";
    // seq195：sha256 形状单源（version-contract.SNAPSHOT_HASH_PATTERN）；捕获组语义用 test+slice 等价实现（"sha256:" 前缀定长 7，slice(7) 即 64 位 hex 段——独立验证发现①修正：原 slice(8) 尾错位致假冲突恒抛）
    if (!SNAPSHOT_HASH_PATTERN.test(revision)) return;
    const storedHash = revision.slice(7);
    const info = standardizationProbe(articleId);
    const currentHash = info && typeof info.formalContentHash === "string" ? info.formalContentHash : null;
    if (!currentHash || !/^[0-9a-f]{64}$/.test(currentHash)) return;
    if (currentHash !== storedHash) {
      // PR-047：报错指向合法恢复路径（pending 态重新标准化刷新绑定），不再只说"重新预览"
      throw stateError("ARTICLE_REVISION_CONFLICT", "文章源文件已变化，旧审批绑定已失效；请先重新标准化刷新绑定，再确认", 409, { expected: storedHash, actual: currentHash });
    }
  }

  // B2/D3：标准化管线——standardize 与 resubmit 共用（probe 校验 → 快照 → revision 刷新），
  // 同一函数组合不写第二套（规则 30）；既有路径保持，approved 恢复边由 SPEC-080 增补。
  // snapshot contentHash 一律服务端现算（B2/D2：不采信客户端哈希）。
  function runStandardizationPipeline(articleId, current, input, entryLabel) {
    let standardized = null;
    if (typeof standardizationProbe === "function") {
      const info = standardizationProbe(articleId);
      if (!info || info.standardizationStatus !== "standardized" || !info.formalContentHash) {
        throw stateError("ARTICLE_NOT_STANDARDIZED",
          entryLabel === "resubmit"
            ? "文章尚未重新标准化（无新的正式内容哈希）；请修改后先重新标准化，再重新提交"
            : "文章尚未标准化（无正式内容哈希），不能进入待审；请先在文章准入页完成标准化",
          409, { articleId, observed: info ? { status: info.standardizationStatus, hasHash: Boolean(info.formalContentHash) } : null });
      }
      standardized = info;
      if (!input.revision && info.formalContentHash) current.revision = `sha256:${info.formalContentHash}`;
    }
    // SPEC-030 派②（PD-2，2026-10-28）：standardize/resubmit 不再写正式区快照——
    // 快照物理写唯一驱动＝publish 转移（publishArticle→snapshotArticle）；revision 绑定
    // 由 probe 的 formalContentHash 承担（内容哈希绑定不依赖物理快照存在）。
    void snapshotArticle;
    return standardized;
  }

  // SPEC-030 派②：从候选字节解析 category-path（publish 落位域段输入；解析失败回空——
  // resolveDomainSegment 对缺失 fail-closed，坏数据在落位口被拦）。
  // WP-116 批1：切分与键直取经宿主（loadDocument＋docField）；「单 token 才收」保持旧正则
  // （\S+$ 全行锚定）口径——含空白的多词值回空交落位口 fail-closed。
  function readCategoryPath(raw) {
    if (typeof raw !== "string") return "";
    const probe = docField(loadDocument(raw), "category-path");
    const value = probe.value;
    const text = typeof value === "string" ? value
      : (typeof value === "number" || typeof value === "boolean") ? String(value)
      : "";
    const trimmed = text.trim();
    return trimmed !== "" && !/\s/.test(trimmed) ? trimmed : "";
  }

  // 机器校验闸门（B3）：confirm（人裁定）前读候选文章 frontmatter 的 validation_status——
  // PR-158 批次一前语义：读章 failed 且无 validation_override 时 fail-closed 拒绝（promote-article.py 同源）；
  // 现语义见 assertValidationPassed 内注——现场计算裁决，章为收据。
  // 红线：机器校验是裁定的决策输入，人不得在机器校验失败且无显式 override 时盲批。
  // 宽容边界：frontmatter 不可解析/字段缺失（如 legacy 存量）不拦截（fail-closed 只对明确的 failed），
  // 与 promote-article 一致——存在性由 standardize 管线保证，这里只管"明确失败不得过"。
  // PR-158 批次一（副本→收据）：B3 现场计算——validation_* 章降级为审计收据（最近一次结论，仅展示），
  // 不再参与批准裁决。裁决权收回唯一校验器（article-validator-lib）：读当前字节＋当前规则现场算，
  // 规则变更（fields/enums）后旧章假绿在此构造性消失——旧章 passed 不放行，旧章 failed 也不误拦。
  // 人工豁免（validation_override=true）是真身侧的人工裁定事实（decisions 留痕），现场计算不推翻。
  function assertValidationPassed(articleId, input) {
    const rel = typeof input.sourcePath === "string" && input.sourcePath !== "" ? input.sourcePath : null;
    if (!rel) return null;
    const abs = path.isAbsolute(rel) ? rel : path.join(vaultPath, rel);
    let raw = null;
    try {
      if (fs.statSync(abs).isFile()) raw = fs.readFileSync(abs, "utf8");
    } catch { return null; } // 源不可读：交给后续 publish 前置准入拦截，不在此重复判定
    if (typeof raw !== "string") return null;
    // WP-116 批1：切分经宿主。「存在闭合 frontmatter 块」由宿主产物推断（无块/未闭合时 body＝原文
    // 未经切分；有闭合块时 body＝被切出并 trim 的后缀，恒短于原文）——保持旧口径的 legacy 宽容边界：
    // frontmatter 块不存在（含 `---` 起头但未闭合）→ 不做机器校验直接放行（与注释中 legacy 承诺一致）。
    const doc = loadDocument(raw);
    const hasFrontmatterBlock = doc.body !== raw;
    if (!hasFrontmatterBlock) return null;
    // 显式人工豁免（决策留痕于 decisions.jsonl）：YAML 布尔 true 才豁免——与旧正则（裸 true/false 全行
    // 锚定，引号串/非布尔不豁免）同口径；裸 false 落入下方机器校验，与旧口径一致。
    const override = docField(doc, "validation_override");
    if (override.state === "present" && override.value === true) return null;
    let fresh = null;
    try {
      fresh = createArticleValidator({ vaultPath }).validateFile(abs);
    } catch (error) {
      // 校验器致命态（规则投影缺失/损坏）＝fail-closed：不误判通过也不裸 500（对齐 VALIDATOR_UNAVAILABLE 语义）
      throw stateError("VALIDATOR_UNAVAILABLE", "机器校验器不可用（" + (error && error.message ? error.message : "未知") + "）——审批 fail-closed，先修复校验规则环境", 503, { articleId });
    }
    const freshErrors = fresh && Array.isArray(fresh.errors) ? fresh.errors : [];
    if (freshErrors.length > 0) {
      throw stateError("ARTICLE_VALIDATION_FAILED",
        "机器校验（审批现场计算）未通过且无人工豁免，不得批准——历史校验章仅为审计收据，不作为放行依据；请按现场错误修复后重试",
        409, { articleId, errors: freshErrors.slice(0, 5), rulesHash: computeRulesHash(vaultPath) });
    }
    return {
      verdict: freshErrors.length === 0 ? "passed" : "failed",
      contentHash: "sha256:" + crypto.createHash("sha256").update(raw).digest("hex"),
      rulesHash: computeRulesHash(vaultPath),
      decidedAt: new Date().toISOString(),
    };
  }

  async function transition(articleId, operation, input = {}) { // PR-056：随 appendDecision 异步化
    ensureStore();
    const current = readRecord(articleId) || { status: "draft", revision: input.revision || null, updatedAt: null, decisions: [] };
    assertTransition(operation, current.status);

    if (operation === "confirm") {
      assertRevision(current, input.revision);
      assertSourceUnchanged(articleId, current);
      const freshReceipt = assertValidationPassed(articleId, input); // B3：现场计算，失败且无豁免 → fail-closed
      const decision = await appendDecision(articleId, { ...input, decision: "approved", rulesHash: freshReceipt ? freshReceipt.rulesHash : null });
      current.status = "approved"; current.revision = input.revision || current.revision;
      current.updatedAt = new Date().toISOString(); current.decisions.push(decision.decisionId);
      current.approval = { decidedBy: decision.decidedBy, decidedAt: decision.decidedAt, contentHash: decision.contentHash };
      writeRecordChecked(articleId, current);
      return { status: "approved", decision, revision: current.revision, updatedAt: current.updatedAt };
    }

    if (operation === "reject") {
      const decision = await appendDecision(articleId, { ...input, decision: "rejected" });
      current.status = "rejected"; current.updatedAt = new Date().toISOString(); current.decisions.push(decision.decisionId);
      writeRecordChecked(articleId, current);
      return { status: "rejected", decision, revision: current.revision, updatedAt: current.updatedAt };
    }

    if (operation === "standardize") {
      if (current.status === "approved") {
        // SPEC-080：已批准内容变化后显式回待审。客户端revision是并发前提，不是新的内容绑定。
        assertRevision(current, input.revision);
        const next = { ...current, decisions: [...current.decisions], approval: null };
        const info = runStandardizationPipeline(articleId, next, { ...input, revision: undefined }, "standardize");
        if (!info || !SNAPSHOT_HASH_PATTERN.test(`sha256:${info.formalContentHash}`)) {
          throw stateError("ARTICLE_NOT_STANDARDIZED", "当前文章标准化证据不可用，不能重开审批；请先重新标准化", 409, { articleId });
        }
        if (current.approval && current.approval.contentHash === info.formalContentHash) {
          throw stateError("STATE_TRANSITION_FORBIDDEN", "已批准内容未变化，无需重新审批", 409, { operation, status: current.status, allowed: APPROVAL_TRANSITIONS[operation] });
        }
        // 复用既有standardized收据。审计先行、状态失败可幂等重试；旧批准决定保留在历史中。
        const decision = await appendDecision(articleId, { ...input, contentHash: info.formalContentHash, decision: "standardized" }, current);
        next.status = "pending";
        next.revision = `sha256:${decision.contentHash}`;
        next.updatedAt = new Date().toISOString();
        next.decisions.push(decision.decisionId);
        writeRecordChecked(articleId, next);
        return { status: next.status, revision: next.revision, updatedAt: next.updatedAt };
      }
      runStandardizationPipeline(articleId, current, input, "standardize");
      current.status = "pending"; current.revision = input.revision || current.revision;
      current.updatedAt = new Date().toISOString(); writeRecord(articleId, current);
      return { status: "pending", revision: current.revision, updatedAt: current.updatedAt };
    }

    if (operation === "resubmit") {
      // B2/D3：修改重提必经重新标准化（feature:88）——管线内 probe 失败即 409、状态保持 rejected。
      runStandardizationPipeline(articleId, current, input, "resubmit");
      current.status = "pending"; current.revision = input.revision || current.revision;
      current.updatedAt = new Date().toISOString(); writeRecord(articleId, current);
      return { status: "pending", revision: current.revision, updatedAt: current.updatedAt };
    }

    if (operation === "publish") {
      assertRevision(current, input.revision);
      // B1/D1 fail-closed（INV-05）：「发布已生效」唯一判定 = publishArticle 返回非空 releaseId；
      // releaseId 只能来自发布器（N1 内容寻址），状态机不自造第二判定、不信任 input.releaseId 自报。
      const failPublish = (code, message, details) => {
        const error = stateError(code, message, 409, details);
        // 失败落持久 Issue（S4 单源：assembly 注入 publisherService.recordFailure）；记档失败不掩盖主错误。
        if (typeof recordFailure === "function") {
          try { recordFailure("approval-publish", { proposalId: articleId, sourceCommit: null }, error); }
          catch (issueError) {
            if (logger && typeof logger.warn === "function") logger.warn({ event: "approval-publish.issue-record-failed", articleId, error: issueError && issueError.message });
          }
        }
        throw error;
      };
      // 前置准入（仿 standardize 的 ARTICLE_NOT_STANDARDIZED 模式）：发布器未接入/候选源缺失 → 409，不写 snapshot。
      // 独立验证者指正（B1 边界负例）：sourcePath="" 会经 path.join 解析为 vault 目录本身且 existsSync 为真，
      // readFileSync(目录) 抛裸 EISDIR 绕过 failPublish——须校验「存在且是文件」（statSync().isFile()），不接受目录。
      const abs = typeof input.sourcePath === "string" && input.sourcePath !== ""
        ? (path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(vaultPath, input.sourcePath))
        : null;
      let sourceIsFile = false;
      if (abs !== null) {
        try { sourceIsFile = fs.statSync(abs).isFile(); } catch { sourceIsFile = false; }
      }
      if (typeof publishArticle !== "function" || !sourceIsFile) {
        return failPublish("PUBLISH_SOURCE_UNAVAILABLE", "发布源不可用（发布器未接入或候选文件缺失），未打包任何 Release", {
          articleId,
          hasSourcePath: typeof input.sourcePath === "string" && input.sourcePath !== "",
          sourceFileExists: sourceIsFile,
        });
      }
      // CI 切片：真打包（激活 snapshot-store，ADR043 D5'）——后端从 Vault 读候选文件 → Release → 原子 current
      const raw = fs.readFileSync(abs, "utf8");
      const actualHash = crypto.createHash("sha256").update(raw).digest("hex");
      // B2/D2 来源重验（feature:83-88 场景⑥ / PRD GOAL-5）：「被批准字节」唯一对照锚 =
      // confirm 时刻写入的 current.approval.contentHash（decisions.jsonl 同源审计，不自造第二判定）。
      // 不一致 = 旧审批资格失效 → 409 + 落 Issue；对照锚缺失（存量记录）同样 fail-closed。
      const approvedHash = current.approval && typeof current.approval.contentHash === "string" ? current.approval.contentHash : null;
      if (!approvedHash) {
        return failPublish("APPROVAL_EVIDENCE_STALE", "审批证据未绑定内容哈希（存量记录），不得发布；请重新标准化并重新审批", { articleId, reason: "approval-evidence-missing" });
      }
      if (approvedHash !== actualHash) {
        return failPublish("APPROVAL_EVIDENCE_STALE", "文章内容已变化，旧审批资格已失效；请修改后重新标准化并重新审批", { articleId, expected: approvedHash, actual: actualHash });
      }
      const article = {
        articleId,
        contentHash: actualHash,
        raw,
        sourcePath: input.sourcePath,
        // SPEC-030 派②：publish 落位需要域段（category-path 首段）——从候选文件现解析
        // （raw 是已验证字节；input 平铺不带 frontmatter，sourcePath 指向候选文件）
        document: { articleId, title: input.title || articleId, product: input.product || "", version: input.version || "", categoryPath: readCategoryPath(raw) },
        approval: current.approval || null,
      };
      const published = publishArticle(article);
      if (!published || typeof published.releaseId !== "string" || published.releaseId === "") {
        return failPublish("PUBLISH_RELEASE_INVALID", "发布器未返回有效 releaseId，不写入 snapshot 状态", {
          articleId,
          observed: published ? typeof published.releaseId : "no-result",
        });
      }
      current.status = "snapshot"; current.releaseId = published.releaseId;
      current.updatedAt = new Date().toISOString(); writeRecordChecked(articleId, current);
      return { status: "snapshot", releaseId: published.releaseId, snapshotPath: published.snapshotPath || null, revision: current.revision, updatedAt: current.updatedAt };
    }

    throw stateError("UNKNOWN_OPERATION", `未知审批操作: ${operation}`, 400);
  }

  // readCategoryPath 随接口出射（WP-116 批1：纯函数无闭包依赖——publish 落位域段解析的边界钉测试缝）
  return { STATUSES, APPROVAL_TRANSITIONS, assertTransition, getStatus, transition, readRecord, decisionsPath, readCategoryPath };
}

module.exports = { createApprovalStateMachine, APPROVAL_TRANSITIONS, STATUSES };
