/**
 * Component: Dev-Log-Commit-Classify（提交分级判据单源）
 * @responsible: 把「一次提交属 W3／W4／W5 哪一级」的判定收在一处——钩子（emit-commit-event）与补账器
 *   （backfill-commit-events）共用同一函数，不再各写一份（PR-198：此前两处内联同名实现，
 *   而补账器头注自称「与钩子完全同源」，规则一改就会分叉）。
 * @inputs: { files: string[]（本提交触及路径）, topDirs: Set<string>（顶层目录集） }
 * @outputs: "W3" | "W4" | "W5"
 * @context: 判据是 AGENTS 任务分级路由表 W5 行的机器可判定子集；语义改动只改本文件。
 */

export function classifyCommit({ files, topDirs }) {
  // W5：契约/依赖/跨域特征（AGENTS 任务分级路由表 W5 行的机器可判定子集）
  if (files.some((f) => f.startsWith("contracts/")) || files.includes("package.json")) return "W5";
  if (files.length >= 5 || topDirs.size >= 3) return "W5";
  // W3：纯 docs/ 改动（无代码）
  if (files.length > 0 && files.every((f) => f.startsWith("docs/") || f.endsWith(".md"))) return "W3";
  return "W4";
}
