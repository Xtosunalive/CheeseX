/**
 * changed-files.mjs — 提交改动文件清单解析（emit-commit-event / backfill-commit-events 共用单源）。
 *
 * 输入：`git show --pretty=format: --name-status <sha>` 的输出行（已 trim、已过滤空行）。
 * 输出：用于 owner 归属与 cls 分级的仓库相对路径数组。
 *
 * 口径：
 * - A/M/T 等单路径状态：取该路径。
 * - R<n>/C<n>（重命名/复制，`R100\told\tnew` 形态）：取新路径，旧路径不重复记。
 * - D（删除）：计入。owner 归属按路径前缀匹配 OWNER_ZONE_PREFIXES，不读文件内容，
 *   被删路径同样可归属。此前两份副本各自 `if (st.startsWith("D")) continue` 跳过删除，
 *   后果实测（2026-10-26）：混合提交的删除部分静默消失（4a209d89 删 server/ 文件，
 *   server-api-engineer 零入账）；纯删除提交落兜底分支，错记为 team-lead / docs/ / files=[]。
 */
export function parseNameStatus(lines) {
  const files = [];
  for (const raw of lines) {
    const parts = String(raw).split("\t");
    const f = parts[parts.length - 1];
    if (!f) continue;
    files.push(f);
  }
  return files;
}
