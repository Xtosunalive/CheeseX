#!/usr/bin/env node
// dump-vocab-envelope.mjs — 词表信封手工物化 CLI（WP-049 L3／SPEC-044 C2）。
// @responsible: 独立 Python CLI（validate-entity／classify 等非 pipeline 拉起的手工运行）的
//   信封供给面：Node 装载入口产出五件词表类型化载荷 → 写 JSON。pipeline 拉起点由
//   pipeline-run-service／article-draft-workflow 自动物化（server/shared/vocab-envelope-materializer.cjs），
//   本 CLI 服务手工场景与排查。Python 侧零词表读取（ADR-016 §四-2）。
// 用法：node scripts/vault-runtime/dump-vocab-envelope.mjs [--vault <vault 根>] [--out <信封路径>]
//   vault 取 --vault ＞ VAULT_PATH ＞ KB_VAULT（缺省即拒——不猜 cwd）；out 缺省
//   <repo>/data/staging/vocab-envelope.json（派生通用槽，SPEC-012 PR-082 同族）。
// @outputs: stdout vocab_envelope=<path> files=<n>；非零退出＝装载/写失败（fail-closed）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVocabBundle, serializeVocabEnvelope, VOCAB_FILE_NAMES, allDocNames } from "../../server/shared/vocab-load-port.cjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const vault = optionValue(args, "--vault") || process.env.VAULT_PATH || process.env.KB_VAULT;
if (!vault || !fs.existsSync(vault)) {
  console.error("vocab_envelope=FAIL vault 未指定或不存在——用 --vault <vault 根> 或设 VAULT_PATH/KB_VAULT（fail-closed，不猜 cwd）");
  process.exit(1);
}
const out = optionValue(args, "--out") || path.join(ROOT, "data", "staging", "vocab-envelope.json");

const bundle = loadVocabBundle(path.resolve(vault), { files: allDocNames() }); // WP-054 E-A：缺省五件＋扩展件
const envelope = serializeVocabEnvelope(bundle);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(envelope));
const present = VOCAB_FILE_NAMES.filter((name) => bundle.files[name].state === "present");
console.log(`vocab_envelope=${out} files=${present.length}/${VOCAB_FILE_NAMES.length} fingerprints=${Object.keys(envelope.source_fingerprint).length}`);
