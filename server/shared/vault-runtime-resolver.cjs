// Component: Vault-Runtime-Script-Resolver — 运行时脚本解析的唯一事实源（PR-016 方案甲）。
// @responsible: 单点解析「cheeseh 运行时所需的数据仓脚本路径」；全库禁止在调用点各自拼接
//   vault 脚本路径（ADR-002 同族纪律，先例：shared/python-path.cjs）。
// @inputs: 环境变量 VAULT_RUNTIME_SCRIPTS_DIR（显式指定，CI/测试用）
// @outputs: resolveVaultRuntimeScript(name) → string
//
// 单源语义（2026-10-13 SPEC-011 §三·附 收窄，原 PR-016 双轨撤轨）：
//   server 消费仓内 scripts/vault-runtime/<name>（dev 源码——含未提交改动，开发回路即时生效）；
//   vault 侧 B/C 脚本经 symlink 消费 cheeseh-runtime worktree（验收快照）。两侧物理同源（同一
//   git 仓），时点差异即「源码 vs 构建产物」分层，与 dev/Docker 产物分层同构。
//   原「vault 兜底轨」删除：vault 侧 A 类已全部 symlink 化，兜底解析到的就是 worktree 内容，
//   死代码；若仓内缺文件按「脚本不存在」语义报错（503 通道）。
// 调用方（2026-10-13）：article-draft-workflow.cjs（validate/promote-article.py）、
//   pipeline-run-service.cjs（pipeline-runner.py）。新增调用点必须在本清单同步登记。
const path = require("path");

const RUNTIME_DIR = path.resolve(__dirname, "..", "vault-runtime");

function resolveVaultRuntimeScript(name) {
  if (process.env.VAULT_RUNTIME_SCRIPTS_DIR) {
    return path.join(process.env.VAULT_RUNTIME_SCRIPTS_DIR, name);
  }
  return path.join(RUNTIME_DIR, name);
}

module.exports = { resolveVaultRuntimeScript, RUNTIME_DIR };
