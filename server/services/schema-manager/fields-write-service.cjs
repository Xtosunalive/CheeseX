// Component: Fields-Write-Service（ADR-008 D2 / SPEC-017 W4）
// @responsible: fields.yaml 唯一写通道——schema 校验/内容哈希乐观锁/原子写/投影联动 四件（写前 fs 快照仪式已按 SPEC-023 波3 退役，见 snapshotFields）。
// @inputs: vaultPath；{ fields, expectedRevision }（fields=全量字段数组——字段字典小表整量写）
// @outputs: { revision, affectedFile, projectionSynced }
// @context: 域卡 schema-rules-data write_protocol（复用 enums-write-service 同款纪律）；
//           账实一致由 check:schema-writers 的「repo 主源洁净」面强制——TheSchema 写后须提交（实测：未提交即点名为 violations）；
//           改前版本按「git 历史即快照」取回（`git show <基线>:data/theschema/fields.yaml`），不再落 history/fields/。
//           投影联动：写入成功后同步重生成 entity-frontmatter-schema.md（单源零漂移——
//           buildProjection 复用 project-frontmatter-schema.mjs 导出，防两份生成逻辑）。
const fs = require("fs");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
const path = require("path");
const crypto = require("crypto");
const YAML = require("yaml");
const { validateDocumentStrict } = require("../../shared/theschema-loader.cjs");
// WP-049 L2：词表读取统一经装载入口（vocab-load-port＝唯一读取宿主；本服务的 enums/versions/fields 读点全收）
const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");
const { createError: serviceError } = require("../../shared/error-factory.cjs");
const { assertRevisionGiven } = require("../../shared/schema-write-guards.cjs");
// PR-057/WP-J 同款：vault 唯一写通道（原子写内建——手工 tmp+rename 退役；记账走 schema-page 域）
const { replaceTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-079 唯一门：TheSchema 写通道由咽喉按落点选，服务侧禁自判

const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");

const FIELDS_HEADER = `# fields.yaml — frontmatter 字段数据字典（ADR-008 D2）
# 唯一机器源：实体/文章 frontmatter 字段的名称/类型/必填/作用域/值域/别名收口。
# entity-frontmatter-schema.md 为本文件派生投影（scripts/quality/project-frontmatter-schema.mjs 生成，禁手改）。
# 对账门禁：npm run check:fields-registry（server 消费的字段名 ⊆ 本表声明集）。
`;

function revisionOf(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function fieldsPath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), "fields.yaml");
}

function projectionPath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), "entity-frontmatter-schema.md");
}

