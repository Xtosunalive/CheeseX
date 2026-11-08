#!/usr/bin/env node
// E2E 契约锚定器：脚本启动时断言自己调用的每个 API 端点存在于 OpenAPI 契约。
// 背景（#1828 家族事故，老库实录）：E2E 调用契约中不存在的"幽灵端点"，404 被静默
// 降级照绿——6 个幽灵端点带病全绿数月。本锚定器把"引用即声明"变成"引用即校验"：
// 端点从契约里消失时，脚本在发出第一个请求前就 fail-closed，而非跑到一半才莫名 404。
// 用法：import { assertEndpointsInContract, api } from "./lib/contract-anchor.mjs";
//   assertEndpointsInContract(["GET /api/health", "POST /api/kg/review"]);  // 启动时调用
//   api("/api/health")  — 与原 fetch 封装同参（base 自动取 API_BASE 环境变量）
// 检查语义：路径模板比对（/api/articles/precleaned/{id} 匹配实际调用 /api/articles/precleaned/abc123），
//   方法逐个核对；契约缺端点或方法 → 立即 throw（列出缺失清单），进程退出非零。
// 边界：本锚定器只校验"端点存在性与方法"，不校验请求/响应体形状（那归运行时探针管）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(__dirname, "..", "..", "..", "contracts", "http-api.openapi.json");

function loadContractPaths() {
  const spec = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  return spec.paths || {};
}

/** 把实际路径匹配到契约模板（/api/x/{id} ↔ /api/x/abc）。返回契约模板键或 null。 */
export function matchContractTemplate(actualPath, contractPaths) {
  if (contractPaths[actualPath]) return actualPath;
  const actualSegs = actualPath.split("/").filter(Boolean);
  for (const template of Object.keys(contractPaths)) {
    const tSegs = template.split("/").filter(Boolean);
    if (tSegs.length !== actualSegs.length) continue;
    const hit = tSegs.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === actualSegs[i]);
    if (hit) return template;
  }
  return null;
}

/**
 * 断言一组端点（"METHOD /path" 形式）全部存在于契约。
 * @param {string[]} endpoints 例如 ["GET /api/health", "POST /api/kg/review"]
 * @throws {Error} 任一端点缺失时列出完整缺失清单后抛出（fail-closed，不带病运行）
 */
export function assertEndpointsInContract(endpoints) {
  const contractPaths = loadContractPaths();
  const missing = [];
  for (const entry of endpoints) {
    const trimmed = entry.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const method = (spaceIdx === -1 ? "GET" : trimmed.slice(0, spaceIdx)).toUpperCase();
    const actualPath = spaceIdx === -1 ? trimmed : trimmed.slice(spaceIdx + 1).trim();
    const template = matchContractTemplate(actualPath, contractPaths);
    if (!template) {
      missing.push(`${method} ${actualPath} → 契约无此路径`);
      continue;
    }
    const methodLower = method.toLowerCase();
    if (!(methodLower in contractPaths[template])) {
      missing.push(`${method} ${actualPath} → 契约路径 ${template} 存在但无此方法（有：${Object.keys(contractPaths[template]).join(",")}）`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[contract-anchor] E2E 幽灵端点检测失败（fail-closed，防 #1828 家族事故）：\n` +
        missing.map((m) => `  - ${m}`).join("\n") +
        `\n  契约事实源：contracts/http-api.openapi.json`
    );
  }
  return true;
}
