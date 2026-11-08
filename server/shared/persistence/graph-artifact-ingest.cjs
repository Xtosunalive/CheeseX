// Component: Graph-Artifact-Ingest
// @responsible: SPEC-012 wave-2 图族摄取——data/staging 的 master_graph/extract_manifest 原文
//   摄入 derived-index.db（字节精确，管线指纹 sha256 口径不变）。触发：boot＋管线完成钩（双点幂等）。
// @inputs: dataDir（KB_DATA_DIR）；derivedIndex store
// @outputs: ingestStagedGraphArtifacts() → { graph: bool, manifest: bool }
// @context: data/staging（Python extract_graph 的落点；vault 不再承载图投影）

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { stagingPath } = require("./data-dir.cjs");

const STAGED = {
  graph: { name: "master_graph", file: "master_graph.json" },
  manifest: { name: "extract_manifest", file: "extract_manifest.json" },
  // PR-082（Master 2026-10-20 批）：SA 族入图族摄取——generate-sa 通用槽产物（staging/sa/）
  sa: { name: "sa", file: "sa/semantic_architecture.json" },
  saLayout: { name: "sa_layout", file: "sa/architecture_layout.json" },
};

/**
 * 幂等摄取 staging 两件到库（文件缺席跳过；读取失败只告警——派生物摄取失败不阻断主链路）。
 * @param {{ dataDir: string, store: object, logger?: object }} input
 */
function ingestStagedGraphArtifacts({ dataDir, store, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const result = { graph: false, manifest: false };
  for (const key of Object.keys(STAGED)) {
    const { name, file } = STAGED[key];
    const source = stagingPath(file, { dir: dataDir }); // 落点单源（类消收敛）：与 Python kb_paths 同构
    try {
      if (!fs.existsSync(source)) continue;
      const raw = fs.readFileSync(source, "utf8");
      if (!raw.trim()) continue;
      store.artifacts.put(name, raw);
      result[key] = true;
    } catch (error) {
      log.warn({ event: "graph-artifact-ingest-failed", artifact: name, error: error.message });
    }
  }
  if (result.graph || result.manifest) {
    log.info({ event: "graph-artifacts-ingested", graph: result.graph, manifest: result.manifest });
  }
  return result;
}

/** 库内图原文（字节精确）；无图返回 null。消费方经此取字节算 sha256/解析。 */
function readGraphArtifactText(store) {
  const raw = store.artifacts.get("master_graph");
  return raw === undefined ? null : raw;
}

/** 库内清单原文；无返回 null。 */
function readExtractManifestText(store) {
  const raw = store.artifacts.get("extract_manifest");
  return raw === undefined ? null : raw;
}

// PR-084：readSaArtifactText 退役——SA/layout 族读取统一经读侧唯一咽喉 server/shared/frozen-artifact-reader.cjs
// （注册制：contracts/frozen-artifacts.registry.json 的槽名即读取路径；本模块只保留摄取与图族两件原语）。

module.exports = { ingestStagedGraphArtifacts, readGraphArtifactText, readExtractManifestText, STAGED };
