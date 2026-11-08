#!/usr/bin/env node
// Component: check-ui-kit 的门禁回归测试（ui-kit 棘轮基线批 2026-10-21；同日二次扩面 input）
// @responsible: 钉住双标签棘轮活性——基线绿；新文件原生 button／input、分标签存量膨胀、基线僵尸各自必红；计数下降不拦。
// 运行：node --test scripts/quality/__tests__/check-ui-kit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-ui-kit.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const BASELINE = path.join(ROOT, "contracts", "ui-kit-baseline.json");
const PROBE = path.join(ROOT, "src", "features", "dashboard", "__tag_probe__.tsx");

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("基线自举：当前仓原生 <button>/<input> 分标签计数与基线一致 → ok", () => {
  const r = runGate();
  assert.equal(r.code, 0, r.out.slice(0, 300));
  assert.match(r.out, /ui_kit=ok files=\d+ raw_buttons=(\d+) raw_inputs=(\d+) baseline=\1\/\2/);
});

test("反例①：基线外新文件写原生 <button → 红", () => {
  withProbe('export const P = () => <button type="button">x</button>;\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[新文件原生button\].*__tag_probe__/);
  });
});

test("反例②：基线外新文件写原生 <input → 红（2026-10-21 扩面）", () => {
  withProbe('export const P = () => <input type="text" />;\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[新文件原生input\].*__tag_probe__/);
  });
});

test("反例③：基线内文件某标签增多 → 红（分标签只减不增）", () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf-8"));
  const rel = Object.keys(base.files).find((r) => base.files[r].button > 0);
  const abs = path.join(ROOT, rel);
  const original = fs.readFileSync(abs, "utf-8");
  try {
    fs.writeFileSync(abs, original + "\nexport const __probeGrowth = <button />;\n");
    const red = runGate();
    assert.notEqual(red.code, 0);
    assert.match(red.out, new RegExp(`\\[存量膨胀\\] ${escapeRe(rel)}: <button>`));
  } finally {
    fs.writeFileSync(abs, original);
  }
});

test("反例④：基线登记了现场已归零的文件 → 红（僵尸条目须缩减）", () => {
  const raw = fs.readFileSync(BASELINE, "utf-8");
  try {
    const base = JSON.parse(raw);
    base.files["src/features/dashboard/__gone__.tsx"] = { button: 2 };
    fs.writeFileSync(BASELINE, JSON.stringify(base, null, 2) + "\n");
    const red = runGate();
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[基线僵尸\].*__gone__/);
  } finally {
    fs.writeFileSync(BASELINE, raw);
  }
});

test("不拦：基线内文件计数下降（按触碰迁移）→ ok 并提示可重算", () => {
  const raw = fs.readFileSync(BASELINE, "utf-8");
  try {
    const base = JSON.parse(raw);
    const rel = Object.keys(base.files).find((r) => base.files[r].button > 0);
    base.files[rel].button += 1; // 基线比现场多 1 ⇔ 现场相对基线下降了 1
    fs.writeFileSync(BASELINE, JSON.stringify(base, null, 2) + "\n");
    const r = runGate();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /已下降，可重算基线/);
  } finally {
    fs.writeFileSync(BASELINE, raw);
  }
});

test("豁免面：ui/ 基础件自身的 <input 合法（ui/input.tsx 不入扫描）", () => {
  const r = runGate();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /ui\/input\.tsx/);
});
