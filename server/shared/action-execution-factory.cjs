// Component: Action-Execution-Factory（WP-048 Wave 1 · ADR-014 §6.2/§6.4）
// @responsible: 统一执行工厂——动作请求唯一入口的八步编排：
//   http-boundary 传输/身份/角色（既有钩子，handler 之前已完成）→ 动作查找 → 前置规则与静态风险
//   → 领域执行器（含既有 OCC、事务与写入）→ 后置状态核对 → 既有审计通道 → 既有事件通知。
//   失败语义可判定：未找到 approved 动作/前置失败/风险阻断不调执行器；执行器失败沿用领域错误；
//   后置核对失败留源 revision 不承诺通用 undo；审计追加失败不假完整成功（§6.2）。
//   每个进入工厂的动作请求恰好追加一笔 kind=ontology_action 事件到 decisions.jsonl（§6.4），
//   写者只能是本工厂经 vault-io appendVaultJsonl 通道；传输层未进入工厂的请求不伪造动作事件。
// @inputs: action-registry 快照（与 preHandler 角色门同 revision）；登记执行器/前置解释器/后置核验器
// @outputs: initActionFactory({ vaultPath, logger }) / registerActionExecutor(id, fn) /
//           registerPreconditionInterpreter(kind, fn) / registerEffectVerifier(kind, fn) /
//           executeAction({ actionId, request, reply }) / resetActionFactory()（测试）
// @context: WP-048 SPEC-043 C1/C2/C5/C6/C7——工厂不自建第二套传输校验/权限/OCC/审计管线；
//   route-roles 快照是已迁移端点角色绑定唯一来源（快照构建期与静态表互斥对账）。
const path = require("node:path");
const fs = require("node:fs");
const { sendJSON } = require("./api-envelope.cjs");
const { createError } = require("./error-factory.cjs");
const { getTraceId, createTraceId, getPrincipal, enterRequestContext } = require("./request-context.cjs");
const { appendVaultJsonl, writeVaultExclusive } = require("./vault-io.cjs"); // 通道须已由 main.cjs initVaultIO 激活；未激活时追加失败走 §6.4 显式观测，不静默
const { getActiveActionSnapshot } = require("./action-registry.cjs");

let state = null; // { vaultPath, decisionsPath, logger, executors, preconditionInterpreters, effectVerifiers }
// 注册缓冲：执行器/解释器/核验器可在 init 之前登记（路由模块 register() 与装配顺序解耦），
// initActionFactory 时统一灌入——同 ID 不同实现的冲突在灌入期照常暴露。
const pending = { executors: [], preconditionInterpreters: [], effectVerifiers: [] };
const noopLogger = { info() {}, warn() {}, error() {} };

const RISK_DECISIONS = new Set(["allow", "confirm", "approve", "block"]);

function ensureDecisionsFile() {
  fs.mkdirSync(path.dirname(state.decisionsPath), { recursive: true });
  if (!fs.existsSync(state.decisionsPath)) {
    // wx 排他创建＋⑤类通道记账（approval.ensureStore 同款先例）
    writeVaultExclusive(state.decisionsPath, "", { domain: "ontology-action", summary: "动作审计流水初始化" }, { flag: "wx", mode: 0o600 });
  }
}

/** 追加一笔 ontology_action 审计事件；失败返回 false（调用方按 §6.2/§6.4 处置，不掩盖）。 */
function appendActionEvent(event) {
  try {
    ensureDecisionsFile();
    appendVaultJsonl(state.decisionsPath, `${JSON.stringify(event)}\n`, {
      domain: "ontology-action",
      summary: "本体动作审计事件",
      fsOptions: { encoding: "utf8" },
    });
    return true;
  } catch (error) {
    if (state.logger) {
      state.logger.error({
        event: "ontology-action-audit-failed",
        trace_id: event.trace_id,
        action_id: event.action_id,
        input_revision: event.input_revision,
        output_revision: event.output_revision,
        error: error.message,
      });
    }
    return false;
  }
}

function buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision, outcome, errorCode, result }) {
  const affected = result && typeof result === "object" ? result : {};
  const sourcePath = typeof affected.affectedFile === "string" && affected.affectedFile
    ? affected.affectedFile
    : (snapshot ? snapshot.sourcePath : null);
  const principal = getPrincipal();
  return {
    kind: "ontology_action",
    trace_id: traceId,
    action_id: actionId,
    operator_id: principal ? principal.operatorId : null,
    // source_refs/rule_refs 复用 decision-lineage 源/规则坐标形状（ADR-014 §6.4）
    source_refs: sourcePath
      ? [{ kind: "vault-file", path: sourcePath, contentHash: outputRevision, lineNumber: null, coordinate: `path:${sourcePath}` }]
      : [],
    rule_refs: [{ ruleId: actionId, ruleRevision: snapshot ? snapshot.revision : null, reasonCode: errorCode || outcome }],
    input_revision: inputRevision,
    output_revision: outputRevision,
    outcome,
    ...(errorCode ? { error_code: errorCode } : {}),
    occurred_at: new Date().toISOString(),
  };
}

function inputRevisionOf(body, snapshot) {
  if (body && typeof body.revision === "string" && body.revision) return body.revision;
  return snapshot ? snapshot.revision : null;
}

/** 静态风险评估（ADR-014 §3.2 风险行：决策只允许声明处置意图）——返回 {allowed, reasonCode} 或
 *  {allowed:false, code, message, status, details}；错误对象在调用点 throw 行构造（PR-158 出生账
 *  扫描器只认 throw 行字面量——返回式错误对象会逃账，红队发现①）。 */
function evaluateStaticRisk(actionId, action, snapshot, body, previewRequest) {
  if (!action.risk_id) return { allowed: true, reasonCode: "risk_none" };
  const risk = snapshot.risks.get(action.risk_id);
  if (!risk) return { allowed: false, code: "ACTION_RISK_BLOCKED", message: `动作风险 ${action.risk_id} 不可判定（未声明或非现役）——不自动执行`, status: 403, details: { risk_id: action.risk_id, reason: "risk_unresolved" } };
  const decision = risk.decision;
  if (!RISK_DECISIONS.has(decision)) {
    return { allowed: false, code: "ACTION_RISK_BLOCKED", message: `风险 ${action.risk_id} 的 decision 非法: ${JSON.stringify(decision)}`, status: 403, details: { risk_id: action.risk_id, reason: "risk_undecidable" } };
  }
  if (decision === "allow") return { allowed: true, reasonCode: "risk_allow" };
  if (decision === "block") {
    return { allowed: false, code: "ACTION_RISK_BLOCKED", message: `动作被风险 ${action.risk_id} 静态阻断`, status: 403, details: { risk_id: action.risk_id, reason: "risk_block" } };
  }
  if (decision === "confirm") {
    if (body && body.confirm === true) return { allowed: true, reasonCode: "risk_confirmed" };
    return { allowed: false, code: "ACTION_CONFIRM_REQUIRED", message: `动作须二次确认（风险 ${action.risk_id}）——请求体携带 confirm: true 后重试`, status: 409, details: { risk_id: action.risk_id } };
  }
  // WP-172（SPEC-095 §3.5 首批）：approve 档凭审批单核验——approved 且动作匹配且输入哈希一致且未用
  // （单次有效）→放行并核销；任何不满足仍拒（fail-closed，六分支各留 details.reason 供对账）
  // dryRun 预览旁路：URL 带 dryRun=1 时执行器语义即「预演不写」（retire 先例）——预览非风险动作本体，放行留痕
  if (previewRequest && previewRequest.url && /([?&])dryRun=1\b/.test(previewRequest.url)) {
    return { allowed: true, reasonCode: "risk_dry_run_preview" };
  }
  const reject = (reason) => ({ allowed: false, code: "ACTION_APPROVAL_REQUIRED", message: `动作须审批（风险 ${action.risk_id}）——${reason}`, status: 403, details: { risk_id: action.risk_id, reason } });
  const channel = state && state.approvals;
  if (!channel || typeof channel.foldActionApprovals !== "function" || typeof channel.stableInputHash !== "function") {
    return reject("审批通道未装配（装配缺陷——initActionFactory 需注入 approvals）");
  }
  const approvalId = body && typeof body.approval_id === "string" ? body.approval_id.trim() : "";
  if (!approvalId) return reject("审批通道已接线：先立审批单（POST /api/action-approvals），裁决通过后携 approval_id 重试");
  const approval = channel.foldActionApprovals(state.vaultPath).get(approvalId);
  if (!approval || approval.status === "unknown") return reject("approval_unknown");
  if (approval.status === "rejected") return reject("approval_rejected");
  if (approval.status === "pending") return reject("approval_pending");
  if (approval.used) return reject("approval_reused");
  if (approval.actionId !== actionId) return reject("approval_action_mismatch");
  // 输入哈希防偷换：审批的是立单时输入的哈希——执行体去掉 approval_id 后须逐字节等价
  const executionHash = channel.stableInputHash(bodyWithoutApprovalId(body));
  if (executionHash !== approval.inputHash) return reject("approval_hash_mismatch");
  // 核销点＝执行器成功后（executeAction 内 executor 完成处回调）——失败不烧单（红队记档2：
  // 前置核销把瞬态失败放大成重走全审批）。此处只放行，核销经 state.onRiskApproved 回调。
  if (state && typeof state.onRiskApproved === "function") state.pendingConsume = () => state.onRiskApproved(state.vaultPath, approvalId, getTraceId());
  return { allowed: true, reasonCode: "risk_approved" };
}

