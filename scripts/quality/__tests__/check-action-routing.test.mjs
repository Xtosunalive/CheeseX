#!/usr/bin/env node
// Component: check-action-routing 的门禁回归测试（WP-177 第六面：状态×操作前置表对账）
// @responsible: 钉住前置表对账的执法活性——基线绿；前端镜像多状态/缺状态/整表缺失三探针各自必红。
// 运行：node --test scripts/quality/__tests__/check-action-routing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-action-routing.mjs");
const REGISTRY = path.resolve(__dirname, "..", "..", "..", "src", "features", "anomaly-workbench", "anomaly-action-registry.ts");

function runGate() {
  try {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

/** 就地变异 registry 镜像表跑门禁，finally 无条件还原（探针不留痕） */
function withRegistry(mutate, fn) {
  const orig = fs.readFileSync(REGISTRY, "utf-8");
  fs.writeFileSync(REGISTRY, mutate(orig));
  try {
    return fn(runGate());
  } finally {
    fs.writeFileSync(REGISTRY, orig);
  }
}

test("基线自举：前置表对账绿（前端镜像↔后端单源逐项相等）", () => {
  const r = runGate();
  assert.equal(r.code, 0, `基线应 ok，实际：${r.out.slice(0, 300)}`);
  assert.match(r.out, /action_routing=ok/);
});

test("反例①：前端镜像多出一个状态 → [前置表] 漂移红", () => {
  withRegistry((s) => s.replace('confirm: ["previewed"]', 'confirm: ["previewed", "open"]'), (r) => {
    assert.notEqual(r.code, 0);
    assert.match(r.out, /\[前置表\] 操作 "confirm" 状态集漂移：前端多出 \[open\]/);
  });
});

test("反例②：前端镜像缺状态（后端多出）→ 红", () => {
  withRegistry((s) => s.replace('preview: ["open", "stale", "blocked", "previewed"]', 'preview: ["open", "stale"]'), (r) => {
    assert.notEqual(r.code, 0);
    assert.match(r.out, /\[前置表\] 操作 "preview" 状态集漂移：后端多出 \[blocked,previewed\]/);
  });
});

test("反例③：前端镜像整表缺失 → 结构红（锚点找不到/缺声明）", () => {
  withRegistry((s) => s.replace(/const OPERATION_PRECONDITIONS[\s\S]*?\n\};/, "const OPERATION_PRECONDITIONS_LEGACY = {};"), (r) => {
    assert.notEqual(r.code, 0);
    assert.match(r.out, /\[前置表\]/);
  });
});
