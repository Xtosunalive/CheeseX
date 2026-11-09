// WP-159 面⑤破坏实验＋既有三断言固化（固回归口径：载体=普通测试——WP-143 波5）。
// 层级标注：真实集成（真 git 暂存面＋真钩子脚本执行）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GATE = path.join(REPO, "scripts/quality/workflow-gates.mjs");
const sh = (cwd, ...a) => execFileSync(a[0], a.slice(1), { cwd, encoding: "utf-8" });

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-gates-"));
  fs.mkdirSync(path.join(dir, ".githooks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "contracts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/components/ui"), { recursive: true });
  for (const d of ["docs/plans", "docs/design", "src/components/ui", "contracts"]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  const src = path.resolve(REPO, "scripts/quality/workflow-gates.mjs");
  if (!fs.existsSync(src)) throw new Error("probe: REPO=" + REPO + " src=" + src);
  fs.copyFileSync(src, path.join(dir, "workflow-gates.mjs"));
  // 域表夹具：一域（ui-kit）authority＋writers 全路径受管
  fs.writeFileSync(path.join(dir, "contracts/reuse-domains.json"), JSON.stringify({
    registry_version: 3,
    domains: [{ id: "ui-kit", name: "UI 基座", status: "gating",
      authority: "src/components/ui",
      contract: "docs/design/ui-kit.md",
      writers: ["src/components/ui/", "src/styles/table-preset.css"],
      register_entry: "docs/plans/problem-register.md#PR-1" }],
  }));
  fs.mkdirSync(path.join(dir, "docs/design"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/design/ui-kit.md"), "契约\n");
  fs.writeFileSync(path.join(dir, "docs/plans/problem-register.md"), "# 登记簿\n## PR-1\n");
  fs.writeFileSync(path.join(dir, "docs/other.md"), "无关文件\n");
  sh(dir, "git", "init", "-qb", "main");
  sh(dir, "git", "-C", dir, "config", "user.email", "t@t");
  sh(dir, "git", "-C", dir, "config", "user.name", "t");
  sh(dir, "git", "-C", dir, "add", "-A");
  sh(dir, "git", "-C", dir, "commit", "-qm", "init");
  return dir;
}
const runGate = (dir) => {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, "workflow-gates.mjs")], { cwd: dir, encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};
const stage = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
  sh(dir, "git", "-C", dir, "add", rel);
};

test("破坏实验（红）：改 writers 受管文件而域表未沉淀 → 红点名域行", () => {
  const dir = makeRepo();
  stage(dir, "src/components/ui/probe.tsx", "export const p = 1;\n");
  const r = runGate(dir);
  assert.equal(r.code, 1, `期望红，实得:\n${r.out}`);
  assert.match(r.out, /\[受管沉淀闸\]/);
  assert.match(r.out, /ui-kit/);
});

test("同批变更域表 → 绿（沉淀随批）", () => {
  const dir = makeRepo();
  stage(dir, "src/components/ui/probe.tsx", "export const p = 1;\n");
  const t = JSON.parse(fs.readFileSync(path.join(dir, "contracts/reuse-domains.json")));
  t.domains[0].note = "WP-probe 沉淀：probe.tsx 基座用法在册";
  stage(dir, "contracts/reuse-domains.json", JSON.stringify(t, null, 2));
  stage(dir, "docs/work-packages/WP-901.json", JSON.stringify({ package_id: "WP-901" })); // 甲' 合同闸：写任务同批带合同
  const r = runGate(dir);
  assert.equal(r.code, 0, `期望绿，实得:\n${r.out}`);
});

test("无关卡径：非受管路径变更 → 不触发", () => {
  const dir = makeRepo();
  stage(dir, "docs/other.md", "无关改动\n");
  const r = runGate(dir);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /受管沉淀闸/);
});

test("authority 路径同样受管（粒度A：authority＋writers 并重）", () => {
  const dir = makeRepo();
  stage(dir, "src/components/ui/probe.tsx", "x");          // writers 命中
  const r1 = runGate(dir);
  assert.match(r1.out, /受管沉淀闸/);
  sh(dir, "git", "-C", dir, "reset", "-q");
  fs.writeFileSync(path.join(dir, "docs/design/ui-kit.md"), "契约改\n"); // authority(契约) 命中
  sh(dir, "git", "-C", dir, "add", "-A");
  const r2 = runGate(dir);
  assert.match(r2.out, /受管沉淀闸/, "authority/contract 路径变更同样须沉淀");
});

// ── 双仓形态：治理件外挂到私有 kit 仓 ──
// makeRepo 造的是 in-repo（docs 真实目录＝主仓形态）。下面把 docs 移出仓再按形态重建：
// external＝符号链接指向别处的 kit；absent＝不重建（全新克隆／CI）；broken＝链接目标缺失。
function withGovernancePosture(dir, mode) {
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), "wf-docs-"));
  fs.renameSync(path.join(dir, "docs"), path.join(holder, "docs"));
  if (mode === "external") fs.symlinkSync(path.join(holder, "docs"), path.join(dir, "docs"), "dir");
  if (mode === "broken") fs.symlinkSync(path.join(holder, "missing-kit"), path.join(dir, "docs"), "dir");
}

test("in-repo 形态（主仓）：改 src 无同批合同 → 合同闸照旧红，纪律未削弱", () => {
  const dir = makeRepo();
  stage(dir, "src/lib/probe.ts", "export const p = 1;\n");
  const r = runGate(dir);
  assert.equal(r.code, 1, `期望红，实得:\n${r.out}`);
  assert.match(r.out, /\[合同闸\]/);
  assert.doesNotMatch(r.out, /\[合同闸\] 移交/);
});

test("external 形态（治理 kit 外挂）：改 src 无合同 → 显式移交后放行，不静默", () => {
  const dir = makeRepo();
  withGovernancePosture(dir, "external");
  stage(dir, "src/lib/probe.ts", "export const p = 1;\n"); // 非受管路径，单独验合同闸
  const r = runGate(dir);
  assert.equal(r.code, 0, `期望绿，实得:\n${r.out}`);
  assert.match(r.out, /\[治理层姿态\]/);
  assert.match(r.out, /\[合同闸\] 移交/);
  assert.match(r.out, /gov:sync/);
});

test("absent 形态（全新克隆／CI）：改 src 无合同 → 同样移交而非不可能满足的假红", () => {
  const dir = makeRepo();
  withGovernancePosture(dir, "absent");
  stage(dir, "src/lib/probe.ts", "export const p = 1;\n");
  const r = runGate(dir);
  assert.equal(r.code, 0, `期望绿，实得:\n${r.out}`);
  assert.match(r.out, /docs 挂载点不存在/);
  assert.match(r.out, /\[合同闸\] 移交/);
});

test("broken 形态（半挂载断链）：fail-closed 拦提交", () => {
  const dir = makeRepo();
  withGovernancePosture(dir, "broken");
  stage(dir, "src/lib/probe.ts", "export const p = 1;\n");
  const r = runGate(dir);
  assert.equal(r.code, 1, `期望红，实得:\n${r.out}`);
  assert.match(r.out, /挂载断链/);
});

test("external 形态：受管沉淀闸仍执法（只移交合同／对账两闸，不放行其余门禁）", () => {
  const dir = makeRepo();
  withGovernancePosture(dir, "external");
  stage(dir, "src/components/ui/probe.tsx", "export const p = 1;\n");
  const r = runGate(dir);
  assert.equal(r.code, 1, `期望红，实得:\n${r.out}`);
  assert.match(r.out, /\[受管沉淀闸\]/);
});