function bodyWithoutApprovalId(body) {
  if (!body || typeof body !== "object") return body;
  const clone = { ...body };
  delete clone.approval_id;
  return clone;
}

/**
 * 工厂主入口（由已迁移路由 handler 调用；http-boundary 传输/身份/角色校验已在 handler 前完成）。
 * executor 可由调用方显式传入（路由模块把本 register() 实例登记的执行器随闭包传递——多 harness
 * 并发注册同名执行器时保持按注册隔离，红队后 W1-B 修正）；未传时回落全局注册表（按 action.executor 查）。
 * 成功路径 sendJSON(reply, action.success_status||200, result)；失败路径一律 throw（http-app 错误处理器映射）。
 */
async function executeAction({ actionId, request, reply, executor: boundExecutor }) {
  if (!state) throw createError("ACTION_FACTORY_UNAVAILABLE", "执行工厂未初始化（装配缺陷）", 503, { action_id: actionId });
  const logger = state.logger || noopLogger;
  // 事件 trace_id 与响应 X-Trace-Id 同源：无请求上下文（非 HTTP 入口/单测）时进入上下文，
  // 使 sendJSON 复用同一 trace_id（ADR-014 §6.4 可追溯口径）。
  if (!getTraceId()) enterRequestContext({ traceId: createTraceId() });
  const traceId = getTraceId();
  const body = request ? request.body : undefined;

  const snapshot = getActiveActionSnapshot();
  if (!snapshot) throw createError("ACTION_FACTORY_UNAVAILABLE", "动作注册快照未初始化（装配缺陷）", 503, { action_id: actionId });

  // ② 动作查找——仅 approved 进入活消费面（快照构建已过滤）
  const action = snapshot.actions.get(actionId);
  if (!action) {
    const event = buildEvent({ traceId, actionId, snapshot, inputRevision: snapshot.revision, outputRevision: null, outcome: "rejected", errorCode: "ACTION_NOT_ACTIVE" });
    appendActionEvent(event);
    throw createError("ACTION_NOT_ACTIVE", `动作 ${actionId} 未在册或非现役（lifecycle_status 非 approved）`, 500, { action_id: actionId, snapshot_revision: snapshot.revision });
  }
  const inputRevision = inputRevisionOf(body, snapshot);

  // ③ 前置规则（登记解释器消费声明数据；未知 kind fail-closed 不执行）
  const preconditions = Array.isArray(action.preconditions) ? action.preconditions : [];
  for (const precondition of preconditions) {
    const kind = precondition && precondition.kind;
    const interpreter = state.preconditionInterpreters.get(kind);
    if (!interpreter) {
      const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision: null, outcome: "rejected", errorCode: "ACTION_PRECONDITION_UNKNOWN" });
      appendActionEvent(event);
      throw createError("ACTION_PRECONDITION_UNKNOWN", `前置条件解释器未登记: ${JSON.stringify(kind)}`, 500, { action_id: actionId, precondition_kind: kind });
    }
    const verdict = interpreter({ precondition, request, body, action, snapshot });
    if (!verdict || verdict.ok !== true) {
      const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision: null, outcome: "rejected", errorCode: "ACTION_PRECONDITION_FAILED" });
      appendActionEvent(event);
      throw createError("ACTION_PRECONDITION_FAILED", (verdict && verdict.reason) || `前置条件未满足: ${JSON.stringify(kind)}`, 422, { action_id: actionId, precondition_kind: kind });
    }
  }

  // ③ 静态风险（不可判定不自动执行）——错误对象在本 throw 族构造（出生账口径，红队发现①修复）
  const risk = evaluateStaticRisk(actionId, action, snapshot, body, request);
  if (!risk.allowed) {
    const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision: null, outcome: "rejected", errorCode: risk.code });
    appendActionEvent(event);
    if (risk.code === "ACTION_CONFIRM_REQUIRED") throw createError("ACTION_CONFIRM_REQUIRED", risk.message, 409, risk.details);
    if (risk.code === "ACTION_APPROVAL_REQUIRED") throw createError("ACTION_APPROVAL_REQUIRED", risk.message, 403, risk.details);
    throw createError("ACTION_RISK_BLOCKED", risk.message, 403, risk.details);
  }

  // ④ 领域执行器——路由闭包显式传递优先（按注册隔离）；否则按 action.executor 查全局注册表
  const executor = typeof boundExecutor === "function" ? boundExecutor : state.executors.get(action.executor);
  if (typeof executor !== "function") {
    const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision: null, outcome: "rejected", errorCode: "ACTION_EXECUTOR_UNREGISTERED" });
    appendActionEvent(event);
    throw createError("ACTION_EXECUTOR_UNREGISTERED", `动作 ${actionId} 的执行器未登记: ${JSON.stringify(action.executor)}`, 500, { action_id: actionId, executor: action.executor });
  }

  let result;
  try {
    result = await executor({ request, body, action, snapshot });
    if (typeof state.pendingConsume === "function") { const consume = state.pendingConsume; state.pendingConsume = null; consume(); } // WP-172：审批单核销＝执行器成功后（失败不烧单）
  } catch (error) {
    // 执行器失败：沿用领域错误与事务语义——原样上抛；事件 outcome=failed 先行落账
    const outputRevision = error && typeof error.revision === "string" ? error.revision : null;
    const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision, outcome: "failed", errorCode: (error && error.code) || "INTERNAL_ERROR", result: null });
    appendActionEvent(event);
    throw error;
  }

  // ⑤ 后置状态核对（登记核验器消费 effects 声明；失败留已发生写入的 revision，不承诺 undo）
  const effects = Array.isArray(action.effects) ? action.effects : [];
  const outputRevision = result && typeof result === "object" && typeof result.revision === "string" ? result.revision : null;
  for (const effect of effects) {
    const kind = effect && effect.kind;
    const verifier = state.effectVerifiers.get(kind);
    if (!verifier) {
      const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision, outcome: "failed", errorCode: "ACTION_POSTCHECK_FAILED" });
      appendActionEvent(event);
      throw createError("ACTION_POSTCHECK_FAILED", `后置核验器未登记: ${JSON.stringify(kind)}`, 500, { action_id: actionId, effect_kind: kind, input_revision: inputRevision, output_revision: outputRevision });
    }
    const verdict = verifier({ effect, result, request, body, action, snapshot });
    if (!verdict || verdict.ok !== true) {
      const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision, outcome: "failed", errorCode: "ACTION_POSTCHECK_FAILED" });
      appendActionEvent(event);
      throw createError("ACTION_POSTCHECK_FAILED", (verdict && verdict.reason) || `后置状态核对未通过: ${JSON.stringify(kind)}`, 500, { action_id: actionId, effect_kind: kind, input_revision: inputRevision, output_revision: outputRevision });
    }
  }

  // ⑥ 审计（§6.4 唯一动作业务事件）——追加失败不假完整成功：可追溯异常，按双 revision 对账
  const event = buildEvent({ traceId, actionId, snapshot, inputRevision, outputRevision, outcome: "success", errorCode: null, result });
  if (!appendActionEvent(event)) {
    throw createError("ACTION_AUDIT_APPEND_FAILED", "动作已执行但审计事件追加失败——结果按失败上报，凭 trace_id 与双 revision 对账", 500, { action_id: actionId, trace_id: traceId, input_revision: inputRevision, output_revision: outputRevision });
  }

  // ⑦ 既有事件通知：执行器写入经 vault-io 通道（emitVaultWrite/观察者）已通知，工厂不另发事件
  logger.info({ event: "ontology-action-executed", action_id: actionId, trace_id: traceId, outcome: "success", risk_reason: risk.reasonCode });
  // W1-B：动作可声明成功状态码（缺省 200；先例＝文章上传 201）。
  // W1-C：批报告型动作（先例＝derived/rebuild——部分失败以带数据体的 500 报告且契约/前端均按此
  // 消费）可由执行器在结果对象携带 __http_status（200-599）覆盖出站状态；该内部字段出站前剥离。
  let successStatus = Number.isInteger(action.success_status) ? action.success_status : 200;
  let payload = result;
  if (result && typeof result === "object" && Number.isInteger(result.__http_status)
      && result.__http_status >= 200 && result.__http_status <= 599) {
    successStatus = result.__http_status;
    const { __http_status, ...rest } = result;
    payload = rest;
  }
  return sendJSON(reply, successStatus, payload);
}

