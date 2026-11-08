// check-vocab-envelope-coverage 测试（WP-138 R1）。分层：
//   L1 纯单元——scanPyLines（三判据检出/不误伤）＋checkExemptions（空转即摘）
//   L2 门禁契约——main 对真实文件集与临时注入口的判定：
//      破坏实验（P0 第 7 步）＝注入手抄矩阵/词表直读必须红、复原必须绿；
//      面②消费方登记对账（缺文件/脱接线/坏件名）＋信封物化覆盖（缺件红/真物化绿）。
// 验证对象：scripts/quality/check-vocab-envelope-coverage.mjs（真实临时文件＋真仓，零 mock）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkExemptions, main, scanPyLines } from "../check-vocab-envelope-coverage.mjs";

// 手抄矩阵行拼接构造——被测对象是扫源码文本的检查器，检查器自身注释里不出现完整形状
// （本测试文件不在扫面 scripts/vault-py 内，拼接仅为与检查器同款防自咬习惯）
const MATRIX_ROWS = [
  '    "ROUTES' + '_TO": ({"终端", "服务"}, {"服务"}),',
  '    "DEPENDS' + '_ON": ({"服务", "基础设施"}, {"服务", "基础设施", "存储"}),',
].join("\n");

function tmpTree(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vec-"));
  for (const [name, content] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function runMain(opts) {
  let code = 0;
  const orig = [console.log, console.error];
  let out = "";
  console.log = (l) => { out += l + "\n"; };
  console.error = (l) => { out += l + "\n"; };
  try { code = main([], opts); } finally { [console.log, console.error] = orig; }
  return { code, out };
}

// ── L1 纯单元 ──

test("L1 面①A：yaml load×词表件名同行共现即红；frontmatter 直读不误伤", () => {
  const hits = scanPyLines([
    "data = yaml.safe_load(open('TheSchema/enums.yaml'))", // 词表直读（本测试不在扫面，字面量不自咬）
    "fm = yaml.safe_load(parts[1]) or {}", // 文章 frontmatter——非词表，不判
    "entries[f\".ledger/vocab/{name}.yaml\"] = {}", // 指纹清单键名——非读取，不判
  ]);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].kind, "vocab-yaml-direct-read");
});

test("L1 面①B：theschema_dir 调用即红；纯 import 不误伤", () => {
  const hits = scanPyLines([
    "_DIR = theschema_dir(vault_root)",
    "from kb_paths import vault_roots, theschema_dir, ledger_dir",
  ]);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "theschema-dir-path-construction");
});

test("L1 面①C：手抄域值矩阵≥2 行聚簇判红；单行/远距散行不误伤", () => {
  const matrix = MATRIX_ROWS.split("\n");
  assert.equal(scanPyLines(matrix).length, 1, "相邻两行＝一个矩阵");
  assert.equal(scanPyLines([matrix[0]]).length, 0, "单行字典条目不判");
  const far = [matrix[0], ...Array.from({ length: 45 }, () => "x = 1"), matrix[1]];
  assert.equal(scanPyLines(far).length, 0, "行距超窗＝散点不判");
});

test("L1 豁免空转即摘：命中归零后残留豁免自身判红", () => {
  const hitsByFile = new Map([["a.py", [{ line: 1, kind: "x", text: "" }]]]);
  assert.deepEqual(checkExemptions([{ file: "a.py", reason: "有命中——消音" }], hitsByFile), []);
  const stale = checkExemptions([{ file: "clean.py", reason: "已无命中" }], hitsByFile);
  assert.equal(stale.length, 1, JSON.stringify(stale));
  assert.match(stale[0], /clean\.py/);
  assert.match(stale[0], /空转/);
});

// ── L2 门禁契约 ──

