// Component: Session-Cookie（PR-085 第 2 步 · ADR-010 决策 6：无状态签名会话——禁自建服务端会话存储）
// @responsible: OIDC 登录后的会话凭据：HMAC-SHA256 签名的自包含 cookie 值（payload.signature，base64url），
//               校验恒定时间比较；篡改/过期一律判 invalid（由调用方立即 401，绝不降级）。
// @inputs: AUTH_SESSION_SECRET（≥32 字节）；payload {sub, name, iat, exp}
// @outputs: createSessionCookieService(options) → { cookieName, issue(claims) → cookieValue, verify(cookieValue) → claims|null }
const crypto = require("node:crypto");

function b64url(input) { return Buffer.from(input).toString("base64url"); }

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSessionCookieService(options = {}) {
  const secret = options.secret || process.env.AUTH_SESSION_SECRET || "";
  if (secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET 必须至少 32 字节（oidc 模式启动 fail-closed）");
  }
  const cookieName = options.cookieName || "anyshare_session";
  const ttlMs = options.ttlMs || 12 * 60 * 60 * 1000;

  function sign(payloadB64) {
    return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  }

  function issue(claims = {}) {
    const payload = { sub: claims.sub, name: claims.name ?? null, iat: Date.now(), exp: Date.now() + ttlMs };
    if (!payload.sub) throw new Error("session issue 须带 sub（operatorId）");
    const payloadB64 = b64url(JSON.stringify(payload));
    return `${payloadB64}.${sign(payloadB64)}`;
  }

  function verify(cookieValue) {
    if (typeof cookieValue !== "string") return null;
    const dot = cookieValue.lastIndexOf(".");
    if (dot <= 0) return null;
    const payloadB64 = cookieValue.slice(0, dot);
    const signature = cookieValue.slice(dot + 1);
    if (!constantTimeEqual(sign(payloadB64), signature)) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")); } catch (_error) { return null; }
    if (!payload || typeof payload.sub !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  }

  return { cookieName, ttlMs, issue, verify };
}

module.exports = { createSessionCookieService };
