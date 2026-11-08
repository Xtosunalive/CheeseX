// @component: 图谱抽取质量 eval 编排器（WP-097 / PR-234）——密封夹具→真管线→评分→落账
// @context: 测量仪非门禁（第一版只测不拦，不进 gates:ci、不挂管线钩子）。链路：
//   ①mkdtemp 工作目录，复制密封夹具 test/fixtures/graph-eval-baseline/input（字节快照——
//     节点 id 含建库时间戳成分，必须用封存快照，禁现场重建）②词表信封经既有装载入口物化
//     （WP-049 L3 供面）②b 文档信封同源物化（WP-117：extract_graph 文档摄入吃
//     DOC_ENVELOPE_PATH，fail-closed）③真管线 extract_graph --apply 全量跑④graph_eval.py 评分（恒 --json，
//     人读摘要由本编排器渲染——单次评估双形态）⑤摘要经 telemetry-store recordTrace 落④类
//     痕迹（唯一网关，fail-open）。
//   环境纪律：解释器＝PYTHON_PATH（.env 或环境变量，ADR-002 禁裸解释器——缺即拒跑不回落）；
//   全部写面钉 mkdtemp 临时目录（KB_DATA_DIR 等），宿主仓 data/ 与真库零触碰；
//   任一步失败先清临时目录再退出（不留 /tmp 垃圾）。
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "graph-eval-baseline");
const ABLATION = process.argv.includes("--ablation") ? process.argv[process.argv.indexOf("--ablation") + 1] : null;
const AS_JSON = process.argv.includes("--json");

function readEnvPythonPath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  const envFile = path.join(ROOT, ".env");
  if (fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, "utf8").split("\n").find((l) => l.trim().startsWith("PYTHON_PATH="));
    if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function cleanup(work) {
  if (!work) return;
  try {
    // 管线/封存制品可能带只读文件（release 服务封存语义）——先解除写保护再删，否则 ENOTEMPTY
    fs.chmodSync(work, 0o700);
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        fs.chmodSync(full, entry.isDirectory() ? 0o700 : 0o600);
        if (entry.isDirectory()) walk(full);
      }
    };
    walk(work);
  } catch { /* 尽力而为 */ }
  fs.rmSync(work, { recursive: true, force: true });
}

function fail(work, message) {
  cleanup(work);
  process.stderr.write(`[graph-eval] ${message}\n`);
  process.exit(1);
}

function renderHuman(result) {
  const lines = [];
  for (const [label, m] of [["节点", result.nodes], ["关系", result.edges]]) {
    lines.push(`${label}  P=${m.precision} R=${m.recall} F1=${m.f1}（tp=${m.tp} fp=${m.fp} fn=${m.fn}）`);
  }
  if (result.edge_verdicts) {
    const vc = result.edge_verdicts;
    lines.push(`档位  hit=${vc.hit} type_mismatch=${vc.type_mismatch} endpoint_mismatch=${vc.endpoint_mismatch} missing=${vc.missing}（合计=${vc.hit + vc.type_mismatch + vc.endpoint_mismatch + vc.missing}＝真值边数；hit＝真阳数，与 P/R 口径一致）`);
  }
  for (const [label, items] of [
    ["缺节点", result.missing_nodes], ["多节点", result.extra_nodes],
    ["缺关系", result.missing_edges], ["多关系", result.extra_edges],
  ]) {
    if (items?.length) lines.push(`${label} ${items.length}：${items.slice(0, 8).join("；")}${items.length > 8 ? "…" : ""}`);
  }
  if (result.truth_status) lines.push(`真值状态：${result.truth_status}`);
  if (result.omitted_edge) lines.push(`消融剔除（真值侧）：${result.omitted_edge}`);
  return lines.join("\n");
}

const pythonPath = readEnvPythonPath();
if (!pythonPath) fail(null, "PYTHON_PATH 未设置（.env 亦无）——ADR-002 禁裸解释器，拒跑不回落。请设 PYTHON_PATH=<venv python>");
if (!fs.existsSync(path.join(FIXTURE, "input", "知识库", "TheSchema", "enums.yaml"))) {
  fail(null, `密封夹具缺 TheSchema（${FIXTURE}/input）——夹具损坏，拒跑`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "graph-eval-"));