function initActionFactory({ vaultPath, logger, approvals } = {}) {
  if (!vaultPath) throw new TypeError("[action-factory] initActionFactory 需要 vaultPath");
  // 不重复 initVaultIO：通道由 main.cjs 统一初始化（重复调用会清掉已装配的 gitLedger）；
  // 测试侧自行 initVaultIO({ vaultPath }) 激活通道后再走工厂成功路径。
  state = {
    vaultPath,
    approvals: approvals || null, // WP-172：approve 档核验函数注入（ADR-004 层次律——shared 不反向 require services；缺注入＝审批通道未装配，fail-closed）
    onRiskApproved: (approvals && typeof approvals.consumeActionApproval === "function") ? approvals.consumeActionApproval : null, // 成功后核销（失败不烧单）
    pendingConsume: null,
    decisionsPath: require("../vault-paths.cjs").getDecisionsLogPath(vaultPath), // PR-243 批B：单源
    logger: logger || null,
    executors: new Map(),
    preconditionInterpreters: new Map(),
    effectVerifiers: new Map(),
  };
  // 灌入 init 前缓冲的登记（见 pending 注释）
  for (const [id, fn] of pending.executors) registerActionExecutor(id, fn);
  for (const [kind, fn] of pending.preconditionInterpreters) state.preconditionInterpreters.set(kind, fn);
  for (const [kind, fn] of pending.effectVerifiers) registerEffectVerifier(kind, fn);
  pending.executors.length = 0;
  pending.preconditionInterpreters.length = 0;
  pending.effectVerifiers.length = 0;
  // 内建后置核验器：revision_present——写动作结果须携带非空 revision（W1-A 写服务结果形状先例）
  state.effectVerifiers.set("revision_present", ({ result }) => ({
    ok: Boolean(result && typeof result === "object" && typeof result.revision === "string" && result.revision),
    reason: "执行结果缺少非空 revision（写未发生或结果形状漂移）",
  }));
  return state;
}

