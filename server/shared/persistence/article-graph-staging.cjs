"use strict";

// WP-170：文章关系候选的 staging 图读写（persistence 层——SPEC-012 WP-J 豁免面：
// data/staging 为图族工件瞬态出口，非 vault 数据；原子写 temp+rename 与 review-action-store 同款）。
const fs = require("node:fs");
const path = require("node:path");

function stagingGraphPath(dataDir) {
  return path.join(dataDir, "staging", "master_graph.json");
}

function readStagedGraph(dataDir) {
  const p = stagingGraphPath(dataDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeStagedGraph(dataDir, graph) {
  const p = stagingGraphPath(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.wp170-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(graph), "utf8");
  fs.renameSync(tmp, p);
}

module.exports = { stagingGraphPath, readStagedGraph, writeStagedGraph };
