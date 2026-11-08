#!/usr/bin/env node
// Component: check-navigation 的门禁回归测试（读侧收编批，2026-10-21）
// @responsible: 钉住三检查面的执法活性——基线绿；直写/裸读/裸订阅三种探针各自必红。
// 运行：node --test scripts/quality/__tests__/check-navigation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-navigation.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PROBE = path.join(ROOT, "src", "features", "dashboard", "__nav_probe__.tsx");

function runGate() {
  try {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function withProbe(source, fn) {
  fs.writeFileSync(PROBE, source);
  try {
    return fn(runGate());
  } finally {
    fs.rmSync(PROBE, { force: true });
  }
}

test("基线自举：当前仓状态跑门禁必须 ok（三面零违例）", () => {
  const r = runGate();
  assert.equal(r.code, 0, `基线应 ok，实际：${r.out.slice(0, 300)}`);
  assert.match(r.out, /navigation=ok .*assign_sites=0 read_sites=0/);
});

test("反例①直写：业务代码 location.hash = → 红", () => {
  withProbe('export function p() { window.location.hash = "#/dashboard"; }\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[直写\].*__nav_probe__/);
  });
});

test("反例②裸读：业务代码自拼 URLSearchParams(window.location.hash…) → 红", () => {
  withProbe('export const p = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab");\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[裸读\].*__nav_probe__/);
    assert.doesNotMatch(red.out, /\[直写\]/, "读取不得被误判为直写");
  });
});

test("反例③裸订阅：业务代码自挂 hashchange → 红", () => {
  withProbe('export function p(f: () => void) { window.addEventListener("hashchange", f); }\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[裸订阅\].*__nav_probe__/);
  });
});

test("豁免面：注释行里的 location.hash 不计违例", () => {
  withProbe("// 说明：以前这里直读 window.location.hash，现已收编\nexport const p = 1;\n", (r) => {
    assert.equal(r.code, 0, r.out);
  });
});
