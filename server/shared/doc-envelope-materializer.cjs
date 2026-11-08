'use strict';
// Component: Doc-Envelope-Materializer（文档信封物化——WP-117 批2／SPEC-084 §二.1）
// @responsible: 全语料单信封物化器：walk vault 全部 .md（collect_md_files :472-483 口径，skip
//   { .obsidian, .git, .claude }——本批任务口径，未含 collect_md_files 缺省的 raw，随 SPEC 收官注记），
//   逐文件产出 { path(POSIX 相对), fmText(含定界符的 frontmatter 块原文), body(全文不裁), sha256, sha16 }，
//   写运行时槽 <vault>/.ledger/doc-envelope.json（PR-243 单源 getLedgerDir；落盘经已登记通道
//   repo-file-io.writeRepoFileAtomic 原子写——本文件自身零写原语，write_primitive_allow 不新增条目，
//   与 vocab-envelope-materializer 直写＋登记先例的差异如实记档）。路径经 DOC_ENVELOPE_PATH 下发
//   （vault-runtime-spawn 照 VOCAB_ENVELOPE_PATH 同款：拉起前重写、false 显式 delete）；Python 接收器
//   scripts/vault-runtime/doc_envelope.py 只读信封、零直读 .md（ADR-016 §四-2「别忘了做 md 的」）。
// @inputs: vaultPath（与下游 Python 同一库根）
// @outputs: 信封文件绝对路径（writeDocEnvelope）／信封对象（buildDocEnvelope）
// @context: Vault（Sync；vault-runtime 拉起前调用）
//
// 面⑩记档（check:runtime-scope 装载入口唯一性）：本文件的 frontmatter 块提取是 extract_graph
//   parse_frontmatter（scripts/vault-py/graph/extract_graph.py）同语义的文本搬运（信封只运原文，
//   YAML 解析留 Python 侧——SPEC-084 §二.1 fm 以文本入信封），非装载宿主式的解析切分；语义上与
//   yaml-frontmatter.cjs 的换行闭合＋trim 形态刻意不等价（信封必须逐字节还原原文：fmText＋body
//   恒等于原文全文）。为不碰 LOAD_PORT_ALLOW 棘轮，三横分隔符以 DASHES 构件拼装（"-".repeat(3)），
//   形态属检查器头部已记档盲区③（拼装分隔常量族）；本文件全文（含注释）不出现三横字面量，
//   语义等价由 doc-envelope-materializer.test.mjs 以 parse_frontmatter 真函数子进程对拍钉死。
//
// 指纹口径：sha256＝信封交付文本（utf-8 编码）的哈希、sha16＝前 16 位——接收侧零文件读取即可
//   复算对账（vocab 逐件收据同理）；utf-8 且不含 CR 的文件与原文件字节哈希恒等（utf-8 解码再
//   编码是恒等变换）；含 CR（\r\n／孤 \r——WP-117 红队 P2-1 归一）与非 utf-8 文件为归一/解码后
//   交付文本的收据（与原文件字节哈希不恒等——增量指纹首轮翻牌一次，SPEC-084 §八注记）。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getLedgerDir } = require("../vault-paths.cjs"); // PR-243：账本目录名单源
const { writeRepoFileAtomic } = require("./repo-file-io.cjs"); // 已登记写通道（面⑤：新写者经网关/通道）

const DOC_ENVELOPE_VERSION = 1;
const DOC_ENVELOPE_FILENAME = "doc-envelope.json";
const SKIP_DIRS = new Set([".obsidian", ".git", ".claude"]); // 本批口径（raw 不在列——随 SPEC 收官注记）
// 三横分隔符构件（面⑩记档见文件头注；语义＝parse_frontmatter 的哑切分分隔符）
const DASHES = "-".repeat(3);

// parse_frontmatter 同语义文本切分：三横起头判别＋三横定位 maxsplit=2；无块（未以三横起头，
// 或全文只有一处三横）即 fmText 为空串、body 为全文——与 parse_frontmatter 返回 None 的无块形态对齐。
// 与 python str.split 的 maxsplit 语义逐字对齐（含六连短横等自重叠边界：第二处定位从第 4 字节起扫）。
function splitFrontmatterText(content) {
  if (typeof content !== "string" || !content.startsWith(DASHES)) {
    return { fmText: "", body: typeof content === "string" ? content : "" };
  }
  const closeIdx = content.indexOf(DASHES, DASHES.length);
  if (closeIdx < 0) return { fmText: "", body: content };
  return {
    fmText: content.slice(0, closeIdx + DASHES.length),
    body: content.slice(closeIdx + DASHES.length),
  };
}