function registerActionExecutor(executorId, fn) {
  if (typeof fn !== "function") throw new TypeError(`[action-factory] 执行器 ${executorId} 不是函数`);
  if (!state) { pending.executors.push([executorId, fn]); return; }
  // 同 ID 重注册＝后者生效（路由模块按装配重挂/测试夹具重建闭包的合法场景）；
  // 任一时点只有一个活实现，不产生两份并存事实。生产装配单次注册不受影响。
  state.executors.set(executorId, fn);
}

function registerPreconditionInterpreter(kind, fn) {
  if (typeof fn !== "function") throw new TypeError(`[action-factory] 前置解释器 ${kind} 不是函数`);
  if (!state) { pending.preconditionInterpreters.push([kind, fn]); return; }
  state.preconditionInterpreters.set(kind, fn);
}

function registerEffectVerifier(kind, fn) {
  if (typeof fn !== "function") throw new TypeError(`[action-factory] 后置核验器 ${kind} 不是函数`);
  if (!state) { pending.effectVerifiers.push([kind, fn]); return; }
  state.effectVerifiers.set(kind, fn);
}

function resetActionFactory() {
  state = null;
  pending.executors.length = 0;
  pending.preconditionInterpreters.length = 0;
  pending.effectVerifiers.length = 0;
}

module.exports = {
  initActionFactory,
  registerActionExecutor,
  registerPreconditionInterpreter,
  registerEffectVerifier,
  executeAction,
  resetActionFactory,
};
