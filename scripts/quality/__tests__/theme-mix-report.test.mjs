#!/usr/bin/env node
// Component: theme-mix-report 的回归测试（W0-5 · 契约 A7）
// @responsible: 钉住三模式实算的正确性——六值与 2026-10-15 体检报告手算值对齐
//（light #fbfbfc/#eeeff2、dark #0d131f/#151d2a、warm #f2ead8/#dfd1b7，±1/255 容差）。
// W0（2026-10-28 Shakuro 深色定调）改 L0 dark 值后同步修订：dark surface-alter #0d131f→#121318、border-soft #151d2a→#1d1f25。
// WP-036（2026-10-28 Shakuro 卡片浮起：light paper→#f8f9fa 白卡浮起、dark card/mist 分层）后再同步：
// light surface-alter #fbfbfc→#f6f7f9、border-soft #eeeff2→#ecedf0；dark surface-alter #121318→#14151a（mist→#1c1d24）。
// 这些数值同时是决策卡 §7.2 三模式数值表的机器源——L0 改值时本测试红＝数值表需同步修订。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "theme-mix-report.mjs");

function report() {
  return JSON.parse(execFileSync("node", [SCRIPT, "--json"], { encoding: "utf8" }));
}

test("三模式六值与体检手算对齐（±1/255）", () => {
  const rows = report();
  const expected = {
    "surface-alter|light": "#f6f7f9", "surface-alter|dark": "#14151a", "surface-alter|warm": "#f2ead8",
    "border-soft|light": "#ecedf0", "border-soft|dark": "#1d1f25", "border-soft|warm": "#dfd1b7",
  };
  for (const r of rows) {
    const key = `${r.role.replace("--color-", "")}|${r.mode}`;
    const want = expected[key];
    assert.ok(want, `未知角色/模式：${key}`);
    const [w, a] = [want, r.value].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    const drift = Math.max(Math.abs(w[0] - a[0]), Math.abs(w[1] - a[1]), Math.abs(w[2] - a[2]));
    assert.ok(drift <= 1, `${key}: 实算 ${r.value} 与登记 ${want} 漂移 ${drift}（L0 改值须同步决策卡 §7.2 数值表与本期望）`);
  }
});

test("对比比输出且 warm 表头抬升比 < 1.05（目检重点的机器提示位）", () => {
  const rows = report();
  const warmHeader = rows.find((r) => r.role === "--color-surface-alter" && r.mode === "warm");
  assert.ok(warmHeader && warmHeader.contrastVsCard > 1 && warmHeader.contrastVsCard < 1.05,
    `warm 表头 CR 应在 (1, 1.05)——近不可见区间，人工目检为唯一裁定；实际 ${warmHeader && warmHeader.contrastVsCard}`);
});
