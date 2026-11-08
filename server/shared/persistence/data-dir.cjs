// Component: Persistence-Data-Dir
// @responsible: SPEC-012 持久层住址解析——②③④类应用运行时数据的唯一物理根（repo 侧 data/，不进版本史）。
// @inputs: 环境变量 KB_DATA_DIR（显式注入：e2e 临时目录/单测）；缺省 repo 根 data/
// @outputs: resolveDataDir() / dataDbPath(name)
// @context: repo（cheeseh 仓）；vault 外（分层契约：vault 只剩①⑤）
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * 解析持久层数据目录（幂等，含建目录）。
 * @param {{ dir?: string }} [options] 测试缝：显式目录优先于环境变量与缺省
 * @returns {string} 绝对路径（已 mkdir -p）
 */
function resolveDataDir(options) {
  const dir = (options && options.dir) || process.env.KB_DATA_DIR || path.join(REPO_ROOT, "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.resolve(dir);
}

/** 库文件路径（三库：derived-index.db / runtime-state.db / telemetry.db）。 */
function dataDbPath(name, options) {
  return path.join(resolveDataDir(options), name);
}

/**
 * 图族 staging 落点（Python extract_graph 写 / Node ingest 读的同一目录）。
 * 类消收敛（SPEC-012 wave-2，Master 裁 2026-10-15）：staging 路径在 Python 侧单源于
 * kb_paths.staging_path、Node 侧单源于此——搬家只改这两处，消费方零感知。
 */
function stagingPath(name, options) {
  return path.join(resolveDataDir(options), "staging", name);
}

module.exports = { resolveDataDir, dataDbPath, stagingPath, REPO_ROOT };
