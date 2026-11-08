#!/usr/bin/env node
// Component: Theme-Baseline（W0-3 · 契约「存量收敛条款」的执法件）
// @responsible: 主题门禁存量基线的加载与棘轮对账——
//   只减不增：现存违规数 > 基线 → [新增] 红（契约禁令不得再犯）；
//   逼销账：基线条目现存数 < 登记数 → [快照滞留] 红（已收敛却没删条目——销账动作
//   就是把条目从 theme-baseline.json 删掉/下调，防豁免永久化；同型先例＝
//   check-register-coverage 的基线豁免转绿必红）。
// 基线文件：scripts/quality/theme-baseline.json（与门禁同批提交；改动即销账记录）。
// 模式：fail-closed——基线文件缺失/不可解析 = [结构] 违规（它是契约条款的组成部分）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASELINE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "theme-baseline.json");

export function loadThemeBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { error: `scripts/quality/theme-baseline.json 不存在（契约存量收敛条款的执法件，缺失=fail-closed）` };
  }
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
  } catch (e) {
    return { error: `theme-baseline.json 解析失败：${e.message}` };
  }
}

// current: Map(key -> count)；baselineSection: {key: count}
// 返回 { added: [ [key, excess] ], stale: [ [key, was, now] ] }
export function compareBaseline(baselineSection, current) {
  const base = baselineSection && typeof baselineSection === "object" ? baselineSection : {};
  const added = [];
  const stale = [];
  for (const [k, c] of current) {
    const b = base[k] || 0;
    if (c > b) added.push([k, c - b]);
  }
  for (const [k, b] of Object.entries(base)) {
    const c = current.get(k) || 0;
    if (b > c) stale.push([k, b, c]);
  }
  return { added, stale };
}
