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
  // 钉扎世界（THESCHEMA_DIR）＝合法领地：测试/e2e 自含 TheSchema——但拒绝把仓根/根目录当领地（红队 P2-4：防全仓可写）
  const pinnedRaw = process.env.THESCHEMA_DIR ? path.resolve(process.env.THESCHEMA_DIR) : null;
  if (pinnedRaw && (pinnedRaw === path.parse(pinnedRaw).root || pinnedRaw === ROOT || pinnedRaw === path.dirname(ROOT))) {
    const err = new Error(`repo-schema-io 钉扎领地非法：THESCHEMA_DIR=${pinnedRaw} 指向根/仓根——须指向具体 TheSchema 目录`);
    err.code = "REPO_SCHEMA_DESTINATION";
    throw err;
  }
  const pinned = pinnedRaw ? pinnedRaw + path.sep : null;
  const allowed = resolved.startsWith(ALLOWED_PREFIX) || (pinned && resolved.startsWith(pinned));
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
