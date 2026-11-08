// Component: Repo-File-IO
// @responsible: repo 侧维护文件的原子写小工具（SPEC-012 WP-I）——服务本仓 contracts/*.json 等
//   repo 文件的维护写。与 vault-io（vault 数据唯一写通道）分辖：vault 写走 vault-io，
//   repo 维护写走本模块；两者均不越界（vault 通道写 repo 路径会被 F1 目的地执法拦）。
// @inputs: absPath/content（utf8 字符串）
// @outputs: writeRepoFileAtomic(absPath, content)——原子落盘，失败抛原始错误
// @context: rules-lifecycle-service（contracts 契约/索引/映射写回）
//
// 原子性：tmp(O_EXCL 独占创建)→write→rename——进程中断不留半截文件
// （与 vault-io.atomicWrite 同款形状；tmp 命名带本模块前缀以便排障归属）。

const crypto = require("node:crypto");
const fs = require("node:fs");

function writeRepoFileAtomic(absPath, content) {
  const tmpPath = absPath + ".repo-io-" + process.pid + "-" + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tmpPath, absPath);
  } catch (error) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best-effort：tmp 清理失败不掩盖原错误 */ }
    throw error;
  }
}

/** 独占创建＋只读封存（release-builder 发布物形态）：wx 确保不覆盖既有件，0444 封存。 */
function writeExclusiveSealed(absPath, content) {
  fs.writeFileSync(absPath, content, { flag: "wx", mode: 0o444 });
}

/** 原子搬移（文件/目录通用 rename——目录级原子发布先例 release-builder）。 */
function moveAtomic(src, dest) {
  fs.renameSync(src, dest);
}

/** 字节保真复制（快照先例 rules-lifecycle）。 */
function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

module.exports = { writeRepoFileAtomic, writeExclusiveSealed, moveAtomic, copyFile };