function createFieldsWriteService({ vaultPath, logger, onGraphInputWrite } = {}) {
  const log = logger || { info() {}, warn() {} };
  // WP-027（PR-142）：fields.yaml 是图输入——写成功后回调（main.cjs 注入调度器）；fail-open 不阻断写路径
  function notifyGraphInputWrite() {
    if (typeof onGraphInputWrite !== "function") return;
    try { onGraphInputWrite({ category: "fields", source: "service" }); }
    catch (error) { (log.warn || log.info).call(log, { event: "schema-graph-input-notify-failed", category: "fields", error: String(error) }); }
  }

  function readFields() {
    // WP-049 L2：读侧经装载入口（data＝同一 normalizeDocument 形态收口，语义不变）；
    // missing＝初始空字典（原 existsSync 缺省语义）；text 供 revision 哈希（一次装载两用，原两次读并一）
    const vocab = loadVocabBundle(vaultPath, { files: ["fields"] });
    if (vocab.files.fields.state !== "present") return { data: { schema_version: 1, fields: [] }, revision: null };
    return { data: vocab.files.fields.data, revision: revisionOf(vocab.files.fields.text) };
  }

  function snapshotFields() {
    // 〔SPEC-023 波 3 退役〕fs 快照仪式退役——git 历史即快照。
    return { retired: true };
  }

  async function regenerateProjection(fields) {
    // 投影单源：复用生成器导出的 buildProjection（动态 import mjs——cjs 侧合法通道）
    const { buildProjection } = await import("../../../scripts/quality/project-frontmatter-schema.mjs");
    // WP-049 L2：词表经装载入口取数（raw＋`|| {}` 语义保持；缺件＝fail-closed，与 readFileSync ENOENT 等价）
    const vocab = loadVocabBundle(vaultPath, { files: ["enums"] });
    if (vocab.files.enums.state !== "present") {
      // 缺件＝fail-closed（与旧 readFileSync ENOENT 上抛同向）；不伪造 error.code——
      // 出生即账执法（check:error-codes）对服务端抛码要求契约登记，此处无消费者不需要码
      throw new Error(`enums.yaml 不可读（${vocab.dir}）`);
    }
    const enums = vocab.files.enums.raw || {};
    const output = buildProjection({ fields, enums });
    replaceTheSchemaFile(projectionPath(vaultPath), output, { summary: "fields 投影重生成" });
  }

  return {
    readFields,

    async writeFields({ fields, expectedRevision }) {
      // PR-200：乐观锁基线必填——未给出（undefined/空串）即拒。null 是读侧对缺席 fields.yaml 给出的
      // 空库基线（见 readFields 的 missing 分支），原样回传即合法首建；文件已在而回 null 走 409 冲突。
      const current = this.readFields();
      assertRevisionGiven(expectedRevision, "fields.yaml 写入", { allowNullBaseline: true });
      if (expectedRevision !== current.revision) {
        throw serviceError("FIELDS_REVISION_CONFLICT", "fields.yaml changed after it was loaded", 409);
      }
      if (!Array.isArray(fields)) throw serviceError("VALIDATION_ERROR", "fields must be an array", 400);
      const payload = { schema_version: 1, last_updated: new Date().toISOString().slice(0, 10), fields };
      // 写侧严格（对自己写出的要严格——PR-052 口径）
      const strictErrors = validateDocumentStrict("fields", payload);
      if (strictErrors.length) throw serviceError("VALIDATION_ERROR", "字段字典形态非法: " + strictErrors.join("; "), 400, { errors: strictErrors });
      // SPEC-023 波 4（写时吃扫描）：配方必须零红可解析——引用悬空/未知 op 在此拒写（fields-registry④降为兜底）
      try {
        const { resolveValueDomains } = require("../../shared/value-domain-resolver.cjs");
        // WP-049 L2：词表经装载入口取数——missing 态保持原 existsSync 软默认语义（缺件={}，配方闸不因缺件炸）
        const recipeVocab = loadVocabBundle(vaultPath, { files: ["enums", "versions"] });
        const softDoc = (name) => (recipeVocab.files[name].state === "present" ? recipeVocab.files[name].raw || {} : {});
        const resolution = resolveValueDomains({ fields: payload, enums: softDoc("enums"), versions: softDoc("versions") });
        if (resolution.errors.length) throw new Error(resolution.errors.join("; "));
      } catch (e) {
        throw serviceError("FIELDS_RECIPE_INVALID", "字段配方解析未过（未落盘）：" + String(e.message).split("\n")[0], 400, {});
      }
      // 写前快照 + 原子写（temp+rename）
      snapshotFields();
      const body = FIELDS_HEADER + YAML.stringify(payload);
      replaceTheSchemaFile(fieldsPath(vaultPath), body, { summary: `fields 写入（${payload.fields.length} 字段）` });
      // 投影联动（失败不回滚字典本体——投影是派生物，可重生成；告警即可）
      let projectionSynced = true;
      try {
        await regenerateProjection(payload.fields);
      } catch (e) {
        projectionSynced = false;
        log.warn({ event: "fields-projection-sync-failed", error: e.message, reason: "投影重生成失败——字典本体已落盘，跑 npm run project:frontmatter-schema 补齐" });
      }
      // SPEC-020 波 2：解析物联动（resolved-domains.json——配方派生物，失败不回滚本体）
      const { regenerateResolvedDomainsBestEffort } = require("../../shared/regenerate-derived-projections.cjs");
      const resolvedSynced = await regenerateResolvedDomainsBestEffort(vaultPath, log, "fields-written");
      // WP-049 L2：revision 复用装载入口 text（写后回读一次；原 readFileSync 直读收编）
      const revision = revisionOf(loadVocabBundle(vaultPath, { files: ["fields"] }).files.fields.text);
      log.info({ event: "fields-written", revision, fields: payload.fields.length, projectionSynced, resolvedSynced });
      notifyGraphInputWrite(); // WP-027
      return { revision, affectedFile: displayTheSchemaPath(vaultPath, "fields.yaml"), projectionSynced, resolvedSynced };
    },
  };
}

module.exports = { createFieldsWriteService };
