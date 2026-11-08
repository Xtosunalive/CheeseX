// Component: Schema-Write-Guards（SPEC-023 波 4——写时吃扫描）
// @responsible: TheSchema 写路径准入校验——①fields 配方可解析（resolveValueDomains 零红才可落盘）
//               ②enums 顶层键已注册（theschema-roles 段覆盖——新键未登记即拒）
//               ③乐观锁基线必填（PR-200——「没传」不等于「不用比」的单点闸形）。
//               补偿性 CI 扫描（fields-registry④/data-roles⑥）由此降级为回归兜底：坏数据从
//               「提交时红」前移到「写入时拒」，报错即指引。
// @context: TALOS Fix Loop（修权威源不修症状）＋收敛阶梯——执法位置从事后扫描搬进写路径。
//           registry 从仓内 contracts 加载（写代码即仓内进程，恒在——fail-closed）。
const fs = require("node:fs");
const path = require("node:path");
const { createError } = require("./error-factory.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const ROLES_PATH = path.join(ROOT, "contracts", "theschema-roles.json");

/** 已注册段名集（enums.yaml 行，复合段 "A + B" 拆分）。registry 不可读＝fail-closed 抛错。 */
function registeredSegments() {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(ROLES_PATH, "utf8"));
  } catch (e) {
    throw new Error(`SCHEMA_WRITE_GUARD_REGISTRY_UNREADABLE: theschema-roles.json 不可读（${e.message}）——写路径 fail-closed`);
  }
  const entry = (registry.entries || []).find((x) => x.file === "data/theschema/enums.yaml");
  const names = new Set();
  for (const seg of (entry && entry.segments) || []) {
    for (const n of String(seg.segment || "").split("+").map((x) => x.trim()).filter(Boolean)) names.add(n);
  }
  if (!names.size) throw new Error("SCHEMA_WRITE_GUARD_REGISTRY_EMPTY: theschema-roles enums 行无段——注册表异常，写路径 fail-closed");
  return names;
}

/**
 * enums 写准入：doc（YAML Document 或普通对象）顶层键必须全部在册。
 * @returns {string[]} 违规键列表（空数组＝放行）
 */
function enumsSegmentViolations(docLike) {
  const keys = docLike && typeof docLike.toJSON === "function" ? Object.keys(docLike.toJSON() || {}) : Object.keys(docLike || {});
  const registered = registeredSegments();
  return keys.filter((k) => !registered.has(k));
}

/**
 * PR-200 乐观锁单点闸形：写入口必须显式给出读到的基线 revision——「没传」不等于「不用比」。
 * 各服务此前自写真值判断（`if (expectedRevision && …)`），同一规则两种闸形；此处收为唯一执法点，
 * 服务端与统一写客户端同闸（错误码沿用 ontology 先例的已登记 SCHEMA_REVISION_REQUIRED，不新生码）。
 * @param {*} value 调用方给的 expectedRevision
 * @param {string} target 被写的文件面与动作（报错点名，操作者据此定位，如 "enums.yaml 回滚"）
 * @param {{allowNullBaseline?: boolean}} options 读侧对缺席文件返回 null 的面（fields）置 true——
 *        null＝「我读到的是空库」的显式断言，是合法首建出口；其余面基线恒为串，null 即未给出。
 */
function assertRevisionGiven(value, target, options = {}) {
  const given = typeof value === "string" ? value !== "" : options.allowNullBaseline === true && value === null;
  if (given) return;
  throw createError(
    "SCHEMA_REVISION_REQUIRED",
    `${target}：缺 expectedRevision——乐观锁基线必填，缺即拒（出口：先读当前 revision 并原样回传，读侧对缺席文件同样给出基线）`,
    400
  );
}

module.exports = { enumsSegmentViolations, registeredSegments, assertRevisionGiven };
