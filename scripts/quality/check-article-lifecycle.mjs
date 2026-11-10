// Component: Check-Article-Lifecycle
// @responsible: SPEC-013 文章生命周期路径角色契约的静态执法面——契约良构＋server 侧裸拼四族路径
//   字面量即红（必须经 server/shared/article-lifecycle-paths.cjs 单源取用）。
//   SPEC-028 扩面：可变性档三面——角色行 mutability 必填且合法（枚举单源 schema definitions）、
//   证据角色档位映射（source-archive=read-only-evidence，draft/working/formal=human-editable）、
//   read-only 档执法测试在册（vault-io 测试含 0o444 断言）。
// @inputs: contracts/article-lifecycle.json（+schema 形态断言）、server/**/*.cjs 源码
// @outputs: article_lifecycle=ok|FAIL（exit 0/1）
// @context: repo 根（脚本位置锚定）。扫描豁免：__tests__（夹具路径字面量合法）、整行注释、
//   行内标记 article-lifecycle-path:（本门禁自身与单源模块不在扫描域）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// 测试缝：自测经环境变量注入临时扫描域/契约（生产缺省锚定 repo 根）
const CONTRACT_PATH = process.env.CHEESEH_LIFECYCLE_CONTRACT || path.join(ROOT, "contracts", "article-lifecycle.json");
const SERVER_DIR = process.env.CHEESEH_LIFECYCLE_SCAN_ROOT || path.join(ROOT, "server");
const SCHEMA_PATH = process.env.CHEESEH_LIFECYCLE_SCHEMA || path.join(ROOT, "contracts", "article-lifecycle.schema.json");
const ENFORCE_TEST_PATH = process.env.CHEESEH_LIFECYCLE_ENFORCE_TEST || path.join(ROOT, "server", "shared", "__tests__", "vault-io.test.cjs");
const SINGLE_SOURCE = "article-lifecycle-paths.cjs";
const ESCAPE_MARKER = "article-lifecycle-path:";

const problems = [];

// ── 1. 契约良构（schema 形态的关键面手执法：四角色齐全、根路径合法且唯一）──
let contract = null;
try {
  contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8"));
} catch (error) {
  console.error(`article_lifecycle=FAIL 契约不可读/非法 JSON：${error.message}`);
  process.exit(1);
}
const EXPECTED_ROOTS = {
  draft: /^知识库\/raw\/drafts$/,
  "standard-working": /^知识库\/raw\/precleaned$/,
  "standard-formal": /^知识库\/wiki\/articles$/,
  "source-archive": /^知识库\/raw\/archive$/,
};
const roles = (contract && Array.isArray(contract.roles)) ? contract.roles : [];
const roleIds = new Set(roles.map((r) => r && r.id));
for (const expected of Object.keys(EXPECTED_ROOTS)) {
  if (!roleIds.has(expected)) problems.push(`契约缺角色: ${expected}`);
}
const seenRoots = new Set();
for (const r of roles) {
  if (!r || typeof r.root !== "string" || !EXPECTED_ROOTS[r.id] || !EXPECTED_ROOTS[r.id].test(r.root)) {
    problems.push(`角色 ${r && r.id} 的 root 非法: ${JSON.stringify(r && r.root)}`);
  }
  if (seenRoots.has(r.root)) problems.push(`root 重复: ${r.root}`);
  seenRoots.add(r.root);
  if (!Number.isInteger(r.steady_state_copies) || r.steady_state_copies < 0 || r.steady_state_copies > 1) {
    problems.push(`角色 ${r.id} steady_state_copies 须为 0/1（单份收敛裁定）`);
  }
}