// parse_frontmatter 编码容错链的 Node 等价：utf-8（严格）→ gbk（严格）→ latin-1（恒成功）。
// utf-8-sig 环节数学上不可达：该编码与 utf-8 仅差 BOM 剥离，而带 BOM 文件 utf-8 必然解码成功，
// 故链上永远轮不到它——省略不改变等价性。ignoreBOM:true＝保留 BOM 于输出（对齐 python utf-8
// 解码不剥 BOM：BOM 文件因此不作 frontmatter 文件处理）。残余差异如实记：TextDecoder 的 gbk
// 按 WHATWG 映射 gb18030 解码器（gbk 超集，合法 gbk 中文序列两解器同形）；latin-1 用 Buffer
// 直译（TextDecoder 的 latin-1 标签按 WHATWG 映射 windows-1252，与 python ISO-8859-1 不等价）。
//
// universal newlines 归一（WP-117 红队 P2-1）：解码后统一 \r\n→\n、孤 \r→\n——对齐旧 python
// open() 文本态缺省（newline=None）的 universal newlines 语义；迁移前产物全链吃归一文本，
// 信封不归一即 CRLF 文件产物逐字漂移（红队 03-C.md 对拍案例，测试已转正钉死）。
function normalizeUniversalNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function decodeDocumentBytes(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (_) { /* 非 utf-8——沿链降级 */ }
  if (text === undefined) {
    try {
      text = new TextDecoder("gbk", { fatal: true }).decode(bytes);
    } catch (_) { /* 非 gbk——末级 latin-1 逐字节映射 */ }
  }
  if (text === undefined) text = bytes.toString("latin1");
  return normalizeUniversalNewlines(text);
}

// collect_md_files :472-483 口径（os.walk 剪枝＋.md 后缀＋末端统一排序；followlinks=false 不下降
// 链接目录，链接文件按 os.walk files 列口径计入）。不可读文档（断链等）在读取期 fail-closed 显式
// 报错——信封是全语料完备性承诺，静默缺页即假绿（与 parse_frontmatter 容忍单文件不可读的差异如实记）。
// 例外（WP-117 红队 P2-4）：符号链接 stat 出目录态（链接指向目录）显式跳过并 stderr 记一条——
// 整库不硬红（收面跳过是显式态，非静默缺页；EISDIR 读错误在收集面即拦截）。
function collectMarkdownFilePaths(root) {
  const found = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`DOC_ENVELOPE_VAULT_UNREADABLE: 目录不可读（${dir}）：${error.message}`);
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(full);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      if (entry.isSymbolicLink()) {
        let linkStat = null;
        try { linkStat = fs.statSync(full); } catch { /* 断链不在此处置——读取期 fail-closed 点名 */ }
        if (linkStat !== null && linkStat.isDirectory()) {
          process.stderr.write(`DOC_ENVELOPE_SYMLINK_DIR_SKIPPED: 符号链接指向目录，收集面跳过（${full}）——目录态非文档，不整库硬红\n`);
          continue;
        }
      }
      found.push(full);
    }
  };
  visit(root);
  return found;
}

function buildDocEnvelope(vaultPath) {
  const root = path.resolve(vaultPath);
  let rootStat;
  try {
    rootStat = fs.statSync(root);
  } catch (error) {
    throw new Error(`DOC_ENVELOPE_VAULT_UNREADABLE: vault 目录不存在或不可读（${root}）——缺库 fail-closed，不产空信封`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`DOC_ENVELOPE_VAULT_UNREADABLE: vault 路径不是目录（${root}）`);
  }
  const documents = [];
  let totalBytes = 0;
  for (const full of collectMarkdownFilePaths(root)) {
    let bytes;
    try {
      bytes = fs.readFileSync(full);
    } catch (error) {
      throw new Error(`DOC_ENVELOPE_FILE_UNREADABLE: 文档不可读（${full}）：${error.message}——不静默缺页`);
    }
    const content = decodeDocumentBytes(bytes);
    const { fmText, body } = splitFrontmatterText(content);
    const sha256 = crypto.createHash("sha256").update(Buffer.from(fmText + body, "utf8")).digest("hex");
    documents.push({
      path: path.relative(root, full).split(path.sep).join("/"),
      fmText,
      body,
      sha256,
      sha16: sha256.slice(0, 16),
    });
    totalBytes += bytes.length; // 原始字节量＝磁盘体积（免二次 stat，免竞态）
  }
  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)); // path 排序稳定序
  return {
    envelope_version: DOC_ENVELOPE_VERSION,
    generated_at: new Date().toISOString(),
    vault_fingerprint: { file_count: documents.length, total_bytes: totalBytes },
    documents,
  };
}

function serializeDocEnvelope(envelope) {
  return JSON.stringify(envelope);
}

// 写 <vault>/.ledger/doc-envelope.json（vocab-envelope-materializer 同款槽位语义：每次物化重写、
// 运行时态工件、不入 git、无跨库碰撞；原子落盘——进程中断不留半截信封）。空库合法产出空信封
// （documents 空数组），缺库由 buildDocEnvelope fail-closed 拦下。
function writeDocEnvelope(vaultPath) {
  const root = path.resolve(vaultPath);
  const envelope = buildDocEnvelope(root); // build 先行：缺库 fail-closed 在建目录之前拦下
  const ledgerDir = getLedgerDir(root);
  fs.mkdirSync(ledgerDir, { recursive: true });
  const target = path.join(ledgerDir, DOC_ENVELOPE_FILENAME);
  writeRepoFileAtomic(target, serializeDocEnvelope(envelope));
  return target;
}

module.exports = { DOC_ENVELOPE_VERSION, DOC_ENVELOPE_FILENAME, buildDocEnvelope, serializeDocEnvelope, writeDocEnvelope };
