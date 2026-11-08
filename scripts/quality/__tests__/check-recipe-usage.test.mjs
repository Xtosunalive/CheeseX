#!/usr/bin/env node
// Component: check-recipe-usage 的门禁回归测试（结构收口尾批 V1——原零测试补齐）
// @responsible: 钉住配方六检查的执法活性——先红后绿（无红面证明的执法器可静默失效）。
// 运行：node --test scripts/quality/__tests__/check-recipe-usage.test.mjs（串行批——真实仓探针注入）
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-recipe-usage.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PROBE = path.join(ROOT, "src", "features", "__recipe_probe__.tsx");

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
  assert.match(r.out, /recipe_usage=ok/);
});

test("反例①裸 z＋②默认阴影＋⑥死 import：一探针三红", () => {
  fs.writeFileSync(PROBE, [
    'import { Ghost } from "@/components/ghost-module";',
    "export const __probe = <div className=\"z-40 shadow-md\"><Ghost /></div>;",
    "",
  ].join("\n"));
  try {
    const red = runGate();
    assert.notEqual(red.code, 0, "裸 z/默认阴影/死 import 必须非零退出");
    assert.match(red.out, /\[裸z\].*__recipe_probe__/);
    assert.match(red.out, /\[默认阴影\].*shadow-md/);
    assert.match(red.out, /\[悬空import\].*ghost-module/);
  } finally {
    fs.rmSync(PROBE, { force: true });
  }
});

test("反例④自写表格＋⑤cell 原生 button（render 回调语义）", () => {
  fs.writeFileSync(PROBE, [
    "export const cols = [",
    '  { render: (row) => <button>{row.x}</button> },',
    "];",
    "export const __probe = <table><thead></thead></table>;",
    "",
  ].join("\n"));
  try {
    const red = runGate();
    assert.notEqual(red.code, 0, "自写表格/cell 原生 button 必须非零退出");
    assert.match(red.out, /\[自写表格\].*__recipe_probe__/);
    assert.match(red.out, /\[cell内原生button\].*__recipe_probe__/);
  } finally {
    fs.rmSync(PROBE, { force: true });
  }
});

test("反例③h-7 新增超基线即红（棘轮只减不增）", () => {
  fs.writeFileSync(PROBE, "export const __probe = <div className=\"h-7\" />;\n");
  try {
    const red = runGate();
    assert.notEqual(red.code, 0, "h-7 超基线必须非零退出");
    assert.match(red.out, /h-7/);
  } finally {
    fs.rmSync(PROBE, { force: true });
  }
});

test("复原自证：探针撤销后复绿", () => {
  const r = runGate();
  assert.equal(r.code, 0, `探针未清干净或基线被污染：${r.out.slice(0, 200)}`);
});
