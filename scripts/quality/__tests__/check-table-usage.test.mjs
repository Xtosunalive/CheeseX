#!/usr/bin/env node
// Component: check-table-usage 的门禁回归测试（A2+B 活性门禁批）
// @responsible: 钉住表格用法三道闸的执法活性——先红后绿。
// 运行：node --test scripts/quality/__tests__/check-table-usage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-table-usage.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PROBE_FEATURE = path.join(ROOT, "src", "features", "dashboard", "__usage_probe__.tsx");

function runGate() {
  try {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

test("基线自举：当前仓状态跑门禁必须 ok", () => {
  const r = runGate();
  assert.equal(r.code, 0, `基线应 ok，实际：${r.out.slice(0, 300)}`);
  assert.match(r.out, /table_usage=ok/);
});

test("反例①：features/ 出现自写 <table> → 红", () => {
  fs.writeFileSync(PROBE_FEATURE, "export const __probe = <table><thead></thead></table>;\n");
  try {
    const red = runGate();
    assert.notEqual(red.code, 0, "自写表格必须非零退出");
    assert.match(red.out, /自写表格.*__usage_probe__/);
  } finally {
    fs.rmSync(PROBE_FEATURE, { force: true });
  }
});

test("反例②：preset 出现零挂载死类 → 红", () => {
  const preset = path.join(ROOT, "src", "styles", "table-preset.css");
  const original = fs.readFileSync(preset, "utf-8");
  try {
    fs.writeFileSync(preset, original + "\n.data-table__probe-dead { padding: 0; }\n");
    const red = runGate();
    assert.notEqual(red.code, 0, "死类必须非零退出");
    assert.match(red.out, /BEM死类.*probe-dead/);
  } finally {
    fs.writeFileSync(preset, original);
  }
});

test("复原后绿：门禁回到 ok", () => {
  const r = runGate();
  assert.equal(r.code, 0, `复原后必须 ok，实际：${r.out.slice(0, 300)}`);
});
