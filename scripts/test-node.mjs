#!/usr/bin/env node
/**
 * test-node.mjs
 *
 * Auto-discovers Node.js test files and runs them with `node --test`.
 * Eliminates manual test file enumeration in package.json scripts.
 *
 * Discovery uses stable directory and extension rules; test contents never affect inclusion.
 * Output prints discovered file count before test run for auditability.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

// ── Discovery patterns ──
// （export 供 check-test-placement.mjs 落位对账门禁 import 单源——发现规则只有这一份）
export const DISCOVERY_PATTERNS = [
  // Electron route handler tests
  {
    dir: "server/routes/__tests__",
    pattern: /\.test\.cjs$/,
  },
  // Electron service tests (root + nested __tests__ directories)
  // ⚠️  Nested scan covers both server/services/__tests__/ and server/services/*/__tests__/.
  {
    dir: "server/services",
    nested: "__tests__",
    pattern: /\.test\.cjs$/,
  },
  // Electron shared utility tests
  {
    dir: "server/shared/__tests__",
    pattern: /\.test\.cjs$/,
  },
  // Script tests
  {
    dir: "scripts/__tests__",
    pattern: /\.test\.mjs$/,
  },
  // Quality checker tests
  {
    dir: "scripts/quality/__tests__",
    pattern: /\.test\.mjs$/,
  },
  // WP-143 波2：产品哨兵守卫子目录（src/test/guards 迁入；WP-143 波4 kit 翻转后 EXCLUDE_GLOBS 的 discipline-kit 条目同批退役）
  {
    dir: "scripts/quality/__tests__/guards",
    pattern: /\.test\.mjs$/,
  },
  // Problem-board 看板解析测试（2026-10-24 test-placement 门禁立闸找回的游离测试——
  // 目录此前不在发现规则内，写了从未随 test:node 跑过；单文件实测 5/5 绿后收编）
  {
    dir: "scripts/problem-board/__tests__",
    pattern: /\.test\.mjs$/,
  },
  // Dev-log derivation tests（fold 派生视图；发现规则与 quality 同构）
  {
    dir: "scripts/dev-log/__tests__",
    pattern: /\.test\.mjs$/,
  },
  // vault-runtime A 类脚本主流程测试（SPEC-011 §三·附 设计 6：以子进程驱动真实 Python 脚本）
  {
    dir: "scripts/vault-runtime/__tests__",
    pattern: /\.test\.cjs$/,
  },
  // e2e 环境守卫测试（WP1 的 fixture 强制隔离守卫——此前未入发现清单，从未随 test:node 跑过）
  {
    dir: "scripts/e2e/__tests__",
    pattern: /\.test\.cjs$/,
  },
];

// ── Exclude patterns ──

export const EXCLUDE_GLOBS = [
  "node_modules",
  "test/fixtures",
];

// Vitest 已随并仓回到本仓：src/**/*.test.ts(x) 归 vitest 管（vite.config.ts test.include），
// 本 node runner 只发现 .test.cjs/.test.mjs（见上方 DISCOVERY_PATTERNS）；两者目录/扩展名不重叠。
// 该排除名单保留为空集（isExcluded() 仍引用它，可继续登记）——现存 .cjs/.mjs 测试无一依赖 Vitest 全局。
// 历史：源库曾把 server/services/__tests__/entity-compliance-service.test.cjs 列入，理由是该遗留套件
// 依赖 Vitest 全局。实测该文件不 import vitest（expect( / vi. 均 0 次），已在分库搬运时补上
// `const { describe, it } = require("node:test");`，故无需排除、纳入 node --test 发现范围。
export const VITEST_MANAGED_TESTS = new Set([]);

