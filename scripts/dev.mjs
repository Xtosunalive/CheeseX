import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runFirstRun } from "./first-run.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteEntry = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const apiEntry = path.join(rootDir, "server", "main.cjs");
const children = [];
let shuttingDown = false;
const apiPort = process.env.API_PORT || "18083";
const vitePort = process.env.VITE_PORT || "5174";

// 首次启动接线（WP-021）：没有可用知识库时问一句位置即建（复用 vault-init），再起服务；
// 非交互终端不替人决定，打印命令指引退出 1。已就位时零提问直通。
const firstRun = await runFirstRun({ rootDir });
if (firstRun.action === "abort") process.exit(firstRun.exitCode);
if (firstRun.vaultPath && !process.env.VAULT_PATH) process.env.VAULT_PATH = firstRun.vaultPath;

function start(name, entry, args = [], nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, entry, ...args], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`[dev] ${name} stopped (${reason}); stopping the other service.`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(exitCode), 250);
}

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";

  while (Date.now() < deadline && !shuttingDown) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      await response.text();
      if (response.ok) {
        console.log(`[dev] ${label} ready (${url})`);
        return true;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.error(`[dev] ${label} did not become ready: ${lastError}`);
  return false;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Node 原生 --watch（成熟机制，零自研）：API 进程监听自身依赖图（server/**），文件变更自动重启——
// 根除「改了代码但旧进程仍在跑」的假绿事故（#1805/#1809 实录，三次同一根因）。
// watch 排除 contracts/**（03:42 报障根因修复）：契约文件是**数据**不是代码——波3 规则通道
// 的 propose/retire 合法写 contracts/entity-readiness-rules.json 等三文件，node --watch 默认
// 连依赖图里的契约数据一起监听 → 每次立规触发后端重启 → 重启窗口内请求 ECONNREFUSED →
// vite 代理报 502（用户实测：连点立规后 enums/pipeline 轮询撞上）。契约改了该**重读**（服务
// 每次 discovery/lifecycle 调用本来就现读文件），重启只该由代码变更触发。
// --watch-path=server/：监听面收窄到代码目录（node --watch 显式指定后不再扫依赖图外文件）。
start("API", apiEntry, [], ["--watch", `--watch-path=${path.join(rootDir, "server")}`]);
start("Vite", viteEntry, [
  ...process.argv.slice(2),
  "--port",
  vitePort,
  "--strictPort",
]);

const readiness = await Promise.all([
  waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, "API"),
  waitForHttp(`http://127.0.0.1:${vitePort}/`, "Vite"),
]);

if (readiness.includes(false)) {
  console.error("[dev] Startup failed; stopping both services.");
  shutdown(1);
}
