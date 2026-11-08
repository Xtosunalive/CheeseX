#!/usr/bin/env bash
// 用法: scripts/review/ai-pr-review.mjs [--base <ref>] [--head <ref>] [--out <file>] [--dry-run]
//   WP-157：AI PR 评审执行器（判官自动化预备件——AGENTS §七 规则的可执行载体）。
//   现状（私有仓/CI 停摆 PR-283）：不自动运行；公开后接线方式见 .github/workflows/ai-review.yml
//   （仓库变量 AI_REVIEW_ENABLED=true 即启用，无需改 workflow）。
//   模型：DeepSeek 兼容 API（env: DEEPSEEK_API_KEY，缺省 base url DeepSeek 官方；可覆盖 AI_REVIEW_BASE_URL）。
//   fail-open：模型不可达/超时/缺 key → 报告"评审未执行（原因）"exit 0——评审缺失可感知（输出明示），不拦合并。
//   判据：AGENTS.md「AI 代码评审规则」节全文作为系统规则喂入（规则单源，不在本脚本复制）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(arg("--root", process.cwd()));
const BASE = arg("--base", "origin/main");
const HEAD = arg("--head", "HEAD");
const OUT = arg("--out", null);
const DRY = args.includes("--dry-run");

function git(...a) {
  return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}
// ① 拿 diff（PR 面＝base 三点 head；本地自查＝base..head）
let diff;
try {
  diff = git("diff", `${BASE}...${HEAD}`, "--");
} catch {
  diff = git("diff", `${BASE}..${HEAD}`, "--");
}
if (!diff.trim()) {
  console.log("ai_review=skip (空 diff)");
  process.exit(0);
}
// ② 规则单源：AGENTS §七 原文
const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf-8");
const m = agents.match(/## 七、AI 代码评审规则[\s\S]*?(?=\n## |\n*$)/);
if (!m) { console.log("ai_review=FAIL AGENTS.md 缺「AI 代码评审规则」节（规则单源缺失）"); process.exit(1); }
const rules = m[0];
// ③ 组 prompt（规则全文＋diff 截断 64k）
const prompt = `${rules}\n\n---\n以下是待评审的代码变更 diff。按上述规则输出评审结论：\n` +
  `首行输出 "P1: <数量>" 或 "P2 only" 或 "CLEAN"；随后逐条列出 P1/P2 发现（每条：file:line、问题、为什么属于该级）；无发现则只输出 CLEAN。不要输出其他内容。\n\n${diff.slice(0, 64000)}`;
// ④ 调模型（fail-open）
if (DRY || !process.env.DEEPSEEK_API_KEY) {
  const reason = DRY ? "--dry-run" : "DEEPSEEK_API_KEY 未设置";
  console.log(`ai_review=skip (评审未执行：${reason})`);
  if (OUT) fs.writeFileSync(OUT, `# AI 评审报告\n\n未执行：${reason}\n\n## Prompt 预览（供人工评审替代使用）\n\n${prompt.slice(0, 2000)}\n`);
  process.exit(0);
}
const base = process.env.AI_REVIEW_BASE_URL || "https://api.deepseek.com";
const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
  body: JSON.stringify({
    model: process.env.AI_REVIEW_MODEL || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
  }),
}).catch((e) => ({ error: e }));
if (res.error || !res.ok) {
  console.log(`ai_review=skip (评审未执行：模型调用失败 ${res.error ? String(res.error).slice(0, 120) : res.status})`);
  process.exit(0);
}
const body = await res.json();
const findings = body.choices?.[0]?.message?.content || "(空响应)";
const report = `# AI 评审报告（base=${BASE} head=${HEAD}）\n\n${findings}\n`;
if (OUT) fs.writeFileSync(OUT, report);
console.log(report.split("\n")[0]);
if (findings.startsWith("P1")) {
  console.log(report.split("\n").slice(1, 12).join("\n"));
  process.exit(2); // P1 存在：CI 面可据此红（本地调用仅报告）
}
console.log("ai_review=ok 无 P1");
