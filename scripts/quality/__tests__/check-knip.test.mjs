// check-knip 守护测试（WP-126 T1）：棘轮核心为纯函数（合成输入直调）＋真仓实跑烟测。
// 覆盖：归一化各 issue 类型、新增红、清偿提示、真仓基线绿。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { flattenIssues, reconcileBaseline } from "../check-knip.mjs";

test("flattenIssues：exports/types/files/dependencies/devDependencies 归一为稳定指纹", () => {
  const s = flattenIssues([
    {
      file: "a.ts",
      exports: [{ name: "foo", line: 1 }],
      types: [{ name: "T", line: 2 }],
      files: [{ name: "b.cjs" }],
      dependencies: [{ name: "left-pad" }],
      devDependencies: [{ name: "old-tool" }],
    },
  ]);
  assert.deepEqual(
    [...s].sort(),
    ["dependency|a.ts|left-pad", "export|a.ts|foo", "file|b.cjs|", "devDependency|a.ts|old-tool", "type|a.ts|T"].sort(),
  );
});

test("棘轮：基线外新增＝红；基线内清偿＝提示缩减不拦", () => {
  const base = new Set(["export|a.ts|foo"]);
  const { news, gones } = reconcileBaseline(new Set(["export|a.ts|foo", "export|a.ts|bar"]), base);
  assert.deepEqual(news, ["export|a.ts|bar"]);
  assert.deepEqual(gones, []);
  const { news: n2, gones: g2 } = reconcileBaseline(new Set([]), base);
  assert.equal(n2.length, 0);
  assert.deepEqual(g2, ["export|a.ts|foo"]);
});

test("真仓实跑：门禁绿且基线棘轮零新增", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const out = execFileSync("node", [path.join(ROOT, "scripts", "quality", "check-knip.mjs")], { encoding: "utf8" });
  assert.match(out, /knip_gate=ok baseline=\d+ current=\d+/);
});
