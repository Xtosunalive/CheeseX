'use strict';
// Component: Read-Model-Port（查询入口读模型版本身份——WP-055／SPEC-049，ADR-016 §二查询入口律文）
// @responsible: 读模型版本身份的现场计算聚合：graph（staging master_graph 内容哈希）＋
//   derived（derived-index syncState 最新 ok 行 content_hash）＋vocab（五件词表指纹聚合）→
//   单一版本对象。**零落库零缓存**（ADR-015：版本是现场计算的身份聚合，不是存储的第二权威——
//   每次现算；组件字节同则版本同，任一组件变则版本变——「新鲜与否由读模型版本决定」）。
//   重建即翻新：derived/rebuild 成功后组件哈希自然变化 ⇒ 版本翻新（无独立翻新逻辑可锈）。
// @inputs: vaultPath（阶梯）、dataDir（staging/derived 库寻址）
// @outputs: getReadModelVersion({ vaultPath, dataDir }) → { version, components, computedAt }
// @context: Vault（Sync；纯读——graph 文件读＋store 查询＋vocab 端口，读放大经 vocab stats 可观测）
const fs = require('node:fs');
const crypto = require('node:crypto');
const { stagingPath } = require('./persistence/data-dir.cjs');
const { getDerivedIndexStore } = require('./persistence/derived-index-store.cjs');
const { loadVocabBundle, VOCAB_FILE_NAMES } = require('./vocab-load-port.cjs');
// WP-056 G-A：DB 真身读取收编（委托——master-graph-service 仍是实现本体，注入分发链不动）
const masterGraphService = require('../services/projection/master-graph-service.cjs');
const { readGraphArtifactText } = require('./persistence/graph-artifact-ingest.cjs');

function sha256Of(absPath) {
  try {
    return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch (_error) {
    return null; // 组件缺席＝版本组件显式 null（未建/未跑——不是错误态）
  }
}

/** graph 组件：staging master_graph.json 内容哈希（图读模型本体——extract_graph 落点）。 */
function graphComponent(vaultPath, dataDir) {
  return sha256Of(stagingPath('master_graph.json', { dir: dataDir, vaultPath }));
}

/** derived 组件：derived-index syncState 最新 ok 行 content_hash（②类投影身份）。 */
function derivedComponent(vaultPath) {
  try {
    const last = getDerivedIndexStore(vaultPath).syncState.lastSync();
    return last && last.status === 'ok' && last.content_hash ? `sha256:${last.content_hash}` : null;
  } catch (_error) {
    return null;
  }
}

/** vocab 组件：五件词表指纹聚合（WP-049 端口——missing 件以 name:null 计入，缺件也参与版本）。 */
function vocabComponent(vaultPath) {
  const bundle = loadVocabBundle(vaultPath, { warn: () => {} });
  const fingerprints = {};
  for (const name of VOCAB_FILE_NAMES) {
    const file = bundle.files[name];
    fingerprints[name] = file && file.state === 'present' ? file.fingerprint : null;
  }
  return crypto.createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex');
}

/**
 * raw 图读出口（WP-058 X-A：原文行读＋parse，失败 null——**不校验格式版本、不合并账本状态**）。
 * 消费方：review 结构匹配等需要裸图的页面族面（语义自 main.cjs 本地 readMasterGraph 原样迁入——
 * 与 getGraph（governed：格式校验＋账本合并）双语义并存，合并语义统一属未来 Master 裁决）。
 */
function getRawGraph(vaultPath) {
  try {
    const raw = readGraphArtifactText(getDerivedIndexStore(vaultPath));
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

/**
 * SA 族 staging 工件读取出口（WP-057 S-A：semantic/layout 两件——PR-082 派生通用槽
 * staging/sa/；缺件逐件显式 null）。消费方：check-data-chain（管线工件验收语义）。
 */
function getStagedSAArtifacts(dataDir) {
  const read = (name) => {
    const p = stagingPath(`sa/${name}`, { dir: dataDir });
    try {
      return { path: p, raw: fs.readFileSync(p, 'utf8') };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { path: p, raw: null };
      throw error;
    }
  };
  return { semantic: read('semantic_architecture.json'), layout: read('architecture_layout.json') };
}

/**
 * DB 真身读取出口（G-A：查询族图读取唯一公开面——委托 master-graph-service.readMasterGraph，
 * 注入分发链不动）。消费方：main.cjs 注入链（页面/分析）——后续批迁此出口。
 */
function getGraph(vaultPath) {
  masterGraphService.setVaultPath(vaultPath);
  return masterGraphService.readMasterGraph();
}

/**
 * staging 管线工件读取出口（G-A：管线落点工件验收语义——extract_graph 落点，摄取前最新图；
 * SPEC-012 wave-2 勘定：此读不是读模型事实源，是工件验收）。返回 { path, raw }；缺件 raw=null。
 */
function getStagedGraphArtifact(dataDir) {
  const p = stagingPath('master_graph.json', { dir: dataDir });
  try {
    return { path: p, raw: fs.readFileSync(p, 'utf8') };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { path: p, raw: null };
    throw error;
  }
}

/**
 * 读模型版本身份（现场计算聚合——Q1 确定性：组件字节同则版本同）。
 * @returns {{ version: string, components: { graph, derived, vocab }, computedAt: string }}
 */
function getReadModelVersion({ vaultPath, dataDir } = {}) {
  const components = {
    graph: graphComponent(vaultPath, dataDir),
    derived: vaultPath ? derivedComponent(vaultPath) : null,
    vocab: vaultPath ? vocabComponent(vaultPath) : vocabComponent(vaultPath),
  };
  const version = 'rm1:' + crypto.createHash('sha256').update(JSON.stringify(components)).digest('hex').slice(0, 32);
  return { version, components, computedAt: new Date().toISOString() };
}

module.exports = { getReadModelVersion, getGraph, getRawGraph, getStagedGraphArtifact, getStagedSAArtifacts };
