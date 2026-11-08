#!/usr/bin/env node
// Component: E2E-Stack（e2e 自起受控服务栈）
// @responsible: 复用域 runtime-scope 波1（PR-120）——e2e 不再搭常驻服务：harness 自起 API＋Vite，
//   进程环境经 buildE2EEnv 钉作用域全集（服务与其 spawn 的管线全部落临时目录／fixture），
//   起后经 requireE2EServiceScope 取 /api/health.vaultId 对账（起了也要证明，不信端口）。
//   启动形态借 scripts/dev.mjs（vite.js 入口＋--port/--strictPort；API_PORT 驱动 vite 代理）与
//   persistence-journey.e2e.mjs（spawn server/main.cjs＋轮询 readyState）。
// @outputs: startE2EStack({ vaultPath }) → { apiBase, baseUrl, env, stop() }
// @context: E2E scripts only — never imported by server/
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildE2EEnv, requireE2EServiceScope } from "./e2e-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_ENTRY = path.join(REPO_ROOT, "server", "main.cjs");
const VITE_ENTRY = path.join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, { timeoutMs, pred }) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) {
        if (!pred) return true;
        const body = await res.json().catch(() => null);
        if (pred(body)) return true;
        last = `200 但未就绪：${JSON.stringify(body).slice(0, 120)}`;
      } else last = `HTTP ${res.status}`;
    } catch (e) { last = e?.message || String(e); }
    await sleep(500);
  }
  throw new Error(`等待 ${url} 超时（${timeoutMs}ms）：${last}`);
}

function spawnLogged(label, args, env, logs) {
  const child = spawn(process.execPath, args, { env, cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const sink = (d) => { const s = d.toString(); logs[label] = (logs[label] || "") + s; if (process.env.E2E_STACK_VERBOSE === "1") process.stderr.write(`[${label}] ${s}`); };
  child.stdout.on("data", sink);
  child.stderr.on("data", sink);
  return child;
}

/**
 * startE2EStack({ vaultPath, withVite=true, readyTimeoutMs=90000 })
 * @returns {Promise<{apiBase:string, baseUrl:string|null, env:NodeJS.ProcessEnv, apiPort:number, vitePort:number|null, stop:()=>Promise<void>, logs:Record<string,string>}>}
 */
export async function startE2EStack({ vaultPath, withVite = true, readyTimeoutMs = 90000 } = {}) {
  if (!vaultPath) throw new Error("startE2EStack: vaultPath 必填（经 requireE2EVault 验证）");
  const apiPort = await freePort();
  const vitePort = withVite ? await freePort() : null;
  const env = buildE2EEnv(vaultPath);
  env.API_PORT = String(apiPort);
  if (vitePort) env.VITE_PORT = String(vitePort);
  if (!env.VAULT_GIT_LEDGER_DISABLE) env.VAULT_GIT_LEDGER_DISABLE = "1"; // 同 persistence-journey：fixture 不落 git 账
  const logs = {};
  const children = [];
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const baseUrl = vitePort ? `http://127.0.0.1:${vitePort}` : null;

  const stop = async () => {
    for (const c of children) { try { c.kill("SIGTERM"); } catch { /* 已退出 */ } }
    const deadline = Date.now() + 8000;
    while (children.some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) await sleep(100);
    for (const c of children) if (c.exitCode === null && c.signalCode === null) { try { c.kill("SIGKILL"); } catch { /* 已退出 */ } }
  };

  try {
    children.push(spawnLogged("API", [API_ENTRY], env, logs));
    await waitHttp(`${apiBase}/api/health`, { timeoutMs: readyTimeoutMs, pred: (b) => b?.data?.readyState === "ready" });
    await requireE2EServiceScope(apiBase, vaultPath); // 自起的也要证明——不以端口推定作用域
    if (vitePort) {
      children.push(spawnLogged("Vite", [VITE_ENTRY, "--port", String(vitePort), "--strictPort"], env, logs));
      await waitHttp(`${baseUrl}/`, { timeoutMs: readyTimeoutMs });
    }
  } catch (e) {
    await stop();
    const tail = Object.entries(logs).map(([k, v]) => `--- ${k} 末 20 行 ---\n${v.split("\n").slice(-20).join("\n")}`).join("\n");
    throw new Error(`startE2EStack 失败：${e?.message || e}\n${tail}`);
  }
  return { apiBase, baseUrl, env, apiPort, vitePort, stop, logs };
}