export const SERIAL_NODE_TESTS = new Set([
  // 2026-11-06 补登记（WP-131 实测）：check-schema-shape 破坏实验在真仓写瞬时探针
  // （src/features/entity-compliance/__shape_probe__.tsx，finally 复原）——与 check-knip 的
  // 全仓 knip 扫描并行撞时间窗，knip 撞见探针瞬间＝基线外新增红（连跑两遍各挂不同面，
  // 单跑各自全绿，串行批次消解。theme 注入先例同因第四案）。
  "scripts/quality/__tests__/check-schema-shape.test.mjs",
  // 2026-10-30 纠正路径：该测试曾住 server/services/__tests__/，搬进 projection 后条目静默失效，
  // 计时测试退回并行批——全量跑相对预算被并发拖破（单跑 2.2s 过，全量 9.6s/12.2s 红）。
  // 失效面由 check-test-placement 面③拦下（串行名单逐项须命中发现集合）。
  "server/services/projection/__tests__/document-inventory-performance.test.cjs",
  // 2026-10-07 补登记：两套 theme 门禁测试对真实仓文件（DashboardView.tsx/index.css）
  // 做受控注入→复原，并行跑时互相抹探针/互相污染复原基线（vocab 反例红不了、index.css
  // 残留探针）——单独跑各自全绿，实证为并行互踩，非门禁缺陷。串行批次消解。
  // 2026-10-24 补登记（WP-003 批分诊）：同族 src/ 受控注入自测——theme 先例同因（并行互踩致失败用例随
  // 时序漂移，两轮全量实测各挂不同用例；主树基线同 Flake）。interaction-state（busy 布尔配对）/
  // term-copy（TERM 字面量）/navigation（路由注册）三支入串行批消解。
  "scripts/quality/__tests__/check-interaction-state.test.mjs",
  "scripts/quality/__tests__/check-navigation.test.mjs",
  "scripts/quality/__tests__/check-theme-vocab.test.mjs",
  "scripts/quality/__tests__/check-theme-tokens.test.mjs",
  // 2026-10-16 补登记（结构收口尾批 V1）：配方执法器测试——真实仓 src/ 探针注入与复原，
  // 与其它 src/ 注入测试并行互踩（theme 先例同因），入串行批
  "scripts/quality/__tests__/check-recipe-usage.test.mjs",
  // 2026-11-07 WP-138 补登记（两支漏网注入者）：本批实测「往真实 src/ 写探针」的测试共 9 支，
  // 名单只登 7 支——这两支在并行批跑，与同目录（src/features/dashboard/）其它探针及全仓扫描型
  // 门禁撞时间窗。现场：本机整桶 `check-theme-tokens` 的「复原后绿」读到一支正在消失的
  // `__nav_probe__.tsx` → readFileSync ENOENT 把门禁进程炸死（单跑/三支并发定向复现各 3 轮均绿，
  // 需整桶时序）。根治不靠记得登记：check-test-placement 新增反向面——注入型测试未入串行名单即红。
  "scripts/quality/__tests__/check-table-usage.test.mjs",
  "scripts/quality/__tests__/check-ui-kit.test.mjs",
]);

// ── 运行器环境钉（PR-116：持久层写通道全局预设钉——单测试漏钉时兜底）──
// ①DECISIONS_MIRROR_DIR（Master 加固批）：镜像写通道钉 /tmp 一次性目录（多个 approval 系
//   测试曾把夹具裁定写进真仓 data/governance；单点钉不可枚举，运行器级一钉根治）。
// ②KB_DATA_DIR（PR-116）：server/main.cjs 顶层 dataDbPath() 缺省落 repo data/
//   ——起真服务的测试漏注入时，夹具行会进任务树 data/derived-index.db（本机两树实测）；
//   钉 /tmp 一次性目录同构兜底。显式给出者（e2e/单测自钉）不覆盖。
export function buildRunnerEnv(baseEnv, pid = process.pid) {
  const env = { ...baseEnv };
  if (!env.DECISIONS_MIRROR_DIR) env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), `test-node-mirror-${pid}`);
  if (!env.KB_DATA_DIR) env.KB_DATA_DIR = path.join(os.tmpdir(), `test-node-data-${pid}`);
  // runtime-scope 波4（launch_pins_full_set 落到写面全集）：管线轨迹与分类观察账本同钉
  // /tmp 一次性目录——此前仅测试 conftest 自钉，node 侧单测漏钉即漏（PR-120 同病族）。
  if (!env.PIPELINE_TRAJECTORIES_DIR) env.PIPELINE_TRAJECTORIES_DIR = path.join(os.tmpdir(), `test-node-trajectories-${pid}`);
  if (!env.TAXONOMY_OBSERVATIONS_FILE) env.TAXONOMY_OBSERVATIONS_FILE = path.join(os.tmpdir(), `test-node-taxonomy-${pid}`, "taxonomy-observations.jsonl");
  // VAULT_PATH 不盲钉（实证反例：inference-ontology.test 刻意读真库 ontology 做能力刻画——
  // 跑批级钉会打破；该通道写面另有 VAULT_GIT_LEDGER_DISABLE 开关，读面依赖显式夹具纪律）
  return env;
}

