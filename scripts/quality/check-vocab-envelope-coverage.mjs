#!/usr/bin/env node
// check-vocab-envelope-coverage.mjs — Python 面词表信封覆盖门禁（WP-138 R1 执法固化）。
// 背景：PR-257——validate_graph.py align_ontology 手抄 10 条关系域值矩阵（其中 4 条在
// 任何单源零命中），跨语言手抄值域分叉的病灶位。R1 已把最后一个未接信封的域值消费方
// 接上（_load_align_ontology 经 schema_loader→vocab_envelope 取数）；本门禁把
// 「Python 零词表文件直读＋零手抄值域抄本」本身变成被测对象（OpenMAIC
// lint-llm-entry-guard 同款——入口唯一性执法）。
// @responsible: quality-gate-engineer 辖区
// @inputs: scripts/vault-py/**/*.py（静态扫）；server/shared/vocab-load-port.cjs（装载件集单源）；
//   dump-vocab-envelope.mjs（真物化 CLI——面②用空 vault 走仓内主源回落物化一次）
// @outputs: vocab_envelope_coverage=ok|FAIL violations=N（FAIL 逐文件:行号 判定与豁免状态）；
//   退出码 0/1
// @context: 面①静态扫是**形状启发**（行级，诚实边界不做数据流分析）：A＝词表 yaml 直读
//   （yaml.load/safe_load 与词表件名同行）；B＝词表目录路径构造（theschema_dir 调用）；
//   C＝手抄域值矩阵（引号键＋值以 ({ 起头即元组首元素为集字面量的行，≥2 行聚簇才判——
//   单条字典配置不误伤；多行折行写法逃逸本启发，由面②接线对账与评审兜底）。
//   测试夹具（__tests__、conftest.py）写词表 yaml 属测试供数面，不在扫面。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { allDocNames, VOCAB_FILE_NAMES } = require(path.join(REPO_ROOT, "server", "shared", "vocab-load-port.cjs"));

const SCAN_DIR = path.join(REPO_ROOT, "scripts", "vault-py");
const DUMP_CLI = path.join(REPO_ROOT, "scripts", "vault-runtime", "dump-vocab-envelope.mjs");

