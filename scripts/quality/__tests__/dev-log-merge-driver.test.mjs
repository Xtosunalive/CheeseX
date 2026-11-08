// @tests: scripts/quality/dev-log-merge-driver.mjs——追加式台账合并驱动（WP-004；场景＝WP-001 合并实测的 279 撞号）。
// 层级：纯单元（临时三文件 %O %A %B 夹具）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const DRIVER = path.join(ROOT, "scripts/quality/dev-log-merge-driver.mjs");
const mk = (dir, name, rows) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
};

test("并集＋两侧同事件去重＋按 ts 排序＋seq 撞号重编（279×2 实测场景）", () => {
  const dir = fs.mkdtempSync(path.join(import.meta.dirname, "tmp-driver-"));
  try {
    const base = mk(dir, "base", [{ seq: 277, ts: "T1", e: "old1" }, { seq: 278, ts: "T2", e: "old2" }]);
    const ours = mk(dir, "ours", [
      { seq: 277, ts: "T1", e: "old1" }, { seq: 278, ts: "T2", e: "old2" },
      { seq: 279, ts: "T3", e: "ours-new", cmd: "git:commit MAINX" },
    ]);
    const theirs = mk(dir, "theirs", [
      { seq: 277, ts: "T1", e: "old1" }, { seq: 278, ts: "T2", e: "old2" },
      { seq: 279, ts: "T4", e: "theirs-new", cmd: "git:commit BRANCHY" },
      { seq: 280, ts: "T5", e: "theirs-new2" },
    ]);
    execFileSync("node", [DRIVER, base, ours, theirs], { stdio: "pipe" });
    const merged = fs.readFileSync(ours, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(merged.length, 5, "old×2＋双侧新×3（theirs-new2 也在）");
    const seqs = merged.map((m) => m.seq);
    assert.equal(new Set(seqs).size, seqs.length, "seq 无重复");
    assert.deepEqual(merged.map((m) => m.e), ["old1", "old2", "ours-new", "theirs-new", "theirs-new2"], "按 ts 排序");
    assert.equal(seqs[2], 279, "T3 先到保 279");
    assert.equal(seqs[3], 281, "撞号的 T4 顺延至 281（280 已被 T5 占用）");
    assert.equal(seqs[4], 280, "T5 原号无冲突保 280（重编只动撞号后到者；seq 与 ts 单调性不保证，唯一性才是账本约束）");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("两侧相同新增事件去重（钩子幂等重放场景）", () => {
  const dir = fs.mkdtempSync(path.join(import.meta.dirname, "tmp-driver2-"));
  try {
    const base = mk(dir, "base", [{ seq: 1, ts: "T0", e: "old" }]);
    const same = { seq: 2, ts: "T1", e: "dup", cmd: "git:commit X" };
    const ours = mk(dir, "ours", [{ seq: 1, ts: "T0", e: "old" }, same]);
    const theirs = mk(dir, "theirs", [{ seq: 1, ts: "T0", e: "old" }, same, { seq: 3, ts: "T2", e: "only-theirs" }]);
    execFileSync("node", [DRIVER, base, ours, theirs], { stdio: "pipe" });
    const merged = fs.readFileSync(ours, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(merged.map((m) => m.e), ["old", "dup", "only-theirs"], "同事件只留一条");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