// ── 1b. 可变性档三面（SPEC-028）──
// 面①：角色行 mutability 必填且 ∈ 枚举（枚举单源 schema definitions.mutability，禁手抄）
const MUTABILITY_MAP = { // SPEC-028 §四：档位映射（证据角色只读、过程角色人可改）
  draft: "human-editable",
  "standard-working": "human-editable",
  "standard-formal": "human-editable",
  "source-archive": "read-only-evidence",
};
let mutabilityEnum = null;
try {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
  const def = schema.definitions && schema.definitions.mutability;
  mutabilityEnum = def && Array.isArray(def.enum) ? def.enum : null;
  if (!mutabilityEnum) problems.push("schema definitions.mutability.enum 缺失（SPEC-028 枚举单源）");
} catch (error) {
  problems.push(`schema 不可读（SPEC-028 枚举单源）：${error.message}`);
}
for (const r of roles) {
  if (!r || !r.id) continue;
  if (!r.mutability) problems.push(`角色 ${r.id} 缺 mutability 声明（SPEC-028 面一：必填）`);
  else if (mutabilityEnum && !mutabilityEnum.includes(r.mutability)) {
    problems.push(`角色 ${r.id} mutability 非法: ${r.mutability}（合法集=${mutabilityEnum.join("/")})`);
  }
  if (r.mutability && r.mutability !== MUTABILITY_MAP[r.id]) {
    problems.push(`角色 ${r.id} mutability=${r.mutability} 与 SPEC-028 §四映射不符（应为 ${MUTABILITY_MAP[r.id]}）`);
  }
}
// 面②：read-only-evidence 档必须有机器执法在册——vault-io 测试含 0o444 与档位拒写断言（声明=执法，缺测试即纸面法律）
try {
  const enforceTest = fs.readFileSync(ENFORCE_TEST_PATH, "utf-8");
  if (!/0o444/.test(enforceTest)) problems.push(`read-only 档执法测试缺 0o444 断言（${path.relative(ROOT, ENFORCE_TEST_PATH)}——SPEC-028 面二）`);
  if (!/read-only-evidence/.test(enforceTest)) problems.push(`read-only 档执法测试缺档位拒写断言（${path.relative(ROOT, ENFORCE_TEST_PATH)}——SPEC-028 面二）`);
  // P3 批收紧：红队轮次产出的两条回归锚必须在册（防「执法测试存在但关键反例用例被删」的静默退化）
  for (const anchor of ["红队 P1 回归", "别名路径不得穿透"]) {
    if (!enforceTest.includes(anchor)) problems.push(`read-only 档执法测试缺回归锚「${anchor}」（${path.relative(ROOT, ENFORCE_TEST_PATH)}——SPEC-028 面二 P3 收紧）`);
  }
} catch (error) {
  problems.push(`read-only 档执法测试不可读: ${path.relative(ROOT, ENFORCE_TEST_PATH)}（SPEC-028 面二：声明=执法）`);
}

// ── 2. 裸拼字面量扫描（含正则转义形态——源码里 \/ 与 / 两种写法都拦）──
const VIOLATION_PATTERNS = [
  /知识库\\?\/raw\\?\/(?:drafts|precleaned|archive)/,
  /["']知识库["']\s*,\s*["']raw["']\s*,\s*["'](?:drafts|precleaned|archive)["']/,
  /wiki\\?\/articles\\?\//,
  /["']wiki["']\s*,\s*["']articles["']/,
];

function listServerFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...listServerFiles(abs));
    } else if (entry.isFile() && entry.name.endsWith(".cjs") && entry.name !== SINGLE_SOURCE) {
      out.push(abs);
    }
  }
  return out;
}

for (const file of listServerFiles(SERVER_DIR)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (line.includes(ESCAPE_MARKER)) return;
    for (const pattern of VIOLATION_PATTERNS) {
      if (pattern.test(line)) {
        problems.push(`${rel}:${index + 1} 裸拼文章生命周期路径（须经 shared/${SINGLE_SOURCE}）：${trimmed.slice(0, 100)}`);
        break;
      }
    }
  });
}

if (problems.length > 0) {
  console.error("article_lifecycle=FAIL");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`article_lifecycle=ok roles=${roles.length} (单源=shared/${SINGLE_SOURCE}，扫描域=server/** 非 test，SPEC-028 档面=3)`);
