#!/usr/bin/env node
// Component: Ui-Stat-Provenance-Checker（WP-074 · 复用域 mechanism-patterns 模式六「多视角对账：展示数字可溯源」执法件）
// @responsible: 静态扫描前端真实 Statistic 展示点，与映射清单、OpenAPI 契约三方对账，机器发现「给用户看的
//   数字找不到后端出处 / 出处不存在 / 口径读不到」——本类可溯源问题现有结构/漂移类门禁扫不到。
// 两条规则：
//   R1 覆盖完整：前端实际含 Statistic 的文件集合（排除白名单/组件定义/测试）＝清单 views 的 file 集合，
//      且每文件实际点数＝statCount（前端多了没登记、清单幽灵、点数不符即红）；
//   R2 口径可查：每个 sourceApi 在 OpenAPI 至少一个 operation 带非空 description 或 summary。
// 纳入执法：新视图/新统计点在 contracts/ui-stat-provenance.json 登记 apiSources（视图↔哪次真实调用），
//   端点清单由生成器派生（声明即执法，SSOT）。
// 退役记录（WP-136 c 门禁留任复核·降档，2026-11-07）：原 R2「出处真实＝sourceApis ⊆ OpenAPI paths」
//   已构造性不可能违例——sourceApis 自 WP-136 b 起由 scripts/quality/gen-ui-stat-provenance.mjs 按
//   apiSources 派生，派生时认不出契约路径即抛（宁红不静默）。该职责现住生成器，面漂移由
//   check:derivation-sync 自动跑（mechanism-patterns 行 generator≠null 即入保，零新增门禁）。
//   退出路径：若派生面再次被人手改或生成器退役，恢复本检查器 git 历史 97f2ca61 版的 paths 成员判定段即可。
// @inputs: contracts/ui-stat-provenance.json＋contracts/http-api.openapi.json＋src/**/*.tsx
// @outputs: `ui_stat_provenance=ok ...` 或 `ui_stat_provenance=FAIL violations=N`（exit 1）
// @context: Quality Gate。静态契约层；不做前端数据流静态分析，不判业务对错。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// 精确匹配真实 Statistic JSX 标签：后跟空格、> 或行尾；排除 Record<StatisticSize 这类子串误匹配
const STAT_TAG = /<Statistic( |>|$)/;

function walkTsxFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsxFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function isTestFile(rel) {
  return rel.includes(`${path.sep}test${path.sep}`) ||
    rel.includes(`${path.sep}__tests__${path.sep}`) ||
    /\.(test|spec)\.tsx$/.test(rel);
}

/**
 * 扫描前端真实统计点：返回 Map<相对文件路径, 点数>（已排除测试与白名单）
 */
function scanFrontend(rootDir, excludedFiles) {
  const srcDir = path.join(rootDir, "src");
  const found = new Map();
  for (const full of walkTsxFiles(srcDir)) {
    const rel = path.relative(rootDir, full).split(path.sep).join("/");
    if (isTestFile(rel) || excludedFiles.has(rel)) continue;
    const text = fs.readFileSync(full, "utf8");
    const count = text.split("\n").filter((line) => STAT_TAG.test(line)).length;
    if (count > 0) found.set(rel, count);
  }
  return found;
}

/**
 * @param {{ rootDir?: string }} options
 * @returns {{ ok: boolean, violations: string[], stats: object }}
 */
export function runUiStatProvenance(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, "contracts", "ui-stat-provenance.json"), "utf8"),
  );
  const openapi = JSON.parse(
    fs.readFileSync(path.join(rootDir, "contracts", "http-api.openapi.json"), "utf8"),
  );
  const violations = [];
  const excludedFiles = new Set((manifest.excluded || []).map((e) => e.file));

  // ── R1 覆盖完整：前端实际 vs 清单登记 ──
  const actual = scanFrontend(rootDir, excludedFiles);
  const registered = new Map((manifest.views || []).map((v) => [v.file, v.statCount]));

  for (const [file, count] of actual) {
    if (!registered.has(file)) {
      violations.push(`[未登记] ${file} 含 ${count} 个 Statistic 但清单未登记来源——新增统计点必须在 ui-stat-provenance.json 登记后端出处`);
    } else if (registered.get(file) !== count) {
      violations.push(`[点数不符] ${file} 实际 ${count} 个 Statistic，清单登记 ${registered.get(file)} 个`);
    }
  }
  for (const [file, statCount] of registered) {
    if (!actual.has(file)) {
      violations.push(`[幽灵登记] 清单登记 ${file}（${statCount} 点）但前端找不到该文件或无 Statistic——删除或更正`);
    }
  }

  // ── R2 口径可查（原 R2「出处真实」已退役，见文件头退役记录）──
  for (const view of manifest.views || []) {
    for (const api of view.sourceApis || []) {
      const item = openapi.paths[api];
      if (!item) {
        violations.push(`[出处不存在] ${view.file} 来源 ${api} 不在 OpenAPI paths——派生面被人手改过（正常路径下不可能，见 wp136 退役记录）`);
        continue;
      }
      // 仓库惯例：operation 口径主要写在 summary（110 个 operation 中 88 个仅 summary），description 或 summary 任一非空即可
      const hasDesc = Object.values(item).some(
        (op) => op && typeof op === "object" &&
          (String(op.description || "").trim().length > 0 || String(op.summary || "").trim().length > 0),
      );
      if (!hasDesc) {
        violations.push(`[口径缺失] ${view.file} 来源 ${api} 无任何非空 operation description——对账者读不到口径`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    stats: {
      files: actual.size,
      statPoints: [...actual.values()].reduce((a, b) => a + b, 0),
      views: (manifest.views || []).length,
      sourceApis: new Set((manifest.views || []).flatMap((v) => v.sourceApis)).size,
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runUiStatProvenance({ rootDir: process.env.UI_STAT_PROVENANCE_ROOT || undefined });
  if (!result.ok) {
    for (const line of result.violations) console.error("  " + line);
    console.log(`ui_stat_provenance=FAIL violations=${result.violations.length}`);
    process.exit(1);
  }
  console.log(`ui_stat_provenance=ok files=${result.stats.files} points=${result.stats.statPoints} views=${result.stats.views} source_apis=${result.stats.sourceApis}`);
}
