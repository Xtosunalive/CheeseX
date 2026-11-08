#!/usr/bin/env node
// dump-doc-envelope.mjs — 文档信封手工物化 CLI（WP-117 批2／SPEC-084 §二.1）。
// @responsible: 独立手工运行（python3 extract_graph.py 直跑、测试夹具、排查）的信封供给面：
//   Node 侧 doc-envelope-materializer 产出全语料单信封（fm 文本＋body 全文＋逐件指纹）→ 写 JSON。
//   pipeline 拉起点由 vault-runtime-spawn docEnvelope:true 自动物化（拉起前重写），本 CLI 服务
//   手工场景与排查（dump-vocab-envelope.mjs 同款先例）。Python 侧零 .md 直读（ADR-016 §四-2）。
// 用法：node scripts/vault-runtime/dump-doc-envelope.mjs [--vault <vault 根>] [--out <信封路径>]
//   vault 取 --vault ＞ VAULT_PATH ＞ KB_VAULT（缺省即拒——不猜 cwd）；out 缺省
//   <vault>/.ledger/doc-envelope.json（writeDocEnvelope 单源槽位，PR-243，与拉起点自动物化同址）。
// @outputs: stdout doc_envelope=<path> docs=<n>；非零退出＝物化/写失败（fail-closed）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocEnvelope, serializeDocEnvelope, writeDocEnvelope } from "../../server/shared/doc-envelope-materializer.cjs";

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const vault = optionValue(args, "--vault") || process.env.VAULT_PATH || process.env.KB_VAULT;
if (!vault || !fs.existsSync(vault)) {
  console.error("doc_envelope=FAIL vault 未指定或不存在——用 --vault <vault 根> 或设 VAULT_PATH/KB_VAULT（fail-closed，不猜 cwd）");
  process.exit(1);
}

// --out 显式传参＝写到指定位置（测试夹具隔离用，同一 buildDocEnvelope 产物）；缺省走
// writeDocEnvelope 单源槽位（<vault>/.ledger/doc-envelope.json，PR-243）
const out = optionValue(args, "--out");
let target;
if (out) {
  target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeDocEnvelope(buildDocEnvelope(path.resolve(vault))));
} else {
  target = writeDocEnvelope(path.resolve(vault));
}

const docs = JSON.parse(fs.readFileSync(target, "utf8")).documents.length;
console.log(`doc_envelope=${target} docs=${docs}`);
