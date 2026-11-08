// Shared governance utilities — 治理脚本共享模块（规则 8 配置单源化执行层）
// @responsible: 收敛跨 checker 重复定义（COMMIT_PATTERN / fileOwnedBy / resolveRoot），
//   使同一事实只有一份定义。自源库（架构图系统-rebuild）同名文件裁剪搬运：
//   仅保留 dev-log 校验链当前消费的四个导出，未消费的 git/登记面工具不随迁。
// @context: Sync

import { realpathSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// commit 完整 SHA 正则（唯一定义，防两处漂移；当前无消费方，保留契约形状）
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

// 解析仓库根：优先 --root 参数（隔离测试用），否则以调用方模块位置向上推导
// callerURL 应传 import.meta.url（调用方在 scripts/quality/ 下，向上两级到仓库根）
export function resolveRoot(argv = process.argv.slice(2), callerURL = import.meta.url) {
  const idx = argv.indexOf("--root");
  if (idx >= 0 && argv[idx + 1]) return path.resolve(argv[idx + 1]);
  return path.resolve(path.dirname(fileURLToPath(callerURL)), "../..");
}

// 切片 manifest 文件归属判定（唯一定义；dev-log 的 owner 越界检查复用）
export function fileOwnedBy(manifest, file) {
  return (manifest.allowedFiles || []).some((allowed) => {
    if (allowed.endsWith("/**")) return file.startsWith(allowed.slice(0, -2));
    return allowed === file;
  });
}

// 安全读取 JSON（唯一定义）
export function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// CLI 入口判定（唯一定义，供各 checker 的 isMain 引导块复用）
export function isMainModule(importMetaUrl) {
  // seq166：realpath 双侧归一——resolve() 不解析符号链接，node 对 symlink 入口的
  // import.meta.url 已是 realpath，argv[1] 却是调用路径 → 判假 → main() 静默不执行。
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
