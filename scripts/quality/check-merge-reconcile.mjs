#!/usr/bin/env node
// check-merge-reconcile.mjs — 合并前对账机器断言（WP-012；AGENTS §五「登记簿合并对账」「写任务开树」两条款的
// 防线升级——PR-017 预留的「三方对比脚本」）。把人工对账的四件事变成命令：
//   ①拉远端对齐目标分支；②撞号检查（双方自 merge-base 各自新增的 PR/WP 编号不得相交）；
//   ③登记簿同条目双侧状态分叉检查（closed-wins：任一侧已关闭而另一侧非关闭且偏离基线 → 必须按关闭侧对账）；
//   ④取号节 max 报告（合并后期望值）。
// @responsible: quality-gate-engineer 辖区；合并前由任务树执行（npm run check:merge-reconcile）
// @inputs: --target <ref>（缺省 origin/main）--head <ref>（缺省 HEAD）--no-fetch --repo <路径> --json
// @outputs: `merge_reconcile=ok|FAIL ...`（--json 给结构化清单）；退出码 0=可合并，1=存在须人工对账项/对齐失败
// @context: 只读 git 与登记册；不写任何文件、不动工作区。执行时点＝合并 main 之前；合并后目标与 HEAD 合一，
//   theirs 集为空即自然 ok（幂等）。
import { execFileSync } from "node:child_process";
import process from "node:process";

const STATES = ["候选", "已立案", "根因确认", "修复中", "待验收", "已关闭", "reopened", "superseded"];

function parseArgs(argv) {
  const out = { target: "origin/main", head: "HEAD", fetch: true, json: false, repo: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") out.target = argv[++i];
    else if (argv[i] === "--head") out.head = argv[++i];
    else if (argv[i] === "--no-fetch") out.fetch = false;
    else if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--repo") out.repo = argv[++i];
    else if (argv[i] === "--help") out.help = true;
    else { console.error(`check-merge-reconcile: 未知参数 ${argv[i]}`); process.exit(2); }
  }
  return out;
}