// ── Public API ──

/**
 * Discover all Node.js test files in the repository.
 *
 * @param {string} root - Repository root directory.
 * @returns {string[]} Sorted array of relative test file paths.
 */
export function discoverNodeTests(root) {
  const results = [];

  for (const spec of DISCOVERY_PATTERNS) {
    const baseDir = path.join(root, spec.dir);

    if (!dirExists(baseDir)) continue;

    if (!spec.nested) {
      // Direct directory scan
      const entries = readDirSafe(baseDir);
      for (const entry of entries) {
        if (spec.pattern.test(entry)) {
          const absolutePath = path.join(baseDir, entry);
          const relative = path.relative(root, absolutePath);
          if (!isExcluded(relative)) {
            results.push(relative);
          }
        }
      }
    } else {
      // Recursive scan for nested __tests__ directories
      collectNestedTests(root, baseDir, spec.dir, spec.nested, spec.pattern, results);
    }
  }

  results.sort();
  return results;
}

export function partitionNodeTests(files) {
  return {
    concurrent: files.filter((file) => !SERIAL_NODE_TESTS.has(file)),
    serial: files.filter((file) => SERIAL_NODE_TESTS.has(file)),
  };
}

function collectNestedTests(root, baseDir, dirPrefix, nestedDirName, pattern, results) {
  if (!dirExists(baseDir)) return;

  const entries = readDirSafe(baseDir);
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry);
    if (!isDir(fullPath)) continue;

    if (entry === nestedDirName) {
      // Found a __tests__ directory — scan for test files
      const nestedEntries = readDirSafe(fullPath);
      for (const ne of nestedEntries) {
        if (pattern.test(ne)) {
          const relative = path.relative(root, path.join(fullPath, ne));
          if (!isExcluded(relative)) {
            results.push(relative);
          }
        }
      }
    } else {
      // Regular directory — recurse deeper for nested __tests__
      collectNestedTests(root, fullPath, `${dirPrefix}/${entry}`, nestedDirName, pattern, results);
    }
  }
}

function isExcluded(relativePath) {
  return VITEST_MANAGED_TESTS.has(relativePath)
    || EXCLUDE_GLOBS.some((g) => relativePath.startsWith(g + "/") || relativePath === g);
}

// ── File system helpers ──

function dirExists(dirPath) {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function isDir(fullPath) {
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function readDirSafe(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

// ── CLI: run discovered tests ──

function main() {
  const root = process.cwd();
  const files = discoverNodeTests(root);

  if (files.length === 0) {
    console.error("test-node: No test files discovered.");
    process.exit(1);
  }

  console.log(`test-node: discovered ${files.length} test files`);
  for (const f of files) {
    console.log(`  ${f}`);
  }

  const batches = partitionNodeTests(files);
  const runs = [
    { files: batches.concurrent, args: [] },
    ...batches.serial.map((file) => ({ files: [file], args: ["--test-concurrency=1"] })),
  ].filter((run) => run.files.length > 0);
  for (const run of runs) {
    const absoluteFiles = run.files.map((file) => path.resolve(root, file));
    const result = spawnSync(process.execPath, ["--test", ...run.args, ...absoluteFiles], {
      stdio: "inherit",
      cwd: root,
      env: buildRunnerEnv(process.env, process.pid),
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const isMain = path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
