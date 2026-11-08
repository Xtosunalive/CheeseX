// Component: Theschema-Root（SPEC-023 波 1）
// @responsible: TheSchema 目录唯一解析点——优先级：THESCHEMA_DIR 环境注入（硬钉：设即生效，
//   缺文件由消费方 existsSync 自然降级＝裸库测试语义保持）＞ vault 侧 知识库/TheSchema（迁移
//   窗口主源——存在即用，行为与迁移前完全一致）＞ 仓内 data/theschema（切换后主源）。
//   切换原子性＝vault 副本移走的一瞬全体消费方翻向仓内；回滚＝移回。
//   ⚠ 本文件内不得引用 resolveTheSchemaDir（自指）——路径在此字面拼装。
const fs = require("node:fs");
const path = require("node:path");

const REPO_THESCHEMA = path.resolve(__dirname, "..", "..", "data", "theschema");

// 测试隔离注入口（PR-158 仓内回落档沙箱）：data/theschema 是活库运行态载体（SPEC-023 git 边界=数据边界，
// 常驻服务的 released 版本/挂载身份/依赖引用随用随长）——测试断言「仓内回落」语义时钉扎本变量
// 指向 test/fixtures/theschema-baseline（洁净基线），不得消费活库磁盘态（前科：活态 released+快照
// 指针使打包器索要库外工件，8 处测试假红）。生产路径不设本变量，行为不变。
function repoTheschemaRoot() {
  const injected = process.env.THESCHEMA_REPO_FALLBACK_DIR;
  return injected ? path.resolve(injected) : REPO_THESCHEMA;
}

function resolveTheSchemaDir(vaultPath) {
  const injected = process.env.THESCHEMA_DIR;
  if (injected) return injected;
  if (vaultPath === undefined || vaultPath === null) {
    // 装配缺陷不得静默跨领土回落（seq180 回归面）：vaultPath 缺失＝调用方接线断了——大声失败
    throw new TypeError("THESCHEMA_ROOT_UNRESOLVED: vaultPath 缺失（装配缺陷）——resolver 拒绝静默回落仓内副本");
  }
  {
    const vaultSide = path.join(vaultPath, "知识库", "TheSchema");
    if (fs.existsSync(path.join(vaultSide, "enums.yaml"))) return vaultSide;
  }
  return repoTheschemaRoot();
}


/** 展示位真话（迁仓后标签对齐，2026-10-26）：按 resolver 实际解析结果返回可读路径——
 * repo 副本→data/theschema/<name>；vault 侧→知识库/TheSchema/<name>；注入目录→绝对路径。
 * 替代散布各处的硬编码「知识库/TheSchema/…」标签（迁仓后实际读 repo，标签一直在撒谎）。 */
function displayTheSchemaPath(vaultPath, basename) {
  const dir = resolveTheSchemaDir(vaultPath);
  if (dir === repoTheschemaRoot()) return `data/theschema/${basename}`;
  if (path.basename(dir) === "TheSchema") return `知识库/TheSchema/${basename}`;
  return path.join(dir, basename);
}

module.exports = { resolveTheSchemaDir, displayTheSchemaPath, REPO_THESCHEMA, repoTheschemaRoot };