function git(repo, args) {
  // 大登记簿超过子进程默认缓冲区；读取异常始终向上抛出，不能解释成文件缺席。
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

// 登记册解析：PR-NNN → 状态（取条目块内首个「- 状态：**X**」粗体词；无状态行＝候选形态前的残块）
export function parseRegister(text) {
  const lines = text.split("\n");
  const entries = new Map();
  let current = null;
  for (const line of lines) {
    const header = line.match(/^## (PR-\d+)\s/);
    if (header) { current = header[1]; entries.set(current, { state: null }); continue; }
    if (current) {
      const state = line.match(/^- 状态：\*\*([^*]+)/);
      if (state && !entries.get(current).state) entries.get(current).state = state[1].trim();
    }
  }
  return entries;
}

export function extractRegister(repo, ref) {
  const registerPath = "docs/plans/problem-register.md";
  // 旧提交可能早于登记簿建立；仅树查询成功且没有该路径时才视为空。
  const entry = git(repo, ["ls-tree", ref, "--", registerPath]);
  if (!entry) return new Map();
  if (!/^100(?:644|755) blob [0-9a-f]+\t/.test(entry)) {
    throw new Error(`${ref}:${registerPath} 类型错误：应为普通文件`);
  }
  return parseRegister(git(repo, ["show", `${ref}:${registerPath}`]));
}

export function extractWorkPackages(repo, ref) {
  const directory = "docs/work-packages";
  const entry = git(repo, ["ls-tree", ref, "--", directory]);
  if (!entry) return new Set();
  if (!/^040000 tree [0-9a-f]+\t/.test(entry)) {
    throw new Error(`${ref}:${directory} 类型错误：应为目录`);
  }
  const listing = git(repo, ["ls-tree", "--name-only", ref, `${directory}/`]);
  return new Set(listing.split("\n").map((l) => (l.match(/WP-\d+\.json$/) || [])[0]).filter(Boolean));
}

export function diffSets(baseSet, sideSet) {
  const has = (set, id) => (set instanceof Map ? set.has(id) : set.has(id));
  const ids = new Set([...(baseSet instanceof Map ? baseSet.keys() : baseSet), ...(sideSet instanceof Map ? sideSet.keys() : sideSet)]);
  const added = new Set();
  for (const id of ids) if (!has(baseSet, id) && has(sideSet, id)) added.add(id);
  return added;
}

export function reconcile({ base, target, head }) {
  const violations = [];
  const prNewTheirs = diffSets(base.pr, target.pr);
  const prNewOurs = diffSets(base.pr, head.pr);
  const wpNewTheirs = diffSets(base.wp, target.wp);
  const wpNewOurs = diffSets(base.wp, head.wp);
  for (const id of [...prNewTheirs].filter((x) => prNewOurs.has(x))) {
    violations.push(`撞号：PR-${id.slice(3)} 双方各自新开（对侧 ${target.sha.slice(0, 8)} 先占）——按 PR-017 closed-wins 远端/对侧保留原号，本侧重编（参考 max 见取号报告）`);
  }
  for (const id of [...wpNewTheirs].filter((x) => wpNewOurs.has(x))) {
    violations.push(`撞号：${id} 双方各自新开——对侧保留原号，本侧合同重编（分支名可不改，先例 task/wp-007/task/wp-008）`);
  }
  // closed-wins／状态分叉：同一既有条目双侧相对基线各走各路 → 必须人工按关闭侧对账（任一侧已关闭即按关闭侧；
  // 双侧均非关闭的状态分叉同样列出——合并即静默丢一侧，登记簿禁止）
  for (const [id, baseEntry] of base.pr) {
    const t = target.pr.get(id);
    const h = head.pr.get(id);
    if (!t || !h) continue;
    const tState = t.state || "候选";
    const hState = h.state || "候选";
    const bState = baseEntry.state || "候选";
    if (tState === hState) continue;
    if (tState !== bState && hState !== bState) {
      const winner = tState === "已关闭" ? `对侧（${tState}）` : hState === "已关闭" ? `本侧（${hState}）` : null;
      violations.push(winner
        ? `分叉：${id} 基线=${bState}，对侧=${tState}，本侧=${hState}——closed-wins：以${winner}为准，另一侧改动并入其历史（PR-017）`
        : `分叉：${id} 基线=${bState}，对侧=${tState}，本侧=${hState}——两侧非关闭态各改，合并须逐条对账后取并集，禁止静默取单侧`);
    }
  }
  const expectedMax = [...new Set([...head.pr.keys(), ...target.pr.keys()])]
    .map((id) => Number(id.slice(3))).reduce((a, b) => Math.max(a, b), 0);
  return { violations, prNewTheirs: [...prNewTheirs], prNewOurs: [...prNewOurs], wpNewTheirs: [...wpNewTheirs], wpNewOurs: [...wpNewOurs], expectedMax };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法：npm run check:merge-reconcile [-- --target origin/main --head HEAD --no-fetch --json]");
    return 0;
  }
  if (args.fetch) {
    try { git(args.repo, ["fetch", "origin", "--quiet"]); }
    catch { console.error("merge_reconcile=FAIL 对齐失败：git fetch origin 不可达——对账必须以远端为准（可用 --no-fetch 显式降级为本地引用对账）"); return 1; }
  }
  let targetSha; let headSha; let baseSha;
  try {
    targetSha = git(args.repo, ["rev-parse", "--verify", args.target]);
    headSha = git(args.repo, ["rev-parse", "--verify", args.head]);
    baseSha = git(args.repo, ["merge-base", headSha, targetSha]);
  } catch {
    console.error(`merge_reconcile=FAIL 引用解析失败：--target ${args.target} / --head ${args.head}`);
    return 1;
  }
  const load = (sha) => ({ pr: extractRegister(args.repo, sha), wp: extractWorkPackages(args.repo, sha), sha });
  let result;
  try {
    result = reconcile({ base: load(baseSha), target: load(targetSha), head: load(headSha) });
  } catch (error) {
    const violation = `登记簿或工作包读取失败：${error.message}`;
    if (args.json) console.log(JSON.stringify({ ok: false, violations: [violation] }, null, 2));
    else console.error(`merge_reconcile=FAIL ${violation}`);
    return 1;
  }
  const summary = `merge_reconcile=${result.violations.length ? "FAIL" : "ok"} base=${baseSha.slice(0, 8)} target=${targetSha.slice(0, 8)} head=${headSha.slice(0, 8)} pr_new_theirs=[${result.prNewTheirs}] pr_new_ours=[${result.prNewOurs}] wp_new_theirs=[${result.wpNewTheirs}] wp_new_ours=[${result.wpNewOurs}] 取号节期望 max=PR-${String(result.expectedMax).padStart(3, "0")}`;
  if (args.json) {
    console.log(JSON.stringify({ ok: result.violations.length === 0, ...result, base: baseSha, target: targetSha, head: headSha }, null, 2));
  } else {
    for (const v of result.violations) console.error(`✗ ${v}`);
    console.log(summary);
  }
  if (result.violations.length) {
    console.error("处置：先按上述逐条对账（撞号重编／closed-wins 取关闭侧），把对账结果落在合并提交信息（登记簿已对账），再合并；对账后重跑本命令应 ok。");
    return 1;
  }
  return 0;
}

if (process.argv[1] && (process.argv[1].endsWith("check-merge-reconcile.mjs"))) process.exit(main());
