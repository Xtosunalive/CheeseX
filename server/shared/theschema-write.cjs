// Component: Theschema-Write（WP-075 立咽喉·WP-079 收为唯一门）
// @responsible: TheSchema 文件写的唯一入口——通道**不由调用方判**：一律经 repo-schema-io（仓内主源＝git 即账；
//   显式钉扎 THESCHEMA_DIR 的自含领地亦认）。落点落在 vault 树内且未被钉扎时 fail-closed 拒写——
//   这是 SPEC-012 F1「新投影经合法通道写回 vault 须构造性不可能」的立法原意与 A1-2 在册断言
//   （迁移窗翻回＝读得到、写不进），不是本包新设。
// @inputs: 待写绝对路径（调用方用 resolveTheSchemaDir/vaultPaths 解析）＋内容＋{ expectedContentHash?, summary }
// @outputs: 落盘；更新写凭据必填（缺即 SCHEMA_REVISION_REQUIRED、过期即 SCHEMA_REVISION_CONFLICT 409，
//   与仓内通道既有乐观锁同闸形）；vault 侧未钉扎落点抛 REPO_SCHEMA_DESTINATION（由通道自拒，本层不另立谓词）
// @context: 一规则一闸形——「TheSchema 住哪条通道」此前散在 7 个服务里各自判（version-registry 内联
//   endsWith 判据／enums·fields·relations·lineage 直连 repoWrite／article-association 恒走 vault-io 致
//   tr_504310b2 生产 500），现全部收进本文件；服务侧不得再直连 repoWrite 或对 TheSchema 住址用 vault 通道
//   （check:schema-writers 面⑩ 闭集执法，豁免须附理由且空转即摘）。
const fs = require("node:fs");
const path = require("node:path");
const { repoWrite, assertRepoSchemaDestination } = require("./repo-schema-io.cjs"); // 断言即通道自身的目的地谓词——本层不复造第二份判据
const { contentRevision, ABSENT_REVISION } = require("./vault-io.cjs");

/** 仓内通道更新写的凭据校验（与 vault-io assertUpdateCredential 同语义；缺即拒、不符即拒、absent 声明新建）。 */
function assertRepoUpdateCredential(absPath, expected) {
  const { createError } = require("./error-factory.cjs");
  if (typeof expected !== "string" || expected.length === 0) {
    throw createError("SCHEMA_REVISION_REQUIRED", `仓内 TheSchema 更新写要求 expectedContentHash（'${ABSENT_REVISION}' 声明新建）: ${path.basename(absPath)}`, 400);
  }
  let actual;
  try { actual = contentRevision(fs.readFileSync(absPath, "utf8")); }
  catch { actual = ABSENT_REVISION; }
  if (expected !== actual) {
    throw createError("SCHEMA_REVISION_CONFLICT", `TheSchema revision conflict on ${path.basename(absPath)}: expected ${expected}, disk ${actual}`, 409, { expected, actual });
  }
}

/** 更新写（读改写）：凭据必填——账本类写者用（article_associations／ontology 族回滚等）。 */
function writeTheSchemaFile(absPath, content, options = {}) {
  assertRepoSchemaDestination(absPath); // 先验后建：拒写不许在非法落点留下空目录或半截文件
  prepareDirectory(absPath);
  assertRepoUpdateCredential(absPath, options.expectedContentHash);
  repoWrite(absPath, content, { summary: options.summary });
}

/** 全权替换写（生成器/整表重写）：无凭据形态，与 vault-io replaceVault 对称。 */
function replaceTheSchemaFile(absPath, content, options = {}) {
  assertRepoSchemaDestination(absPath); // 同上
  prepareDirectory(absPath);
  repoWrite(absPath, content, { summary: options.summary });
}

function prepareDirectory(absPath) {
  try { fs.mkdirSync(path.dirname(absPath), { recursive: true }); } catch { /* 已存在或领地不可写——由通道目的地执法判生死 */ }
}

module.exports = { writeTheSchemaFile, replaceTheSchemaFile, assertRepoUpdateCredential };
