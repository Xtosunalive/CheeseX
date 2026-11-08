// Component: Vault-Paths-Resolver
// @responsible: 基于 Vault 根和 schema 配置解析图谱、SA、layout 与仪表盘路径。
// @inputs: Vault 根路径与 architecture_projection 配置
// @outputs: 各类 Vault 产物绝对路径
// @context: Vault
// Ported from 架构图系统/electron/vault-paths.cjs, adapted for rebuild project.
const path = require("path");
const { resolveTheSchemaDir } = require("./shared/theschema-root.cjs");

// PR-243 批B（2026-11-04）：账本目录名唯一真身——`.anyshare` 为实例产品名残留，退役改 `.ledger`
// （Master 2026-11-04「这不应该硬编码」＋「批准退役/批B」；append-only 语义不变，见 SPEC-081 §一.2）。
// 本模块是 vault 侧账本路径的唯一出处；新增账本文件一律在此登记助手，禁止散点直拼目录名。
const LEDGER_DIRNAME = ".ledger";

function getLedgerDir(vaultPath) {
  return path.join(vaultPath, LEDGER_DIRNAME);
}

function getDecisionsLogPath(vaultPath) {
  return path.join(getLedgerDir(vaultPath), "decisions.jsonl");
}

function getChannelWriteLogPath(vaultPath) {
  return path.join(getLedgerDir(vaultPath), "channel-write-log.jsonl");
}

function getStateJournalPath(vaultPath) {
  return path.join(getLedgerDir(vaultPath), "state-journal.jsonl");
}

function getGovernanceActionsPath(vaultPath) {
  return path.join(getLedgerDir(vaultPath), "governance_actions.json");
}

function getMasterFilePath(vaultPath) {
  return path.join(getLedgerDir(vaultPath), "master_graph.json");
}



function getDashboardDataPath(vaultPath) {
  return path.join(getLedgerDir(vaultPath), "dashboard_data.json");
}

function getEnumsFilePath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), "enums.yaml");
}

function getOntologyFilePath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), "ontology.yaml");
}

function getDependenciesFilePath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), "dependencies.yaml");
}

function getRelationsFilePath(vaultPath) {
  // EDGE-RELATION-GOV-001 对象本体批（ADR-012 D1）：人工/治理关系实例账——①类 TheSchema 源
  return path.join(resolveTheSchemaDir(vaultPath), "relations.yaml");
}

function getVersionsFilePath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), "versions.yaml");
}

function getVersionSnapshotPath(vaultPath, product, version) {
  return path.join(vaultPath, "知识库", "architecture", product, version, "architecture-version.snapshot.json");
}

function getVaultKnowledgePath(vaultPath) {
  return path.join(vaultPath, "知识库");
}

function ensureLedgerDir(vaultPath) {
  const fs = require("fs");
  const dir = getLedgerDir(vaultPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  getMasterFilePath,
  getDashboardDataPath,
  getEnumsFilePath,
  getOntologyFilePath,
  getDependenciesFilePath,
  getRelationsFilePath,
  getVersionsFilePath,
  getVersionSnapshotPath,
  getVaultKnowledgePath,
  ensureLedgerDir,
  getLedgerDir,
  getDecisionsLogPath,
  getChannelWriteLogPath,
  getStateJournalPath,
  getGovernanceActionsPath,
};
