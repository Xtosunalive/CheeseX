#!/usr/bin/env node
/**
 * run-ci-gates.mjs — 注册表驱动的 CI 门禁执行器（结构收口批，TALOS「声明即分发」补完）
 *
 * 立项目的：消灭「检查的声明与执行面分离」——quality-gates.json 是唯一声明，
 *   CI 面从此是它的投影（本执行器），不再存在手工逐条接线的 workflow 步骤。
 *   新增/退役门禁＝改注册表一个文件；漏接线这一类问题构造性不可能。
 *   （前史：gate-wiring 门禁的三类对账 + register-coverage 测试的 STEP_NAMES 防漂移，
 *   均为「执行面手工维护」时代的补丁——随投影落地失业退役。）
 *
 * 行为：
 *   - 依序执行 contracts/quality-gates.json 中 execution="ci" 的全部门禁 command；
 *   - 每门禁独立 ::group 日志（GitHub UI 分组可见）；
 *   - 结果落 test-results/ci-gates.json（register-coverage 的摄取面——name=gateId）；
 *   - 汇总表打 stdout；任一失败 exit 1（结果文件始终写出——失败也在写完之后退出）。
 *
 * 用法：node scripts/quality/run-ci-gates.mjs（npm run gates:ci）
 *   门禁需要的环境（VAULT_PATH 等）由 workflow job 层提供；缺环境的门禁自述 skip。
 */

import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_REL = "contracts/quality-gates.json";
const RESULTS_REL = "test-results/ci-gates.json";

const registry = JSON.parse(readFileSync(path.join(ROOT, REGISTRY_REL), "utf8"));
const ciGates = (registry.gates || []).filter((g) => g && g.execution === "ci" && g.status !== "retired"); // retired 构造性退出 CI（结构法审计批）

if (ciGates.length === 0) {
  console.error("run_ci_gates=FAIL 注册表无 execution=ci 门禁——注册表不可读或为空");
  process.exit(1);
}

// 增量写出＋进行中标记：register-coverage 作为门禁在循环内执行时即可读到「已完成的门禁」，
// 且据 GATES_RUNNER 标记把「文件尚未产生」识别为「本轮进行中」而非缺失（自指时序的类内解）。
process.env.GATES_RUNNER = "1";
const writeResults = (results) => {
  mkdirSync(path.join(ROOT, path.dirname(RESULTS_REL)), { recursive: true });
  writeFileSync(path.join(ROOT, RESULTS_REL), JSON.stringify({ generatedAt: new Date().toISOString(), inProgress: results.length < ciGates.length, results }, null, 2) + "\n");
};

const results = [];
for (const gate of ciGates) {
  const startedAt = Date.now();
  console.log(`::group::[${gate.id}] ${gate.command}`);
  let conclusion = "success";
  try {
    execSync(gate.command, { cwd: ROOT, stdio: "inherit", env: process.env, timeout: 20 * 60 * 1000 });
  } catch (error) {
    conclusion = error.killed && error.signal === "SIGTERM" ? "timeout" : "failure";
    console.error(`::error title=${gate.id}::门禁 ${gate.id} 红（exit ${error.status ?? error.signal ?? "?"}）`);
  }
  const durationMs = Date.now() - startedAt;
  results.push({ gateId: gate.id, command: gate.command, conclusion, durationMs });
  writeResults(results);
  console.log("::endgroup::");
}

const failed = results.filter((r) => r.conclusion !== "success");
console.log("\n════════ 门禁汇总（注册表投影 · " + results.length + " 台）════════");
for (const r of results) {
  console.log(`${r.conclusion === "success" ? " ✓" : " ✗"} ${r.gateId.padEnd(26)} ${String(r.durationMs).padStart(7)}ms  ${r.command}`);
}
if (failed.length > 0) {
  console.error(`\nrun_ci_gates=FAIL ${failed.length}/${results.length} 红：${failed.map((r) => r.gateId).join(", ")}`);
  process.exit(1);
}
console.log(`\nrun_ci_gates=ok gates=${results.length}`);
