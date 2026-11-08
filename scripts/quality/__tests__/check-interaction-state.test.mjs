#!/usr/bin/env node
// Component: check-interaction-state 的门禁回归测试（第二落地批，2026-10-21）
// @responsible: 钉住三检查面活性——基线绿；裸 loading、同前缀配对、本地五态字面量三探针各自必红；孤立 busy 布尔不误伤。
// 运行：node --test scripts/quality/__tests__/check-interaction-state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "check-interaction-state.mjs");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PROBE = path.join(ROOT, "src", "features", "dashboard", "__state_probe__-store.ts");

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

const HEAD = 'import { create } from "zustand";\n';

test("基线自举：当前仓 19 个 zustand store 零布尔配对", () => {
  const r = runGate();
  assert.equal(r.code, 0, r.out.slice(0, 300));
  assert.match(r.out, /interaction_state=ok .*boolean_pairs=0/);
});

test("反例①：store 声明 loading: boolean → 红", () => {
  withProbe(`${HEAD}type S = { loading: boolean; error: string | null };\nexport const useProbe = create<S>(() => ({ loading: false, error: null }));\n`, (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[布尔旗标\].*__state_probe__/);
  });
});

test("反例②：同前缀 fooLoading + fooError 配对 → 红", () => {
  withProbe(`${HEAD}type S = { fooLoading: boolean; fooError: string | null };\nexport const useProbe = create<S>(() => ({ fooLoading: false, fooError: null }));\n`, (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[配对旗标\].*fooLoading \+ fooError/);
  });
});

test("反例③：store 内另写五态字面量 → 红（必须从 request-status 导入）", () => {
  withProbe(`${HEAD}type Local = "idle" | "loading" | "success" | "empty" | "error";\ntype S = { status: Local; error: string | null };\nexport const useProbe = create<S>(() => ({ status: "idle", error: null }));\n`, (red) => {
    assert.notEqual(red.code, 0);
    assert.match(red.out, /\[本地枚举\].*__state_probe__/);
  });
});

test("不误伤：孤立 busy 布尔（无同前缀 error 位）合法", () => {
  withProbe(`${HEAD}import type { RequestStatus } from "@/lib/request-status";\ntype S = { status: RequestStatus; error: string | null; fieldOptionsLoading: boolean };\nexport const useProbe = create<S>(() => ({ status: "idle", error: null, fieldOptionsLoading: false }));\n`, (r) => {
    assert.equal(r.code, 0, r.out);
  });
});
