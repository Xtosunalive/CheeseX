#!/usr/bin/env node
// Component: check-schema-shape 的门禁回归测试（SCHEMA-IA-001 批16）
// @responsible: 钉住候选单源执法活性——基线绿；候选键外泄两探针（表达式值/变量值）各自必红；
//   草稿字符串字面量与可选类型键不误伤。
// 运行：node --test scripts/quality/__tests__/check-schema-shape.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-schema-shape.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PROBE = path.join(ROOT, "src", "features", "entity-compliance", "__shape_probe__.tsx");

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

test("基线自举：收编后业务代码零候选键外泄", () => {
  const r = runGate();
  assert.equal(r.code, 0, r.out.slice(0, 300));
  assert.match(r.out, /schema_shape=ok files=\d+ candidate_sites=0/);
});

test("反例①：表达式拍平 arch_layer: flat(data.layers) → 红（批16 前合规页旧形态）", () => {
  withProbe('const flat = (v: unknown): string[] => [];\nconst options = { arch_layer: flat(data.layers) };\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[候选键外泄].*__shape_probe__.*entityFieldCandidates/);
  });
});

test("反例②：变量承接 arch_category: categories → 红（批16 前异常抽屉旧形态）", () => {
  withProbe('const categories: string[] = [];\nconst options = { arch_category: categories };\n', (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /__shape_probe__.*entityFieldCandidates/);
  });
});

test("不误伤①：草稿初值字符串字面量 arch_layer: \"\" 可直写（表单空态非候选推导）", () => {
  withProbe('const draft = { arch_layer: "", arch_category: "", arch_subdomain: "" };\n', (r) => {
    assert.equal(r.code, 0, r.out);
  });
});

test("不误伤②：可选类型键 arch_subdomain?: string[] 不命中（类型面可选键带 ?）", () => {
  withProbe('type Draft = { arch_subdomain?: string[] };\n', (r) => {
    assert.equal(r.code, 0, r.out);
  });
});
