#!/usr/bin/env node
// Component: Entity-Readiness-CLI
// @responsible: 为直接运行 Pipeline 提供与 HTTP API 同源的入图资格门控。
// @inputs: --vault <Vault root>
// @outputs: readiness JSON；ready=0，blocker=2，执行错误=3
// @context: Pipeline

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// 写入门标识（ADR054 D1 / seq171）：Stage 0.5 作为 entity 规则族的 strict fallback 门（check-write-gate-binding 对账点）
const WRITE_GATE_ID_STAGE_0_5 = "pipeline.stage-0-5";
const routes = require("../../server/routes/entity-compliance-routes.cjs");
const args = process.argv.slice(2);
const vaultIndex = args.indexOf("--vault");
const vaultPath = vaultIndex >= 0 ? args[vaultIndex + 1] : process.env.KB_VAULT || process.env.VAULT_PATH;

if (!vaultPath || path.isAbsolute(vaultPath) === false) {
  process.stderr.write(JSON.stringify({ success: false, error_code: "VALIDATION_ERROR", message: "--vault、KB_VAULT 或 VAULT_PATH 必须提供绝对路径" }) + "\n");
  process.exit(3);
}

try {
  const readiness = routes.buildReadiness(routes.scanAndCheck(vaultPath).results);
  process.stdout.write(JSON.stringify(readiness) + "\n");
  process.exit(readiness.ready ? 0 : 2);
} catch (error) {
  process.stderr.write(JSON.stringify({ success: false, error_code: error.code || "READINESS_FAILED", message: error.message }) + "\n");
  process.exit(3);
}
