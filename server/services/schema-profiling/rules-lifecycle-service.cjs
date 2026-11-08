// Component: Rules-Lifecycle-Service（ADR-007 波3 · SPEC-008 §3.2）
// @responsible: 规则通道——立新规则（propose）/退役（retire）写 entity-readiness-rules.json
//               + rules-lifecycle-index.json 四层联动（新规则自动补映射行）。
//               业界对应：Policy registry（Policy-as-Code：声明式契约+UI 写回+引擎查表）。
// @inputs: 契约文件（contracts/entity-readiness-rules.json + rules-lifecycle-index.json）
// @outputs: listRules()/proposeRule()/retireRule()；带 revision 乐观锁+快照
// @context: 2026-10-09 波3（Master 01:54「继续」）。红线（SPEC-008）：存量规则 severity/gates
//           只读——变更请求 409 RULE_SEALED_UNTIL_WAVE4（波4 快照对账后开放）；本波只加新/退役新。
//           写回纪律与 enums 同款：revision 校验+快照备份；写后索引联动保证 check:rules-lifecycle 绿。

const fs = require("node:fs");
const { copyFile } = require("../../shared/repo-file-io.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
// EG-1b 错误工厂收敛：用共享工厂（T7 唯一性门禁执法——不自造本地工厂）
const { bindErrorFactory } = require("../../shared/error-factory.cjs");
// SPEC-012 WP-I：写点出 vault 通道——本服务写的是 repo 侧 contracts/*.json（repoRoot 注入），
// 属 repo 文件维护写，不归 vault-io 管辖（生产中经 vault 通道写 repo 文件会被 F1 目的地执法拦）；
// 原子写经 repo-file-io（tmp+rename，与 vault-io.atomicWrite 同款形状）。
const { writeRepoFileAtomic } = require("../../shared/repo-file-io.cjs");
const serviceError = bindErrorFactory({ status: 400 });

// 新规则 id 分配：F 族顺延（跳过已占）
function nextRuleId(existingIds) {
  const used = new Set(existingIds);
  let n = 18; // F01-F17 已占（F17 最新）；从 F18 起
  while (used.has(`F${String(n).padStart(2, "0")}`)) n += 1;
  return `F${String(n).padStart(2, "0")}`;
}

function createRulesLifecycleService({ repoRoot }) {
  if (!repoRoot) throw serviceError("REPO_ROOT_REQUIRED", "repoRoot is required", 500);
  const rulesPath = path.join(repoRoot, "contracts", "entity-readiness-rules.json");
  const indexPath = path.join(repoRoot, "contracts", "rules-lifecycle-index.json");
  const mapPath = path.join(repoRoot, "contracts", "rule-issue-derivation-map.json");
  const snapshotDir = path.join(repoRoot, "contracts", "snapshots", "rules-lifecycle");

  function readContract() {
    return JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  }
  function readIndex() {
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  }
  function revisionOf(content) {
    return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  }
  function snapshot(filename) {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(snapshotDir, `${filename}.${stamp}.json`);
    copyFile(rulesPath, target);
    return path.relative(repoRoot, target);
  }
  function writeContract(contract) {
    writeRepoFileAtomic(rulesPath, JSON.stringify(contract, null, 2) + "\n"); // SPEC-012 WP-I：repo 文件直写（出 vault 通道）
  }
  function writeIndex(index) {
    writeRepoFileAtomic(indexPath, JSON.stringify(index, null, 2) + "\n"); // SPEC-012 WP-I：repo 文件直写（出 vault 通道）
  }

  // ── 台账（只读现算，status 不落盘——与 rules-lifecycle 哲学一致）──
  function listRules() {
    const contract = readContract();
    const index = readIndex();
    const indexed = new Map((index["rules-index"].rules || []).map((r) => [r.ruleId, r]));
    const rules = (contract.rules || []).map((r) => ({
      id: r.id,
      severity: r.severity,
      gates: r.gates || [],
      field: r.field || null,
      check: r.check || null,
      // 人话卡（2026-10-27 降档批）：违规文案透出——台账可管理性从 0 修复（此前数据有 UI 不用）
      message: r.message || null,
      // 退役判定（03:50 报障修正）：退役的机器签名=severity info + gates 空（retire 动作的落盘形态）。
      // 原判定把「warn+gates 空」也当退役——错：warn 级设计本就不挂门（不拦写只提醒），
      // 新立 warn 规则全被误判 retired（页面半透明灰态、无按钮=用户看到「规则没变」）。
      retired: r.severity === "info" && Array.isArray(r.gates) && r.gates.length === 0,
      indexed: indexed.has(r.id),
      // 存量/新建判定：波3 前的 23 条=存量（sealed）；波3 新立=可管
      sealed: !/^(F(0[1-9]|1[0-7])|B0[1-4])$/.test(r.id) === false,
    }));
    return { rules, revision: revisionOf(contract), total: rules.length };
  }

  // ── propose：立新规则（契约加行+索引联动）──
  function proposeRule(payload) {
    if (!payload || typeof payload !== "object") throw serviceError("INVALID_RULE_PROPOSAL", "payload must be an object", 400);
    const contract = readContract();
    // 乐观锁（PR-201 收紧：缺基线即拒——原真值判断形 `payload.revision && …` 缺省即跳过比对＝静默覆盖风险向；
    // 码面随 PR-200 单点闸先例复用 SCHEMA_REVISION_REQUIRED，比对不上仍 409 RULES_REVISION_CONFLICT）
    if (typeof payload.revision !== "string" || payload.revision.length === 0) {
      throw serviceError("SCHEMA_REVISION_REQUIRED", "必须携带 revision（读侧 GET /api/rules/lifecycle 返回）——缺基线即拒，防静默覆盖", 400);
    }
    if (payload.revision !== revisionOf(contract)) {
      throw serviceError("RULES_REVISION_CONFLICT", "契约已变更，请重读台账后再提交", 409);
    }
    const existingIds = (contract.rules || []).map((r) => r.id);
    // 指定 id 且已存在 → 视为改存量 → 封印
    if (payload.id && existingIds.includes(payload.id)) {
      throw serviceError("RULE_SEALED_UNTIL_WAVE4", `存量规则 ${payload.id} 的变更属波4 范围（快照对账后开放）；本波只支持新立规则`, 409, { id: payload.id, wave: 4 });
    }
    if (payload.id && !/^F\d{2,}$/.test(payload.id)) throw serviceError("INVALID_RULE_ID", "规则 id 形态须为 F+数字（如 F18）", 400);
    const id = payload.id || nextRuleId(existingIds);
    if (existingIds.includes(id)) throw serviceError("RULE_ID_CONFLICT", `规则 id ${id} 已存在`, 409);
    // 必填形状（与契约 schema 对齐的最小集）
    const check = String(payload.check || "").trim();
    const field = String(payload.field || "").trim();
    const severity = payload.severity === "warn" || payload.severity === "info" ? payload.severity : (payload.severity === "error" ? "warn" : "warn");
    if (!check || !field) throw serviceError("RULE_SHAPE_INVALID", "check 与 field 必填（规则声明式形状）", 400);
    if (payload.severity === "error") {
      // 波3 红线：新建规则不允许直接 error（error 需 gates 执法绑定+出口闭环，属波4 强度体系）
      // ——统一落 warn（advise），升 enforce 走波4 对账后的切换通道
      severity;  
    }
    const rule = {
      id,
      check,
      field,
      severity: "warn", // 波3 一律 advise（见上）；error 属波4
      message: String(payload.message || `规则 ${id} 校验未通过（{actual}）`).trim(),
      emptyMessage: String(payload.emptyMessage || `${field} 未填写`).trim(),
      onEmpty: payload.onEmpty || "warn",
      gates: [], // warn 不挂门（warn 设计声明：不挂写入门禁、出问题列表）
      group: payload.group || "growth",
      ...(payload.enumKey ? { enumKey: payload.enumKey } : {}),
      ...(payload.dimension ? { dimension: payload.dimension } : {}),
    };
    const snap = snapshot("entity-readiness-rules");
    contract.rules.push(rule);
    contract.rules.sort((a, b) => a.id.localeCompare(b.id));
    writeContract(contract);
    // 索引联动：rules-lifecycle-index 自动补行（ADR-007 验收链「rules-lifecycle 索引自动补齐」）
    const index = readIndex();
    index["rules-index"].rules.push({
      ruleId: id,
      type: rule.severity === "error" ? "hard" : "soft",
      severity: rule.severity,
      source: `contracts/entity-readiness-rules.json#rules[${contract.rules.findIndex((r) => r.id === id)}]`,
      signal: { check: rule.check, engine: "server/services/entity-compliance/entity-compliance-declarative-engine.cjs" },
      enforcement: { gates: [] },
      closure: { exit: { kind: "issue", issueKind: payload.issueKind || "missing_field" } },
      dimension: rule.dimension || "validity",
    });
    writeIndex(index);
    // 映射联动：rule-issue-derivation-map 自动补行（四层互指第四层——真库验证 A5 孤儿检测抓出：
    // 只补索引不补映射=孤儿规则。形态照 F17 warn 先例：read-diagnostic 舞台+enforcement none）
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    map["rule-issue-derivation-map"].rows.push({
      ruleId: id,
      type: "soft",
      severity: rule.severity,
      dimension: rule.dimension || "validity",
      source: `contracts/entity-readiness-rules.json#rules[${contract.rules.findIndex((r) => r.id === id)}]`,
      signal: "server/services/entity-compliance/entity-compliance-declarative-engine.cjs",
      stage: "read-diagnostic",
      enforcement: "none（warn 级设计使然——波3 新立规则一律 advise 起步）",
      exit: payload.issueKind || "missing_field",
      derivation: "server/services/governance/anomaly-handling-mode.cjs#deriveIssueHandling→fix(entity-repair)",
    });
    writeRepoFileAtomic(mapPath, JSON.stringify(map, null, 2) + "\n"); // SPEC-012 WP-I：repo 文件直写（出 vault 通道）
    return { rule, snapshot: snap, revision: revisionOf(readContract()) };
  }

  // ── retire：退役（保留审计链：gates 清空+severity 降 info，不删除条目）──
  function retireRule(payload) {
    const id = payload && payload.id;
    if (!id) throw serviceError("RULE_ID_REQUIRED", "id is required", 400);
    const contract = readContract();
    // 乐观锁（PR-201 收紧：同 proposeRule——缺基线即拒，码面复用 SCHEMA_REVISION_REQUIRED）
    if (typeof payload.revision !== "string" || payload.revision.length === 0) {
      throw serviceError("SCHEMA_REVISION_REQUIRED", "必须携带 revision（读侧 GET /api/rules/lifecycle 返回）——缺基线即拒，防静默覆盖", 400);
    }
    if (payload.revision !== revisionOf(contract)) {
      throw serviceError("RULES_REVISION_CONFLICT", "契约已变更，请重读台账后再提交", 409);
    }
    const rule = (contract.rules || []).find((r) => r.id === id);
    if (!rule) throw serviceError("RULE_NOT_FOUND", `规则 ${id} 不存在`, 404);
    // 存量封印：波3 前的 23 条不可退役
    if (/^(F(0[1-9]|1[0-7])|B0[1-4])$/.test(id)) {
      throw serviceError("RULE_SEALED_UNTIL_WAVE4", `存量规则 ${id} 的退役属波4 范围；本波只支持退役波3 新立规则`, 409, { id, wave: 4 });
    }
    if (rule.severity === "info" && (!rule.gates || rule.gates.length === 0)) {
      return { rule, revision: revisionOf(contract), alreadyRetired: true }; // 幂等
    }
    const snap = snapshot("entity-readiness-rules");
    rule.severity = "info";
    rule.gates = [];
    rule.onEmpty = "pass";
    writeContract(contract);
    // 索引联动
    const index = readIndex();
    const entry = (index["rules-index"].rules || []).find((r) => r.ruleId === id);
    if (entry) {
      entry.severity = "info";
      entry.type = "soft";
      entry.enforcement = { gates: [] };
    }
    writeIndex(index);
    // 映射联动（四层互指同 propose）
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    const row = (map["rule-issue-derivation-map"].rows || []).find((r) => r.ruleId === id);
    if (row) {
      row.severity = "info";
      row.type = "soft";
      row.stage = "read-diagnostic";
      row.enforcement = "none（已退役——波3 规则通道 retire 产物）";
    }
    writeRepoFileAtomic(mapPath, JSON.stringify(map, null, 2) + "\n"); // SPEC-012 WP-I：repo 文件直写（出 vault 通道）
    return { rule, snapshot: snap, revision: revisionOf(readContract()) };
  }

  return { listRules, proposeRule, retireRule };
}

module.exports = { createRulesLifecycleService, nextRuleId };
