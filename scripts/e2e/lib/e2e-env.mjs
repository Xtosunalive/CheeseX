#!/usr/bin/env node
// Component: E2E-Env-Guard（e2e 物理隔离守卫）
// @responsible: SPEC-011 WP1——强制 e2e 脚本只能运行在 fixture vault，禁止写入真实 vault。
//   复用域 runtime-scope 首个消费方（PR-120 波1，2026-10-26）：buildE2EEnv 单一构造器钉作用域全集；
//   requireE2EServiceScope 向对端服务取 /api/health.vaultId 对账（服务端作用域证明）。
// @outputs: requireE2EVault()（入口守卫）；resolveE2EVaultPath()（fixture 路径解析）；
//   buildE2EEnv()（起链构造器）；requireE2EServiceScope()（服务端作用域证明）
// @context: E2E scripts only — never imported by server/；只读消费 server/shared/vault-id.cjs（纯函数单源）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeVaultId } from "../../../server/shared/vault-id.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * 解析真实 vault 路径（从 cheeseh .env 的 VAULT_PATH 读取）。
 * 只从 .env 文件读取，不回退到 process.env（避免和当前测试 VAULT_PATH 比较自身）。
 * @returns {string|null} 真实 vault 路径，或 null（.env 不存在或无 VAULT_PATH）
 */
