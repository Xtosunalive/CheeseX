// Component: Auth-Principal（PR-085 第 2 步 · ADR-010 决策 6/7 · SPEC-024 §第 2 步）
// @responsible: 每请求身份主体 Principal 的形状与守卫——授权决策只读 kind/roles，不从 operatorId 形状推断含义
//               （OpenMAIC 同构）；operatorId 不透明但落库成对象键，设可打印 ASCII 字符集守卫（TALOS identifier 同构）。
// @inputs: 认证方法产出的主体事实（operatorId／kind／roles／assurance／channel／claims）
// @outputs: createPrincipal(fields) → frozen Principal；isPrincipal(value)；PRINCIPAL_KINDS／ASSURANCES／OPERATOR_ROLES
// @context: 禁自建密码/会话存储——会话是无状态签名 cookie（session-cookie.cjs）；roles 只由服务端映射（第 3 步登记表）。
const crypto = require("node:crypto");

/** 主体种类：authenticated 用户固定 user；service/local 形态随第 3 步登记表扩展。 */
const PRINCIPAL_KINDS = Object.freeze(["user", "service"]);
/** 凭据证明度：verified=方法校验过的凭据；unverified-local=本机单用户形态（无凭据，现状兼容）。 */
const ASSURANCES = Object.freeze(["verified", "unverified-local"]);

/**
 * 角色词表（裁项 5 推荐，Master 2026-10-20 批准）：审批状态机已有隐含角色的显式化——
 * submit=投稿（创建候选，首期所有已认证用户）／review=审核（review·审批）／publish=发布（schema-release）／admin=管理（schema 写准入）。
 * 唯一事实源在此，第 3 步登记表按此映射；localSingleUser 全给（＝现状）。
 */
const OPERATOR_ROLES = Object.freeze(["submit", "review", "publish", "admin"]);

// 可打印 ASCII、无空格、≤256（存储键安全形状；同 OpenMAIC OWNER_ID_PATTERN / TALOS identifier）
const OPERATOR_ID_PATTERN = /^[\x21-\x7e]{1,256}$/;

function createPrincipal(fields = {}) {
  const operatorId = fields.operatorId;
  if (typeof operatorId !== "string" || !OPERATOR_ID_PATTERN.test(operatorId)) {
    throw new Error(`operatorId 须为 1..256 个可打印非空 ASCII 字符，收到 ${JSON.stringify(operatorId)}`);
  }
  if (!PRINCIPAL_KINDS.includes(fields.kind || "user")) throw new Error(`未知主体种类 ${fields.kind}`);
  const assurance = fields.assurance || "verified";
  if (!ASSURANCES.includes(assurance)) throw new Error(`未知凭据证明度 ${assurance}`);
  const roles = fields.roles === undefined ? [] : fields.roles;
  if (!Array.isArray(roles) || roles.some((r) => !OPERATOR_ROLES.includes(r))) {
    throw new Error(`roles 须为 OPERATOR_ROLES 子集：${JSON.stringify(roles)}`);
  }
  const principal = Object.freeze({
    operatorId,
    kind: fields.kind || "user",
    roles: Object.freeze([...new Set(roles)]),
    assurance,
    channel: fields.channel || "web",
    claims: Object.freeze({ ...(fields.claims || {}) }),
  });
  return principal;
}

function isPrincipal(value) {
  return Boolean(value) && typeof value === "object" && typeof value.operatorId === "string"
    && OPERATOR_ID_PATTERN.test(value.operatorId) && Object.isFrozen(value);
}

/** 归属取证记录（写审计／账本用）：operatorId 必在，其余为取证增强字段。 */
function attributionOf(principal) {
  if (!isPrincipal(principal)) throw new Error("attributionOf 须收 Principal");
  return {
    operatorId: principal.operatorId,
    authenticated: principal.assurance === "verified",
    assurance: principal.assurance,
    channel: principal.channel,
  };
}

/** 会话载荷随机数（登录 state／PKCE）：复用 node:crypto，不自造。 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

module.exports = { PRINCIPAL_KINDS, ASSURANCES, OPERATOR_ROLES, OPERATOR_ID_PATTERN, createPrincipal, isPrincipal, attributionOf, randomToken };
