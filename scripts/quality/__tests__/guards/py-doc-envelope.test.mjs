// WP-155：Python 文档消费面哨兵（普通测试载体——WP-143 波5 口径「产品验证→普通测试」，不新增 check-*.mjs 门禁）。
// 判据：vault-py／vault-runtime 生产 Python 代码的「文档读取原语」命中必须 ⊆ 豁免清单（锚失配即红——
// 棘轮只减不增）。签名族自退役检查器（WP-117 交付、WP-143 波4b 物理删除）的 PY_DOC_READ_SIGS 收窄继承，
// 全量留档 discipline-kit 仓 /reference；豁免清单＝本文件内嵌单一事实源（条目理由须可问责）。
// 层级：产品形状静态验证（扫描源码形状）＋真实行为由 pytest 对拍与 e2e 承担——本件不冒充行为验证。
// 已知窗口盲区（红队记档②，WP-155 复核）：读取原语距 .md 字面量 >3 行窗的形态（如 pipeline-runner
// :312 归档库 frontmatter id 探测、:244 MEMORY.md 索引）逃过本判据——归档子树非语料（WP-117 底稿在册）
// 且已登记豁免候选，收口随派生工件批；写面自读（读改写前现盘裁决）按定性注释＋AI 评审兜底。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCAN_DIRS = ["scripts/vault-py", "scripts/vault-runtime"];

// 读取原语行（open( / read_text( / read_bytes( ）
const READ_PRIMITIVE = /\b(?:open|read_text|read_bytes)\(/;
// glob/rglob .md 模式清单
const GLOB_MD = /(?:rglob|glob)\(\s*["'`][^"'`]*\.md/;
// md 命名变量进读取原语（open(*md*, / read_text(*md*）
const MD_VAR = /\b(?:open|read_text|read_bytes)\(\s*[\w.]*\b(?:md\w*|\w*_md\w*)\b\s*[,)]/;
const MD_LITERAL = /\.md/;
const WINDOW = 3;

// 豁免清单（锚＝该文件仍须存在的读取形态字面量；文件收口改形后锚失配即红 → 摘条目；
// 零命中空转条目同样须摘——棘轮只减不增，首批 8 条已摘 4 条零命中空转，余 4 条在册）。
// 键＝相对 ROOT 的 posix 路径；reason 必填（空白不算理由——可问责）。
const ALLOW = new Map(Object.entries({
  "scripts/vault-runtime/doc_envelope.py": {
    anchor: 'with open(resolved, encoding="utf-8") as handle:',
    reason: "文档信封接收器本体——读信封 JSON，不读 vault .md（窗口内 .md 字样属契约注释提及）",
  },
  "scripts/vault-py/pipeline/backwrite-frontmatter.py": {
    anchor: 'with open(md_path, encoding="utf-8") as f:',
    reason: "在册残余②（WP-117 红队清单）：回写管道写前自读目标页——写面自读非装载消费；收口随写面批（收口后锚空转即摘）",
  },
  "scripts/vault-py/content/pipeline-smoke.py": {
    anchor: 'rglob("*.md")',
    reason: "手工冒烟诊断（WP-117 红队清单二选一登记）：precleaned 名单面计数不读内容——自包含工具无信封拉起链，直读残留如实登记",
  },
  "scripts/vault-runtime/pipeline-runner.py": {
    anchor: "with open(BOARD_CACHE) as f:",
    reason: "读 _enums-cache.md＝sync-board-enums 机器派生缓存件（非文档语料）——WP-117 清单外新发现在册，随派生工件批收口",
  },
}));

function* pyFiles() {
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
      const full = path.join(entry.parentPath ?? abs, entry.name);
      const relDir = path.relative(ROOT, path.dirname(full));
      const parts = relDir.split(path.sep);
      if (parts.includes("__tests__") || parts.includes("__pycache__")) continue;
      yield path.relative(ROOT, full).split(path.sep).join("/");
    }
  }
}

function scan(rel) {
  const hits = [];
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
  lines.forEach((line, i) => {
    const hasRead = READ_PRIMITIVE.test(line);
    if (hasRead && MD_LITERAL.test(line)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
      return;
    }
    if (GLOB_MD.test(line)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
      return;
    }
    if (MD_VAR.test(line)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
      return;
    }
    if (hasRead) {
      const near = lines
        .slice(Math.max(0, i - WINDOW), i + WINDOW + 1)
        .some((l) => MD_LITERAL.test(l));
      if (near) hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

test("py-doc-envelope 哨兵：文档读取原语命中 ⊆ 豁免清单（锚在册）", () => {
  const problems = [];
  for (const rel of pyFiles()) {
    const entry = ALLOW.get(rel);
    const hits = scan(rel);
    if (hits.length > 0 && !entry) {
      problems.push(`名单外文档读取：${rel}\n  ${hits.map((h) => `:${h.line} ${h.text}`).join("\n  ")}`);
      continue;
    }
    if (entry && !entry.reason || (entry && !String(entry.reason || "").trim())) {
      problems.push(`豁免理由为空（空白不算理由）：${rel}`);
    }
    if (entry) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (!text.includes(entry.anchor)) {
        problems.push(`豁免锚空转（读取形态已改形/收口 → 条目须摘，棘轮只减不增）：${rel}\n  锚：${entry.anchor}`);
      }
    }
  }
  assert.deepEqual(problems, [], [
    "py 文档消费面旁路（豁免清单外直读 vault .md）——文档经 doc_consumption.load_for_vault 递入（ADR-016 §二装载入口）：",
    ...problems,
  ].join("\n"));
});

test("py-doc-envelope 哨兵：零命中空转条目即红（棘轮只减不增——收口后条目须摘）", () => {
  const idle = [];
  for (const [rel] of ALLOW) {
    if (scan(rel).length === 0) idle.push(rel);
  }
  assert.deepEqual(idle, [], "零命中空转豁免条目须摘（读取已归零，豁免失去对象）：" + idle.join(", "));
});

test("py-doc-envelope 哨兵：豁免清单条目文件全部存在（悬空条目即红）", () => {
  const missing = [...ALLOW.keys()].filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert.deepEqual(missing, [], "豁免清单悬空条目须摘：" + missing.join(", "));
});

test("py-doc-envelope 哨兵：栽子破坏实验——名单外直读必须红（判据有判力）", (t) => {
  const probe = path.join(ROOT, "scripts/vault-py/content/__pycache__");
  const fixture = path.join(ROOT, "scripts/vault-py/_sentinel_probe_tmp.py");
  fs.mkdirSync(probe, { recursive: true });
  fs.writeFileSync(
    fixture,
    'def rogue_read():\n    with open("wiki/entities/foo.md", "r", encoding="utf-8") as f:\n        return f.read()\n',
  );
  try {
    const hits = scan("scripts/vault-py/_sentinel_probe_tmp.py");
    assert.ok(hits.length > 0, "栽子未被签名捕获——判据失去判力（假绿）");
    const entry = ALLOW.get("scripts/vault-py/_sentinel_probe_tmp.py");
    assert.equal(entry, undefined, "栽子意外在豁免名单——清单口径失效");
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});