function resolveRealVaultPath() {
  const envFile = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envFile)) return null;
  try {
    const line = fs.readFileSync(envFile, "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("VAULT_PATH="));
    if (!line) return null;
    return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

/**
 * requireE2EVault() — e2e 脚本头部守卫。
 *
 * 校验规则（任一触发则抛错，exit code 非 0）：
 *   1. VAULT_PATH 未设置 → 拒绝（防裸跑）
 *   2. VAULT_PATH 解析后与真实 vault 路径一致 → 拒绝（防写入真实仓）
 *   3. VAULT_PATH 路径字符串中不含 "e2e" 且非临时目录（/tmp, /var/folders）→ 拒绝（防意外指向）
 *
 * 正常退出条件：路径含 "e2e" 或为 /tmp 下目录，且不等于真实 vault。
 */
/**
 * ensureE2EDataDir() — SPEC-012 持久层 e2e 隔离。
 * e2e 起的 server 若不带 KB_DATA_DIR 会写 repo/data（污染开发数据）——
 * 统一重定向到 fixture 同级临时目录（含 "e2e" 字样，与 vault 隔离同款形态）。
 * @returns {string} 临时 data 目录绝对路径（已 mkdir）
 */
export function ensureE2EDataDir() {
  // 每次运行全新临时目录（SPEC-012）：runtime_migration 幂等标记随库走——复用旧目录会让
  // 新建 fixture vault 的 boot 导入被误跳过；os.tmpdir 下 e2e- 前缀便于辨认与清理。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-data-"));
  return base;
}

/**
 * buildE2EEnv(fixtureVault) — e2e 起链的单一作用域构造器（复用域 runtime-scope 规则
 * launch_pins_full_set；蓝本 scripts/test-node.mjs buildRunnerEnv）。
 * 钉入 contracts/runtime-scope.json 登记的 write_sensitive 变量全集，让 e2e 自起的服务及其
 * spawn 的管线（python-bridge 继承 process.env）没有一个写面落回宿主仓或真库：
 *   KB_DATA_DIR／PIPELINE_TRAJECTORIES_DIR／DECISIONS_MIRROR_DIR／TAXONOMY_OBSERVATIONS_FILE
 *   → 一次性临时目录；THESCHEMA_DIR → fixture 自带的 知识库/TheSchema（显式钉死，不走三级阶梯）；
 *   VAULT_PATH／KB_VAULT → fixture。调用方显式给出的值不覆盖（与 buildRunnerEnv 同约定）。
 * @param {string} fixtureVault 经 requireE2EVault() 验证过的 fixture 绝对路径
 * @param {NodeJS.ProcessEnv} [baseEnv=process.env]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildE2EEnv(fixtureVault, baseEnv = process.env) {
  const env = { ...baseEnv };
  const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  env.VAULT_PATH = fixtureVault;
  if (!env.KB_VAULT) env.KB_VAULT = fixtureVault;
  if (!env.KB_DATA_DIR) env.KB_DATA_DIR = tmp("e2e-data-");
  if (!env.PIPELINE_TRAJECTORIES_DIR) env.PIPELINE_TRAJECTORIES_DIR = tmp("e2e-trajectories-");
  if (!env.DECISIONS_MIRROR_DIR) env.DECISIONS_MIRROR_DIR = tmp("e2e-mirror-");
  if (!env.TAXONOMY_OBSERVATIONS_FILE) env.TAXONOMY_OBSERVATIONS_FILE = path.join(tmp("e2e-taxonomy-"), "taxonomy-observations.jsonl");
  // GRAPH_DRIFT_REFRESH=0（WP-116 批 2，SPEC-083 §二.4 集成态）：图漂移刷新器对外部写去抖 8s 后
  // 自动拉起全量管线；夹具自带恒 4 blocker 的 incomplete 实体（修复旅程刻意断言面）使任何全量管线
  // fail-closed，其失败把单任务槽共享状态翻成 failed，竞速撞进旅程轮询窗——旅程测试钉 0 隔离后台
  // auto-run（逃生口 graph-drift-refresher.cjs:55）。不隐式回落：显式传入者尊重。
  if (!env.GRAPH_DRIFT_REFRESH) env.GRAPH_DRIFT_REFRESH = "0";
  if (!env.THESCHEMA_DIR) {
    const fixtureSchema = path.join(fixtureVault, "知识库", "TheSchema");
    if (!fs.existsSync(path.join(fixtureSchema, "enums.yaml"))) {
      throw new Error(`E2E_GUARD: fixture 缺 知识库/TheSchema/enums.yaml（${fixtureSchema}）——THESCHEMA_DIR 不隐式回落，请重建 fixture`);
    }
    env.THESCHEMA_DIR = fixtureSchema;
  }
  return env;
}

export const E2E_SCOPE_PINS = ["VAULT_PATH", "KB_VAULT", "KB_DATA_DIR", "PIPELINE_TRAJECTORIES_DIR", "DECISIONS_MIRROR_DIR", "TAXONOMY_OBSERVATIONS_FILE", "THESCHEMA_DIR"];

/**
 * requireE2EServiceScope(apiBase, fixtureVault) — 服务端作用域证明（复用域 runtime-scope 规则
 * service_scope_proof）。e2e 只校验自己进程的 VAULT_PATH 不够：六流默认连 127.0.0.1:18083，谁在听
 * 就写谁的库（PR-120：搭上常驻 dev 服务→测试文章写进用户真库→触发主树管线）。
 * 本守卫向 API_BASE 取 /api/health.vaultId（server/shared/vault-id.cjs computeVaultId 单源），
 * 与 fixture 的 vaultId 对账：不等、取不到、信封缺字段一律 fail-closed 拒跑。
 * @param {string} apiBase 如 http://127.0.0.1:18099
 * @param {string} fixtureVault 经 requireE2EVault() 验证过的 fixture 绝对路径
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, baseUrl?: string}} [opts]
 *   baseUrl（2026-10-27 双通道补丁）：浏览器通道同源校验——playwright 页面所有 API 请求经
 *   前端代理打到 baseUrl/api/*；PR-120 只堵了脚本直连通道，浏览器通道裸奔致 4 篇 e2e 文章
 *   写进真库（2026-10-27 事故实录）。传入即验 baseUrl/api/health 的 vaultId 同 fixture。
 * @returns {Promise<{vaultId: string}>}
 */
export async function requireE2EServiceScope(apiBase, fixtureVault, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const expected = computeVaultId(fixtureVault);
  const url = `${String(apiBase).replace(/\/$/, "")}/api/health`;
  let body;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    const msg =
      "❌ E2E guard: 取不到服务端作用域证明，拒绝运行！\n" +
      `   API_BASE：${apiBase}（GET /api/health 失败：${e?.message || e}）\n` +
      "   e2e 不得对作用域未证明的服务发请求。请让 run-all-e2e 自起受控服务，或显式起一个 VAULT_PATH=fixture 的服务再指定 API_BASE。";
    process.stderr.write(msg + "\n");
    throw new Error("E2E_GUARD: service scope unproven (health unreachable)");
  }
  const actual = body?.data?.vaultId;
  if (typeof actual !== "string" || !actual) {
    process.stderr.write(`❌ E2E guard: /api/health 信封缺 data.vaultId（${JSON.stringify(body).slice(0, 200)}）——无法证明作用域，拒绝运行！\n`);
    throw new Error("E2E_GUARD: service scope unproven (vaultId missing)");
  }
  if (actual !== expected) {
    const msg =
      "❌ E2E guard: API_BASE 所指服务的作用域不是本次 fixture，拒绝运行！\n" +
      `   API_BASE：${apiBase}\n` +
      `   服务端 vaultId：${actual}\n` +
      `   fixture vaultId：${expected}（${fixtureVault}）\n` +
      "   这多半是搭上了常驻 dev 服务（真库）。请让 run-all-e2e 自起受控服务，或起一个 VAULT_PATH=fixture 的服务再指定 API_BASE。";
    process.stderr.write(msg + "\n");
    throw new Error("E2E_GUARD: service scope mismatch");
  }
  // 浏览器通道（双通道补丁 2026-10-27）：BASE_URL 前端代理的后端必须是同一 fixture——
  // 默认 5174 常驻 dev（代理真库）在 fixture 模式下必拒（事故场景：单跑脚本未设 BASE_URL）
  if (typeof opts.baseUrl === "string" && opts.baseUrl.trim()) {
    const frontBase = opts.baseUrl.replace(/\/$/, "");
    const frontUrl = `${frontBase}/api/health`;
    let frontBody;
    try {
      const res = await fetchImpl(frontUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      frontBody = await res.json();
    } catch (e) {
      const msg =
        "❌ E2E guard: 浏览器通道作用域无法证明，拒绝运行！\n" +
        `   BASE_URL：${frontBase}（经前端代理 GET /api/health 失败：${e?.message || e}）\n` +
        "   页面的所有 API 请求都走 BASE_URL 代理——必须指向受控前端（run-all-e2e 自起，或显式指定代理到受控服务的 vite）。";
      process.stderr.write(msg + "\n");
      throw new Error("E2E_GUARD: browser channel scope unproven");
    }
    const frontActual = frontBody?.data?.vaultId;
    if (frontActual !== expected) {
      const msg =
        "❌ E2E guard: BASE_URL 前端代理的后端不是本次 fixture，拒绝运行！\n" +
        `   BASE_URL：${frontBase}（其 /api/health.vaultId：${frontActual}）\n` +
        `   fixture vaultId：${expected}（${fixtureVault}）\n` +
        "   这多半是搭上了常驻 dev 前端（5174→真库 API）。请设 BASE_URL 指向受控前端（其 vite 代理须指向受控 API）。";
      process.stderr.write(msg + "\n");
      throw new Error("E2E_GUARD: browser channel scope mismatch");
    }
  }
  return { vaultId: actual };
}

export function requireE2EVault() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    const msg =
      "❌ E2E guard: VAULT_PATH 未设置。\n" +
      "   请先建立 fixture vault：\n" +
      "     node scripts/e2e/lib/build-e2e-vault.mjs --target /tmp/cheese-e2e --force\n" +
      "   再设置环境变量：VAULT_PATH=/tmp/cheese-e2e";
    process.stderr.write(msg + "\n");
    throw new Error("E2E_GUARD: VAULT_PATH not set");
  }

  const resolved = path.resolve(vaultPath);
  const realVault = resolveRealVaultPath();
  if (realVault && path.resolve(realVault) === resolved) {
    const msg =
      "❌ E2E guard: VAULT_PATH 指向真实 vault，拒绝运行！\n" +
      `   真实 vault：${realVault}\n` +
      `   当前 VAULT_PATH：${vaultPath}\n` +
      "   请改用 fixture vault（含 'e2e' 或 /tmp 路径）。\n" +
      "   建立方法：node scripts/e2e/lib/build-e2e-vault.mjs --target /tmp/cheese-e2e --force";
    process.stderr.write(msg + "\n");
    throw new Error("E2E_GUARD: VAULT_PATH points to real vault");
  }

  const lc = resolved.toLowerCase();
  const isE2E = lc.includes("e2e");
  const isTmp = lc.startsWith("/tmp") || lc.startsWith("/var/folders");
  if (!isE2E && !isTmp) {
    const msg =
      "❌ E2E guard: VAULT_PATH 路径不含 'e2e' 且不在 /tmp——疑似非 fixture vault，拒绝运行！\n" +
      `   当前 VAULT_PATH：${vaultPath}\n` +
      "   请确认使用 fixture vault（路径含 'e2e' 或在 /tmp 下）。";
    process.stderr.write(msg + "\n");
    throw new Error("E2E_GUARD: VAULT_PATH looks like a non-fixture vault");
  }

  return resolved;
}

/**
 * resolveE2EVaultPath() — 返回经过守卫验证的 VAULT_PATH（绝对路径）。
 * 等同于调用 requireE2EVault() 并返回结果。
 */
export function resolveE2EVaultPath() {
  return requireE2EVault();
}
