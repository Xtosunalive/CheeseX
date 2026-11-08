// Component: Async-Exec
// @responsible: 子进程异步执行统一入口（PR-056）——server 运行时禁止同步子进程（execFileSync/spawnSync
//   在 git/python 慢时冻结事件循环），本模块提供与 spawnSync 同形状的 Promise 结果，
//   调用方从 spawnSync 迁移时保持 error/status/stdout/stderr 语义零变化。
// @inputs: 可执行文件、参数、选项（同 child_process.execFile）
// @outputs: Promise<{ error, status, stdout, stderr }>
// @context: Canvas

"use strict";

const { execFile } = require("node:child_process");

/**
 * 异步执行子进程，返回与 spawnSync 同形状的结果对象。
 * - 进程退出码非零 → error=null、status=退出码（spawnSync 语义：status 承载退出码）
 * - spawn 级失败（可执行文件不存在等）→ error=该 Error、status=1（调用方按 result.error 分支处理）
 */
function runCommand(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error && typeof error.code === "number") {
        resolve({ error: null, status: error.code, stdout: stdout ?? "", stderr: stderr ?? "" });
        return;
      }
      resolve({ error: error || null, status: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

module.exports = { runCommand };