// 词表件名全集（contracts/theschema.registry 五件＋WP-054 扩展件；subjects 等未入信封
// 的单源文件也在直读禁列——凡词表 yaml 一律经信封，不点名直读）
const VOCAB_READ_BANNED_NAMES = [...allDocNames(), "subjects"];
const VOCAB_FILE_RE = new RegExp(`(?:${VOCAB_READ_BANNED_NAMES.join("|")})\\.yaml\\b`);
const YAML_LOAD_RE = /\byaml\.(?:safe_)?load\b/;
const THESCHEMA_DIR_CALL_RE = /\btheschema_dir\s*\(/;
// 手抄域值矩阵行（形状启发，见头注）：键为引号标识符＋值以 ({ 起头＋行内集字面量含引号串
const MATRIX_ROW_RE = /^\s*"[A-Za-z][A-Za-z0-9_]*"\s*:\s*\(\s*\{/;
const MATRIX_SET_QUOTED_RE = /\{[^{}]*"[^"]+"/;
const MATRIX_CLUSTER_GAP = 40; // 行距 ≤40 视为同一字典块（矩阵是多行聚簇，非散点）
const MATRIX_MIN_ROWS = 2;

// 豁免登记位（对齐 ACTION_ROUTING 豁免先例：file 级＋必写理由；空转即摘——命中归零后
// 豁免残留本身判红，防豁免名单只增不减）。当前零豁免：R1 完成后扫面应零命中。
const EXEMPT = [];

// 词表信封登记消费方（WP-138 R1 扫尾实测名单——真读者，全部经 schema_loader/vocab_envelope
// 取数；docs＝消费的词表件名。改动消费面时同步改本表：面②以本表对账信封物化覆盖）。
const CONSUMERS = [
  { file: "scripts/vault-py/content/classify.py", docs: ["enums"] },
  { file: "scripts/vault-py/content/pipeline-smoke.py", docs: ["enums"] },
  { file: "scripts/vault-py/graph/extract_graph.py", docs: ["dependencies", "ontology", "article_associations"] },
  { file: "scripts/vault-py/graph/validate_graph.py", docs: ["enums", "ontology"] },
  { file: "scripts/vault-py/pipeline/infer-from-config.py", docs: ["dependencies", "enums"] },
  { file: "scripts/vault-py/pipeline/pipeline-check.py", docs: ["dependencies", "enums"] },
  { file: "scripts/vault-py/pipeline/schema.py", docs: ["entity-aliases"] },
  { file: "scripts/vault-py/pipeline/sync-board-enums.py", docs: ["enums"] },
  { file: "scripts/vault-py/tools/validate-entity.py", docs: ["dependencies", "enums"] },
  // WP-156：validate_classification.py 退役删除（规则面产品化上契约）——清单条目随批摘除
];
// 消费方接线判据：文本仍出现信封取数入口（三者任一）——消费方静默脱离信封即红，
// 迫使登记表与实况同步（接线对账纪律：声明=执法）。
const CONSUMER_WIRING_RE = /schema_loader|vocab_envelope|load_envelope/;

function listPyFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue; // 测试夹具写词表 yaml＝供数面，不扫
        walk(full);
      } else if (entry.name.endsWith(".py") && entry.name !== "conftest.py") {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

// 面①核心扫描（纯函数，测试直吃）：返回 [{ line, kind, text }]
export function scanPyLines(lines) {
  const hits = [];
  const matrixRows = [];
  lines.forEach((line, i) => {
    if (YAML_LOAD_RE.test(line) && VOCAB_FILE_RE.test(line)) {
      hits.push({ line: i + 1, kind: "vocab-yaml-direct-read", text: line.trim().slice(0, 100) });
      return;
    }
    if (THESCHEMA_DIR_CALL_RE.test(line)) {
      hits.push({ line: i + 1, kind: "theschema-dir-path-construction", text: line.trim().slice(0, 100) });
      return;
    }
    if (MATRIX_ROW_RE.test(line) && MATRIX_SET_QUOTED_RE.test(line)) {
      matrixRows.push(i + 1); // 先收集，聚簇后判矩阵（单行字典条目不误伤）
    }
  });
  let cluster = [];
  const flush = () => {
    if (cluster.length >= MATRIX_MIN_ROWS) {
      hits.push({
        line: cluster[0],
        kind: `hand-copied-domain-matrix (${cluster.length} rows: ${cluster.join(",")})`,
        text: `键→(域集, 值集) 形状矩阵——域值必须单源 ontology.yaml（经信封），不得手抄`,
      });
    }
    cluster = [];
  };
  for (const lineNo of matrixRows) {
    if (cluster.length && lineNo - cluster[cluster.length - 1] > MATRIX_CLUSTER_GAP) flush();
    cluster.push(lineNo);
  }
  flush();
  return hits;
}

// 豁免空转判定（纯函数，测试直吃）：豁免文件零命中→残留豁免本身返回违规
export function checkExemptions(exempt, hitsByFile) {
  const stale = [];
  for (const e of exempt) {
    if (!(hitsByFile.get(e.file)?.length)) {
      stale.push(`[豁免空转] ${e.file} 已零命中——豁免即摘（理由：${e.reason}）`);
    }
  }
  return stale;
}

function materializeDefaultEnvelope(violations) {
  // 面②真物化：空 vault 经 dump CLI 走仓内主源回落（conftest 同款纪律；中和
  // THESCHEMA_DIR 注入防测试/开发环境串台——门禁恒锚仓内主源）。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vocab-coverage-"));
  const out = path.join(tmp, "vocab-envelope.json");
  const env = { ...process.env };
  delete env.THESCHEMA_DIR;
  try {
    execFileSync(process.execPath, [DUMP_CLI, "--vault", tmp, "--out", out], { env, stdio: "pipe" });
    const envelope = JSON.parse(fs.readFileSync(out, "utf8"));
    if (envelope.envelope_version !== 1) {
      violations.push(`[面②] 信封版本非 1：${envelope.envelope_version}`);
      return null;
    }
    return envelope;
  } catch (error) {
    violations.push(`[面②] 信封物化失败（dump-vocab-envelope 非零退出/坏 JSON）: ${String(error.message).slice(0, 200)}`);
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function main(argv = [], opts = {}) {
  const root = opts.root || REPO_ROOT;
  const exempt = opts.exempt !== undefined ? opts.exempt : EXEMPT;
  const consumers = opts.consumers !== undefined ? opts.consumers : CONSUMERS;
  const materialize = opts.materialize !== undefined ? opts.materialize : true;
  const scanDir = opts.scanDir || path.join(root, "scripts", "vault-py");
  const violations = [];

  // ── 面①：静态扫 vault-py ──
  const hitsByFile = new Map();
  let pyCount = 0;
  if (!fs.existsSync(scanDir)) {
    violations.push(`[面①] 扫描目录不存在: ${scanDir}`);
  } else {
    for (const file of listPyFiles(scanDir)) {
      pyCount++;
      const rel = path.relative(root, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const hits = scanPyLines(lines);
      if (hits.length) hitsByFile.set(rel, hits);
    }
    const exemptByFile = new Map(exempt.map((e) => [e.file, e]));
    for (const [rel, hits] of hitsByFile) {
      if (exemptByFile.has(rel)) continue; // 豁免：命中消音（空转由 checkExemptions 另判）
      for (const hit of hits) violations.push(`[面①] ${rel}:${hit.line} ${hit.kind} ${hit.text}`);
    }
    for (const stale of checkExemptions(exempt, hitsByFile)) {
      violations.push(`[面①] ${stale}`);
    }
  }

  // ── 面②：信封物化覆盖登记消费方 ──
  for (const consumer of consumers) {
    const abs = path.join(root, consumer.file);
    const label = consumer.file.replace(/^scripts\/vault-py\//, "");
    if (!fs.existsSync(abs)) {
      violations.push(`[面②] 消费方文件缺失（登记表过期——改 CONSUMERS 或恢复信封接线）: ${consumer.file}`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    if (!CONSUMER_WIRING_RE.test(text)) {
      violations.push(`[面②] 消费方脱离信封取数（schema_loader/vocab_envelope 均未出现）: ${consumer.file}`);
    }
    for (const doc of consumer.docs) {
      if (!allDocNames().includes(doc)) {
        violations.push(`[面②] ${label} 登记了装载件集外的词表件 '${doc}'（合法：${allDocNames().join("/")}）`);
      }
    }
  }
  let envelope = null;
  if (opts.envelope !== undefined) envelope = opts.envelope; // 测试注入口（真物化见下）
  else if (materialize) envelope = materializeDefaultEnvelope(violations);
  if (envelope) {
    const present = new Set(Object.keys(envelope.source_fingerprint || {}));
    for (const consumer of consumers) {
      const label = consumer.file.replace(/^scripts\/vault-py\//, "");
      for (const doc of consumer.docs) {
        // 五件核心＝仓内主源必须物化在场（缺席＝信封对登记消费方断供）；扩展件软缺件
        // 合法（fail-open 空集＋收据），不在此判。
        if (VOCAB_FILE_NAMES.includes(doc) && !present.has(doc)) {
          violations.push(`[面②] 信封物化缺件：${label} 依赖 '${doc}' 而仓内主源未物化在场`);
        }
      }
    }
  }

  if (violations.length) {
    console.error(`vocab_envelope_coverage=FAIL violations=${violations.length}`);
    for (const v of violations.slice(0, 40)) console.error(`  ${v}`);
    console.error("处置：词表一律经 schema_loader/vocab_envelope 信封取数（WP-049 L3／WP-138 R1）；值域矩阵单源 data/theschema/ontology.yaml，禁手抄。如系检查器误报，按 spec 在 EXEMPT 登记豁免（附理由，空转即摘）。");
    return 1;
  }
  console.log(`vocab_envelope_coverage=ok pyFiles=${pyCount} consumers=${consumers.length} materialized=${materialize ? "yes" : "skipped"}`);
  return 0;
}

const isDirect = process.argv[1] && path.basename(process.argv[1]) === "check-vocab-envelope-coverage.mjs";
if (isDirect) process.exit(main(process.argv.slice(2)));