test("L2 破坏实验：注入手抄矩阵＋词表直读＝红（逐文件:行号）；复原＝绿", () => {
  // 注入串在测试源拼接、运行期落盘为连续词表件名（扫面吃的是落盘原文）
  const vocabReadLine = "    data = yaml.safe_load(open('TheSchema/en" + "ums.yaml'))";
  const dir = tmpTree({
    "scripts/vault-py/graph/validate_graph.py": `def f():\n${MATRIX_ROWS}\n${vocabReadLine}\n`,
  });
  const red = runMain({ root: dir, scanDir: path.join(dir, "scripts", "vault-py"), consumers: [], materialize: false });
  assert.equal(red.code, 1, red.out);
  assert.match(red.out, /vocab_envelope_coverage=FAIL violations=2/);
  assert.match(red.out, /validate_graph\.py:2 hand-copied-domain-matrix/);
  assert.match(red.out, /validate_graph\.py:4 vocab-yaml-direct-read/);
  // 复原（R1 后实况形状）：信封取数＋无抄本＝绿
  fs.writeFileSync(path.join(dir, "scripts/vault-py/graph/validate_graph.py"),
    "import schema_loader\nmatrix = schema_loader.ontology_relation_types()\n");
  const green = runMain({ root: dir, scanDir: path.join(dir, "scripts", "vault-py"), consumers: [], materialize: false });
  assert.equal(green.code, 0, green.out);
  assert.match(green.out, /vocab_envelope_coverage=ok/);
});

test("L2 面②对账：消费方缺文件/脱接线/登记坏件名各自即红", () => {
  const dir = tmpTree({
    "scripts/vault-py/graph/wired.py": "import schema_loader\n",
    "scripts/vault-py/graph/unwired.py": "print('hi')\n",
  });
  const consumers = [
    { file: "scripts/vault-py/graph/wired.py", docs: ["enums"] },
    { file: "scripts/vault-py/graph/unwired.py", docs: ["enums"] },
    { file: "scripts/vault-py/graph/missing.py", docs: ["enums"] },
    { file: "scripts/vault-py/graph/wired.py", docs: ["not-a-doc"] },
  ];
  const { code, out } = runMain({ root: dir, scanDir: path.join(dir, "scripts", "vault-py"), consumers, materialize: false });
  assert.equal(code, 1, out);
  assert.match(out, /消费方文件缺失.*missing\.py/);
  assert.match(out, /脱离信封取数.*unwired\.py/);
  assert.match(out, /装载件集外的词表件 'not-a-doc'/);
});

test("L2 面②物化覆盖：核心五件缺件即红；真物化（真仓空 vault 回落）＝绿", () => {
  const dir = tmpTree({
    "scripts/vault-py/graph/consumer.py": "import schema_loader\n",
  });
  const consumers = [{ file: "scripts/vault-py/graph/consumer.py", docs: ["enums", "ontology"] }];
  const missing = runMain({
    root: dir, scanDir: path.join(dir, "scripts", "vault-py"), consumers, materialize: false,
    envelope: { envelope_version: 1, source_fingerprint: { fields: "x", versions: "x", dependencies: "x" } },
  });
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.out, /信封物化缺件：graph\/consumer\.py 依赖 'enums'/);
  assert.match(missing.out, /信封物化缺件：graph\/consumer\.py 依赖 'ontology'/);
  // 真仓全量（真 CLI 物化＋真实消费方清单）——R1 完工态的绿
  const real = runMain({});
  assert.equal(real.code, 0, real.out);
  assert.match(real.out, /vocab_envelope_coverage=ok pyFiles=\d+ consumers=\d+ materialized=yes/);
});

test("L2 豁免登记：命中文件豁免消音，空转豁免仍红（豁免不吸收空转）", () => {
  const dir = tmpTree({
    "scripts/vault-py/graph/matrix.py": `${MATRIX_ROWS}\n`,
    "scripts/vault-py/graph/clean.py": "x = 1\n",
  });
  const exempt = [
    { file: "scripts/vault-py/graph/matrix.py", reason: "误报登记位（测试注入）" },
    { file: "scripts/vault-py/graph/clean.py", reason: "已收敛未摘（测试注入）" },
  ];
  const { code, out } = runMain({
    root: dir, scanDir: path.join(dir, "scripts", "vault-py"), consumers: [], materialize: false, exempt,
  });
  assert.equal(code, 1, out);
  assert.doesNotMatch(out, /matrix\.py/, "有命中且已豁免——消音不出违规");
  assert.match(out, /豁免空转.*clean\.py/);
});
