// Component: Repo-Schema-IO（SPEC-023 波 3）
// @responsible: 仓内 TheSchema 数据文件的唯一写通道——temp+rename 原子写＋结构化日志。
//   语义分野（ADR-001 修订）：vault-io 管 vault（①⑤类落点＋vault 台账）；本通道管仓内
//   data/theschema/**（git 即账——运行时不自动提交，账由人/预提交钩子落）。
//   目的地执法：仅允许 data/theschema/ 前缀（越界 throw——与 vault-io 同纪律）。
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ALLOWED_PREFIX = path.join(ROOT, "data", "theschema") + path.sep;

function assertRepoSchemaDestination(absPath) {
  const resolved = path.resolve(absPath);
  // WP-203 测试回落拒写闸：node --test 上下文（NODE_TEST_CONTEXT，测试子进程随 env 继承）禁写
  // 跑批器所在仓的 data/theschema——测试消费活库磁盘态＝写通道穿透（WP-202 收官实录：夹具投影经
  // resolveTheSchemaDir 回落档退化写进真文件两例）。「真仓」判定＝跑批器仓根标记 NODE_TEST_RUNNER_ROOT
  // （test-node.mjs buildRunnerEnv 下发，随子进程/env 继承面传播）：复制仓世界（PR-261 假仓）模块根≠
  // 跑批器仓根，其自含领地不在锁内；无标记的直跑 node --test 不执法（执法面＝npm run test:node 正门；
  // 语义单测自设标记覆盖闸逻辑）。测试/e2e 自含领地一律 THESCHEMA_DIR 钉扎（repo-write-enforcement
  // 同款纪律）；生产不受影响——真 vault 迁离后回落仓内＝生产正解（保留）；e2e 走 Playwright runner
  // 不设 NODE_TEST_CONTEXT，天然不触发。fail-closed 不设旁路开关。
  const runnerRoot = process.env.NODE_TEST_RUNNER_ROOT ? path.resolve(process.env.NODE_TEST_RUNNER_ROOT) : null;
  if (runnerRoot && process.env.NODE_TEST_CONTEXT && resolved.startsWith(path.join(runnerRoot, "data", "theschema") + path.sep)) {
    const err = new Error(
      `repo-schema-io 测试回落拒写：${absPath} 指向真仓 data/theschema——测试上下文禁消费活库磁盘态（WP-202 实录防线）；测试领地请钉扎 THESCHEMA_DIR`,
    );
    err.code = "REPO_SCHEMA_TEST_WRITE";
    throw err;
  }
  // 钉扎世界（THESCHEMA_DIR）＝合法领地：测试/e2e 自含 TheSchema——但拒绝把仓根/根目录当领地（红队 P2-4：防全仓可写）
  const pinnedRaw = process.env.THESCHEMA_DIR ? path.resolve(process.env.THESCHEMA_DIR) : null;
  if (pinnedRaw && (pinnedRaw === path.parse(pinnedRaw).root || pinnedRaw === ROOT || pinnedRaw === path.dirname(ROOT))) {
    const err = new Error(`repo-schema-io 钉扎领地非法：THESCHEMA_DIR=${pinnedRaw} 指向根/仓根——须指向具体 TheSchema 目录`);
    err.code = "REPO_SCHEMA_DESTINATION";
    throw err;
  }
  const pinned = pinnedRaw ? pinnedRaw + path.sep : null;
  // WP-203：PR-158 的 THESCHEMA_REPO_FALLBACK_DIR（仓内回落语义的测试注入口）升格为合法写领地——
  // 生成器仓内副本面随 repoTheschemaRoot 注入落点后须经唯一门，领地判据在此对齐（同 P2-4 根目录防全仓可写）。
  const fallbackRaw = process.env.THESCHEMA_REPO_FALLBACK_DIR ? path.resolve(process.env.THESCHEMA_REPO_FALLBACK_DIR) : null;
  if (fallbackRaw && (fallbackRaw === path.parse(fallbackRaw).root || fallbackRaw === ROOT || fallbackRaw === path.dirname(ROOT))) {
    const err = new Error(`repo-schema-io 钉扎领地非法：THESCHEMA_REPO_FALLBACK_DIR=${fallbackRaw} 指向根/仓根——须指向具体 TheSchema 目录`);
    err.code = "REPO_SCHEMA_DESTINATION";
    throw err;
  }
  const fallback = fallbackRaw ? fallbackRaw + path.sep : null;
  const allowed =
    resolved.startsWith(ALLOWED_PREFIX) ||
    (pinned && resolved.startsWith(pinned)) ||
    (fallback && resolved.startsWith(fallback));
  if (!allowed) {
    const err = new Error(`repo-schema-io 目的地执法：${absPath} 不在 data/theschema/ 内——仓内 schema 通道只写 TheSchema 主源（越界写须走对应通道）`);
    err.code = "REPO_SCHEMA_DESTINATION";
    throw err;
  }
}

