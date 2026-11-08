'use strict';
// Component: Status-Domain（状态域单源——WP-049 余量批／SPEC-044 C4）
// @responsible: 旧值→四值映射的唯一取数点：TheSchema enums.lifecycle.legacy_status_map（经词表
//   装载端口）。实证清单 P6「手抄份数最多的一族」（三映射表＋两值表）收敛：消费方（entity-repair／
//   status-event-writer／reconcile 脚本）一律经本模块，禁再手抄。四值本体单源＝contracts/
//   entity-readiness-rules.json.statusMachine（状态机语义宿主）；TheSchema lifecycle.status 为
//   词表声明面——两面对账由测试钉住（server/services/entity-compliance/__tests__/status-domain-ssot.test.cjs）。
// @inputs: vaultPath（经装载端口读 enums）
// @outputs: legacyStatusMap(vaultPath) / normalizeStatus(value, vaultPath) / statusFourValues(vaultPath)
// @context: Vault（Sync）
const { loadVocabBundle } = require('./vocab-load-port.cjs');

function lifecycleOf(vaultPath) {
  const file = loadVocabBundle(vaultPath, { files: ['enums'] }).files.enums;
  const lifecycle = file && file.state === 'present' && file.data && file.data.lifecycle;
  return lifecycle && typeof lifecycle === 'object' ? lifecycle : {};
}

/** 旧值→四值映射（TheSchema 声明单源；缺省空映射＝无存量迁移面） */
function legacyStatusMap(vaultPath) {
  const map = lifecycleOf(vaultPath).legacy_status_map;
  return map && typeof map === 'object' ? map : {};
}

/** 四值（TheSchema 词表声明面；状态机/迁移语义宿主在 contracts/entity-readiness-rules.json） */
function statusFourValues(vaultPath) {
  const values = lifecycleOf(vaultPath).status;
  return Array.isArray(values) ? values : [];
}

/** 存量值归一：旧值映射到四值，新值透传（与旧 normalizeStatus 语义一致） */
function normalizeStatus(value, vaultPath) {
  const s = typeof value === 'string' ? value.trim() : '';
  return legacyStatusMap(vaultPath)[s] || s;
}

module.exports = { legacyStatusMap, normalizeStatus, statusFourValues };
