// Component: Schema-Graph-Freshness（WP-027/PR-142）
// @responsible: 「图是否落后于当前规则输入」只读现算——五件图输入词表
//   （enums/fields/versions/ontology）与上次抽取落盘的 extract_manifest.json 逐文件比对。
//   比对规则与 extract_graph --incremental 的跳过判定同源（WP-049 L3 起为纯内容 sha16 头 16 对拍），
//   不另立第二语义：upToDate=false ⇔ 「若现在跑增量，指纹会判有变化」。
//   manifest 缺席/不可读（从未增量跑过）→ upToDate=null（unknown——不假绿）。
// @inputs: vaultPath（TheSchema 目录解析与 schema_loader 同规则）、dataDir（staging 落点）、fs
// @outputs: computeGraphFreshness({ vaultPath, dataDir }) → { upToDate, changed, checkedAt, manifestGeneratedAt }
// @context: Pipeline/Schema-Manager；纯函数形态（无内部状态），路由与调度器共用
//
// 精度注记：mtime_ns 约 1.7e18 超出 JS 安全整数（2^53）。Python 侧按整数精确比较；Node 侧
// JSON.parse 与 fs.stat 的 bigint→Number 转换对同一整数的舍入结果一致（同值同 double），
// 故 Number 相等比较在本用途下不产生假差；变更场景本就产生真实差异，不影响判定方向。
// 反向边角（红队实验补记）：相差 ≤128ns 的两个不同整数会映成同一 double——纯 touch 且内容
// 不变时 Node 可能判「未变」而 Python 判「变」：方向为漏报一次内容无变化的抽取，无图影响。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");
const { stagingPath } = require("../../shared/persistence/data-dir.cjs");
const { loadVocabBundle, VOCAB_FILE_NAMES } = require("../../shared/vocab-load-port.cjs"); // WP-049 L3：读侧经装载入口

/** 图输入词表＝五件内容指纹对账（WP-049 L3/L4）：manifest 由 extract_graph 从信封指纹逐件注入
 * （.ledger/vocab/<name>.yaml，sha16＝内容哈希前 16）；freshness 经装载端口现算逐件指纹对拍——
 * 词表变化即时可见且逐件点名，不依赖下一次物化时机；mtime/size 不参与判定（内容是唯一事实：
 * touch 不改内容即真新鲜）。P6「输入集三份」债：Python 侧与 freshness 侧已收敛，watcher 侧
 * 事件监听面留待后续波次。 */
const GRAPH_INPUT_BASENAMES = Object.freeze(VOCAB_FILE_NAMES.map((name) => `${name}.yaml`)); // 兼容导出（消费面：freshness 单测）
const FINGERPRINT_BASENAME = "vocab-envelope.fingerprint";

function fileFingerprint(absPath) {
  let stat;
  try {
    // bigint 模式取 mtimeNs（普通 Stats 只有 *Ms——与 Python st.st_mtime_ns 对齐）
    stat = fs.statSync(absPath, { bigint: true });
  } catch (_error) {
    return null; // 文件缺席（删除/尚未建）——按「有变化」方向报告
  }
  let sha16 = null;
  try {
    sha16 = crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex").slice(0, 16);
  } catch (_error) {
    return null; // 读失败视同不可比——按「有变化」方向报告（fail toward refresh）
  }
  return { mtime_ns: Number(stat.mtimeNs), size: Number(stat.size), sha16 };
}

function readManifest(dataDir) {
  const manifestPath = stagingPath("extract_manifest.json", { dir: dataDir });
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (_error) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.files || typeof parsed.files !== "object") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

/**
 * @returns {{ upToDate: boolean|null, changed: string[], checkedAt: string, manifestGeneratedAt: string|null }}
 *   upToDate=null 表示未知（manifest 缺席——从未增量抽取过），调用方不得当作 false 或 true 消费。
 */
function computeGraphFreshness({ vaultPath, dataDir }) {
  const checkedAt = new Date().toISOString();
  const manifest = readManifest(dataDir);
  if (!manifest) {
    return { upToDate: null, changed: [], checkedAt, manifestGeneratedAt: null };
  }
  // manifest 键为 vault 根相对路径——词表五件条目由 extract_graph 从信封指纹注入
  // （.ledger/vocab/<name>.yaml，sha16＝内容哈希前 16，与旧逐件哈希字节同值——WP-049 L3）
  const entriesByBasename = new Map();
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    const base = path.basename(relPath);
    if (GRAPH_INPUT_BASENAMES.includes(base) && entry && typeof entry === "object") {
      entriesByBasename.set(base, entry);
    }
  }
  // 端口现算五件指纹逐件对拍——词表变化即时可见（不依赖下一次物化时机）、逐件点名契约保持
  const bundle = loadVocabBundle(vaultPath);
  const changed = [];
  for (const name of VOCAB_FILE_NAMES) {
    const base = `${name}.yaml`;
    const file = bundle.files[name];
    const present = Boolean(file && file.state === "present");
    const recorded = entriesByBasename.get(base);
    if (!present && !recorded) continue; // 两侧皆无＝无关件
    if (!present || !recorded) {
      changed.push(base); // 新置备/被删——按「有变化」方向报告
      continue;
    }
    if (String(recorded.sha16) !== String(file.fingerprint).slice(0, 16)) changed.push(base);
  }
  return {
    upToDate: changed.length === 0,
    changed,
    checkedAt,
    manifestGeneratedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : null,
  };
}

module.exports = { computeGraphFreshness, GRAPH_INPUT_BASENAMES };