/** 原子写（tmp+rename）。options.ledgerMeta 仅入日志（无 vault 台账语义）。 */
function repoWrite(absPath, content, options = {}) {
  assertRepoSchemaDestination(absPath);
  const tmp = absPath + `.repo-io-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8"); // eslint-disable-line no-restricted-syntax -- 仓内数据通道本体（tmp+rename 原子写；非 vault 面）
  try {
    fs.renameSync(tmp, absPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* 清理尽力而为（红队 P3-6：rename 失败不留残 tmp） */ }
    throw e;
  }
  if (!options.silent) {
    console.error(JSON.stringify({ level: "info", subsystem: "repo-schema-io", event: "repo-schema-written", path: path.relative(ROOT, absPath), summary: options.summary || "" })); // stderr——stdout 留给结果 JSON
  }
}

/** git 历史快照列（SPEC-023 波 3：fs 快照退役——git 即账）。
 *  返回形状与旧 listSnapshots 兼容：[{id, generatedAt, revision, sourceFile}]，最新在前。 */
function listGitSnapshots(repoRelFile) {
  let out;
  try {
    // eslint-disable-next-line no-restricted-syntax -- git 历史读（快照适配器）：同步子进程仅历史列表/回滚路径，10s 超时，单用户本地工具；异步化登记 SPEC-023 波 3 待办
    out = execFileSync("git", ["log", "--follow", "--format=%H|%aI", "--", repoRelFile], { cwd: ROOT, encoding: "utf8", timeout: 10_000 });
  } catch {
    return []; // 非 git 环境（测试临时目录）——无历史
  }
  const items = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [sha, iso] = line.split("|");
    let blob;
    try {
      blob = execFileSync("git", ["show", `${sha}:${repoRelFile}`], { cwd: ROOT, encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }); // eslint-disable-line no-restricted-syntax -- git 历史读路径（同前批豁免理由）
    } catch {
      continue;
    }
    const id = sha.slice(0, 10);
    items.push({
      id,
      generatedAt: iso,
      revision: "sha256:" + require("node:crypto").createHash("sha256").update(blob).digest("hex"),
      sourceFile: `${repoRelFile}@${id}`,
    });
  }
  return items;
}

/** git 快照回滚：目标 commit 的 blob 内容经 repoWrite 落回主源（乐观锁由调用方先校验或在此校验）。 */
function readGitSnapshot(repoRelFile, snapshotId) {
   
  if (!/^[0-9a-f]{7,40}$/.test(snapshotId || "")) {
    const err = new Error("Invalid snapshot id");
    err.code = "INVALID_SNAPSHOT_ID";
    err.status = 400;
    throw err;
  }
  let blob;
  try {
    blob = execFileSync("git", ["show", `${snapshotId}:${repoRelFile}`], { cwd: ROOT, encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }); // eslint-disable-line no-restricted-syntax -- 同上（回滚读路径）
  } catch {
    const err = new Error("Schema snapshot not found");
    err.code = "SNAPSHOT_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  return blob;
}

module.exports = { repoWrite, listGitSnapshots, readGitSnapshot, assertRepoSchemaDestination, REPO_SCHEMA_ROOT: path.join(ROOT, "data", "theschema") };