const vault = path.join(work, "vault");
const dataDir = path.join(work, "data");
fs.cpSync(path.join(FIXTURE, "input"), vault, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

function run(cmd, args, env, label) {
  const res = spawnSync(cmd, args, { env, encoding: "utf8" });
  if (res.status !== 0) {
    fail(work, `${label} 失败（exit=${res.status}）\n${res.stdout?.slice(-2000) || ""}${res.stderr?.slice(-2000) || ""}`);
  }
  return res;
}

const baseEnv = {
  ...process.env,
  VAULT_PATH: vault,
  KB_VAULT: vault,
  KB_DATA_DIR: dataDir,
  THESCHEMA_DIR: path.join(vault, "知识库", "TheSchema"),
  PYTHONPATH: path.join(ROOT, "scripts", "vault-py", "graph"),
};

// ②词表信封（装载入口唯一供面；Python 不读 TheSchema 文件——ADR-016 §四-2 裁决）
const envelopePath = path.join(work, "vocab-envelope.json");
run(process.execPath, [path.join(ROOT, "scripts", "vault-runtime", "dump-vocab-envelope.mjs"), "--out", envelopePath],
  { ...baseEnv, VAULT_PATH: vault, KB_VAULT: vault }, "词表信封物化");

// ②b 文档信封（WP-117 红队 P1-4 接线：extract_graph 批2 起文档摄入 fail-closed 吃
//   DOC_ENVELOPE_PATH——缺物化即 DOC_ENVELOPE_FAIL_CLOSED 退出；词表信封 ② 步同款，
//   dump-doc-envelope --vault 同源物化，缺省槽 <vault>/.ledger/doc-envelope.json）
run(process.execPath, [path.join(ROOT, "scripts", "vault-runtime", "dump-doc-envelope.mjs"), "--vault", vault],
  { ...baseEnv, VAULT_PATH: vault, KB_VAULT: vault }, "文档信封物化");
const docEnvelopePath = path.join(vault, ".ledger", "doc-envelope.json");

// ③真管线全量跑（--apply 落盘；管线代码零改动——评而不改）
run(pythonPath, [path.join(ROOT, "scripts", "vault-py", "graph", "extract_graph.py"), "--apply"],
  { ...baseEnv, VOCAB_ENVELOPE_PATH: envelopePath, DOC_ENVELOPE_PATH: docEnvelopePath }, "extract_graph");

// ④评分（纯比较器；--ablation 从真值侧剔边——验收判据能红）
const graphJson = path.join(dataDir, "staging", "master_graph.json");
const evalArgs = [path.join(ROOT, "scripts", "vault-py", "graph", "graph_eval.py"),
  "--graph", graphJson, "--truth", path.join(FIXTURE, "truth.json"), "--json"];
if (ABLATION) evalArgs.push("--omit-edge", ABLATION);
const scored = run(pythonPath, evalArgs, baseEnv, "graph_eval");
let result;
try {
  result = JSON.parse(scored.stdout);
} catch (error) {
  fail(work, `评分输出非 JSON：${error?.message || error}`);
}

if (AS_JSON) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(renderHuman(result));
}

// ⑤摘要落④类痕迹（唯一网关 telemetry-store；recordTrace 自身失败返回 false 不阻断——报告已在 stdout）。
//   落点＝宿主 data/telemetry.db（④类住址＝KB_DATA_DIR 解析；eval 无服务进程，按 repo 默认，
//   gitignored、可丢；管线写面仍全钉临时目录，不受此影响）。
try {
  const { openPersistenceDb } = require(path.join(ROOT, "server", "shared", "persistence", "sqlite-adapter.cjs"));
  const { initTelemetryStore, TRACE_KINDS } = require(path.join(ROOT, "server", "shared", "persistence", "telemetry-store.cjs"));
  const telemetryDir = path.join(ROOT, "data");
  fs.mkdirSync(telemetryDir, { recursive: true });
  const db = openPersistenceDb({ path: path.join(telemetryDir, "telemetry.db") });
  const store = initTelemetryStore(db);
  const ok = store.recordTrace(TRACE_KINDS.GRAPH_EVAL ?? "graph-eval", {
    nodes: result.nodes ?? null,
    edges: result.edges ?? null,
    ablation: ABLATION || null,
    truthStatus: result.truth_status ?? "unknown",
  });
  if (!ok) process.stderr.write("[graph-eval] telemetry 落账未成（④类可丢，不阻断）\n");
  db.close?.();
} catch (error) {
  process.stderr.write(`[graph-eval] telemetry 落账未成（④类可丢，不阻断）：${error?.message || error}\n`);
} finally {
  cleanup(work);
}
