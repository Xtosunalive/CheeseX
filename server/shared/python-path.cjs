// Component: Python-Path — 外部进程解释器解析的唯一事实源（ADR-002 / W2-WP3）。
// @responsible: 单点解析「带 PyYAML 的解释器」路径；全库禁止在调用点各自写 PYTHON_PATH 回退。
// @inputs: 环境变量 PYTHON_PATH
// @outputs: resolvePythonPath() → string
//
// 语义：process.env.PYTHON_PATH 优先（.env.example 自检：该路径须可 import yaml），回退 "python3"。
// 调用方（2026-09-21）：python-bridge（管线异步流式）、article-draft-workflow（spawnSync ×2）、
// version-registry-service（spawnSync）、scripts/quality/check-data-chain.mjs（门禁）。
// 调用方（2026-10-28，WP-031）：routes/__tests__/gap-exempt-http.test.cjs（预抽取 spawnSync——
// 豁免闭环 L3 真进程夹具）。
// 新增调用点必须在本文件头部注释与 .env.example 清单同步登记（防清单失真）。
function resolvePythonPath() {
  return process.env.PYTHON_PATH || "python3";
}

module.exports = { resolvePythonPath };
