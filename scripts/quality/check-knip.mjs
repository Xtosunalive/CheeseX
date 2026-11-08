#!/usr/bin/env node
// Component: Knip-Baseline-Gate（死码检测棘轮门禁——WP-126 T1，标准工具接线）
// @responsible: 「不自造轮子」在门禁构造场景的落地实例：不自研死码扫描，接标准工具 knip（6.34，
//   已在 devDependencies；knip.json 承载 entry/project/ignore 配置）。本件只做基线棘轮：
//   现算发现 ⊆ contracts/knip-baseline.json（存量欠账入册），基线外新增即红；基线内条目消失＝
//   收账提示（不拦，提示 --write 缩减）。首算 107 条（103 未用导出＋2 未用文件＋2 未用依赖，
//   大头为 shadcn barrel 惯例导出——存量欠账逐批清偿，增量不进名单）。
// @inputs: npx knip --reporter json；contracts/knip-baseline.json
// @outputs: stdout knip_gate=ok|FAIL；非零退出＝基线外新增死码
// @context: 准入四问（P0）：①死码无法结构消灭 ②内部质量·通用基础层（兄弟仓同类留在标准工具链）
//   ③扫描唯一手段（knip 语义分析）④现成工具胜任✓。--write 只在收账批用。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "contracts", "knip-baseline.json");

/** 归一化：knip issues → 稳定指纹集 "type|file|name"（纯函数，测试件直调） */
export function flattenIssues(issues) {
  const out = new Set();
  for (const item of issues || []) {
    const file = item.file;
    for (const e of item.exports || []) out.add(`export|${file}|${e.name}`);
    for (const e of item.types || []) out.add(`type|${file}|${e.name}`);
    for (const e of item.files || []) out.add(`file|${e.name ?? file}|`);
    for (const e of item.dependencies || []) out.add(`dependency|${file ?? "package.json"}|${e.name}`);
    for (const e of item.devDependencies || []) out.add(`devDependency|${file ?? "package.json"}|${e.name}`);
    for (const e of item.unlisted || []) out.add(`unlisted|${file}|${e.name}`);
    for (const e of item.unresolved || []) out.add(`unresolved|${file}|${e.name}`);
    for (const e of item.duplicates || []) out.add(`duplicate|${file}|${e.name ?? ""}`);
    for (const e of item.enumMembers || []) out.add(`enumMember|${file}|${e.name}`);
    for (const e of item.binaries || []) out.add(`binary|${file}|${e.name}`);
  }
  return out;
}

/** 棘轮对账（纯函数）：返回 { news, gones } */
export function reconcileBaseline(current, baseline) {
  const news = [...current].filter((x) => !baseline.has(x));
  const gones = [...baseline].filter((x) => !current.has(x));
  return { news, gones };
}

function main() {
  const writeMode = process.argv.includes("--write");
  let raw;
  try {
    raw = execFileSync("npx", ["knip", "--reporter", "json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
  } catch (error) {
    // knip 发现问题也会非零退出——stdout 仍是完整 JSON，照常解析；真崩（无 JSON）才 FAIL
    raw = String(error.stdout || "");
    if (!raw.trim().startsWith("{")) {
      console.log(`knip_gate=FAIL（knip 未产出 JSON：${String(error.stderr || error.message).slice(0, 200)}）`);
      process.exit(1);
    }
  }
  const issues = JSON.parse(raw).issues;
  const current = flattenIssues(issues);

  if (writeMode) {
    fs.writeFileSync(BASELINE, JSON.stringify({ generated_by: "node scripts/quality/check-knip.mjs --write", note: "存量死码欠账棘轮基线——只减不增；新增即红，清偿后 --write 缩减", entries: [...current].sort() }, null, 2) + "\n");
    console.log(`knip_gate=baseline-written entries=${current.size}`);
    return;
  }

  const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
  const { news, gones } = reconcileBaseline(current, baseline);
  if (news.length === 0) {
    console.log(`knip_gate=ok baseline=${baseline.size} current=${current.size}（棘轮：无基线外新增）${gones.length ? `；可收账缩减 ${gones.length} 条（--write）` : ""}`);
    for (const g of gones) console.log(`  ~ 已清偿: ${g}`);
    return;
  }
  console.log(`knip_gate=FAIL violations=${news.length}（基线外新增死码——修复或经 P0 准入后入基线）`);
  for (const n of news) console.log(`  + ${n}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
