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

// ── PR-324①/WP-182：解析器注释免疫——红队回件三假红闭合＋漏报闭合 ──

/** 就地变异后端服务文件跑门禁，finally 无条件还原 */
function withService(mutate, fn) {
  const SERVICE = path.resolve(__dirname, "..", "..", "..", "server", "services", "anomaly", "anomaly-workbench-service.cjs");
  const orig = fs.readFileSync(SERVICE, "utf-8");
  fs.writeFileSync(SERVICE, mutate(orig));
  try {
    const out = execFileSync("node", [path.resolve(__dirname, "..", "check-action-routing.mjs")], { encoding: "utf8" });
    return fn({ code: 0, out });
  } catch (e) {
    return fn({ code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") });
  } finally {
    fs.writeFileSync(SERVICE, orig);
  }
}

test("PR-324① 假红闭合：镜像表注释行不再被当真条目（红队探针 D）", () => {
  withRegistry((s) => s.replace('confirm: ["previewed"]', 'confirm: ["previewed"]\n  // reject: ["pending"]'), (r) => {
    assert.equal(r.code, 0, `注释行不得产生假红：${r.out.slice(0, 300)}`);
  });
});

test("PR-324① 假红闭合：行内注释含条目不覆盖真值（红队探针 E）", () => {
  withRegistry((s) => s.replace('confirm: ["previewed"]', 'confirm: ["previewed"], // preview: ["open"]'), (r) => {
    assert.equal(r.code, 0, `行内注释不得覆盖真条目：${r.out.slice(0, 300)}`);
  });
});

test("PR-324① 假红闭合：注释含 } 不截断表体（红队探针 H）", () => {
  withRegistry((s) => s.replace('const OPERATION_PRECONDITIONS', '// 括号样例 } {}\nconst OPERATION_PRECONDITIONS'), (r) => {
    assert.equal(r.code, 0, `注释含 } 不得截断表体：${r.out.slice(0, 300)}`);
  });
});

test("PR-324① 漏报闭合：后端表注释停用 confirm → 对账红（fail-open 组合不再静默）", () => {
  withService((s) => s.replace('  confirm: ["previewed"],', '  // confirm: ["previewed"],'), (r) => {
    assert.notEqual(r.code, 0);
    assert.match(r.out, /\[前置表\] 操作 "confirm" 前端镜像声明但后端 OPERATION_PRECONDITIONS 无此操作/);
  });
});
