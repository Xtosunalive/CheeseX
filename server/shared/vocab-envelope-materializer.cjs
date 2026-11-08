'use strict';
// Component: Vocab-Envelope-Materializer（词表信封物化——WP-049 L3／SPEC-044 C2）
// @responsible: Node→Python 拉起点的信封物化器：装载入口产出五件词表类型化载荷，
//   写入执行库运行时槽 <vault>/.ledger/vocab-envelope.json（原 .anyshare，PR-243 批B 退役），路径经 VOCAB_ENVELOPE_PATH
//   下发——Python 全链零词表文件读取（ADR-016 §四-2 裁决「装载收进同一宿主」）。
//   每次拉起前重写（无陈旧面：内容恒由本次装载产出）；槽位在 vault 运行时状态区，
//   不入 git、无跨库碰撞（每库各一份）。
// @inputs: vaultPath（与下游 Python 同一库根——阶梯解析结果两侧一致）
// @outputs: 信封文件绝对路径
// @context: Vault（Sync；pipeline-run-service／article-draft-workflow 拉起前调用）
const fs = require('node:fs');
const path = require('node:path');
const { loadVocabBundle, serializeVocabEnvelope, allDocNames } = require('./vocab-load-port.cjs');

function materializeVocabEnvelope(vaultPath, options) {
  // WP-054 E-A：缺省携带扩展件（五件＋扩展件；缺件不入 files/指纹——SPEC-049 X2）。
  // 显式 options.files 时完全尊重调用方选择。
  const merged = options && options.files ? options : { ...(options || {}), files: allDocNames() };
  const bundle = loadVocabBundle(vaultPath, merged);
  const envelope = serializeVocabEnvelope(bundle);
  const target = path.join(require("../vault-paths.cjs").getLedgerDir(path.resolve(vaultPath)), "vocab-envelope.json"); // PR-243 批B：单源
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(envelope));
  return target;
}

module.exports = { materializeVocabEnvelope };
