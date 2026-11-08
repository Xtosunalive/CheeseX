// WP-142 红队复核 F3：基线计数单调门——contracts/eslint-suppressions.json 的总违例计数
// 相对 HEAD 只减不增（基线重造＝执法面修正，必须一次性显式落账，禁止把养大基线混进普通提交
// 静默通过）。文件不存在于 HEAD（worktree 首次落地场景）→ 明示 skip，首提之后下一轮起生效。
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const baselinePath = "contracts/eslint-suppressions.json";

function totalSuppressed(jsonText) {
  const doc = JSON.parse(jsonText);
  const entries = doc.suppressions ?? doc; // 兼容带/不带 suppressions 包装两种 eslint 形态
  return Object.values(entries).reduce((sum, rules) =>
    sum + Object.values(rules).reduce((s, v) => s + v.count, 0), 0);
}

let prev;
try {
  prev = totalSuppressed(execFileSync("git", ["show", `HEAD:${baselinePath}`], { cwd: repoRoot, encoding: "utf8" }));
} catch (err) {
  if (/does not exist|exists on disk, but not in/.test(String(err.stderr ?? err.message))) {
    console.log(`suppressions_monotonic=skip（HEAD 无 ${baselinePath}——worktree 首次落地场景，首提提交后下一轮起生效）`);
    process.exit(0);
  }
  throw err; // git 本身故障不得伪装成 skip（fail-closed）
}
const cur = totalSuppressed(readFileSync(new URL(`../../${baselinePath}`, import.meta.url), "utf8"));
if (cur > prev) {
  // 逃生口（红队A F1 联动）：执法面变更（eslint.config.js 同批暂存）引发的合法抬闸才放行——
  // 选择器修正是计数上升的唯一合法来源；纯数据养大（不动执法面）照拦。放行时大声宣读，
  // 抬闸事实留在本提交 diff 里可审（静默攻击若伪装改 config，diff 同时可见两处，评审注意力被强制拉到）。
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--", "eslint.config.js"], { cwd: repoRoot, encoding: "utf8" }).trim();
  if (staged) {
    console.log(`suppressions_monotonic=raise-allowed prev=${prev} cur=${cur}（执法面 eslint.config.js 同批变更——合法抬闸，F1 型一次性重造；抬闸依据见本提交信息）`);
    process.exit(0);
  }
  console.error(`suppressions_monotonic=FAIL prev=${prev} cur=${cur}（基线计数单调上升且执法面未变更——静默养大；合法抬闸须伴随 eslint.config.js 同批变更并在提交信息写明依据）`);
  process.exit(1);
}
console.log(`suppressions_monotonic=ok prev=${prev} cur=${cur}`);
