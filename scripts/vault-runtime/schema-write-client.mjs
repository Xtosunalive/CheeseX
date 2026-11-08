#!/usr/bin/env node
// schema-write-client.mjs — TheSchema 统一写客户端（SPEC-021 波 A）
// @responsible: 页面/服务端之外一切写者的唯一前门——管线（generate-sa.py）、人工 CLI（classify.py）、
//               AI 会话迁移。薄封装 enums/fields 写服务：原子写＋写前快照＋规范形态断言＋
//               解析物联动（客户端显式 await——消灭 fire-and-forget 窗口，返回即投影已重算）。
// @inputs: vault（--vault 参数 > VAULT_PATH 环境变量 > .env 回落）；操作参数见 usage
// @outputs: 退出码 0＋JSON 结果（revision/snapshots/resolvedSynced——机器可消费）；
//           失败非零退出＋JSON error（VALIDATION/CONFLICT 语义透传）
// @context: SPEC-021 写者收敛阶梯第 2 级。协议实现唯此一份（node 写服务）——Python 侧经
//           subprocess 调用，不再自实现快照/原子写。无需 API server 在跑（直接 require 服务模块）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { writeEnums } = require("../../server/services/schema-manager/enums-write-service.cjs");

function resolveVault(explicit) {
  // 红队 D3 类修（第三次收口）：写路径只认显式 --vault（绝对化）——env/.env 兜底全砍。
  // 两次真库误写事故同根＝隐式回落链；写操作不允许任何"猜"。
  if (typeof explicit !== "string" || explicit === "" || explicit.startsWith("--")) return null;
  const abs = path.resolve(explicit);
  return fs.existsSync(abs) ? abs : null;
}

function usage() {
  return [
    "用法：schema-write-client.mjs <操作> [参数]",
    "  revision          --segment <enums|relations|fields|ontology|dependencies> --vault <路径>（读当前乐观锁基线——写操作的前置，只读零写）",
    "  modules-upsert   --name <模块名> [--system/--subdomain/--since/--until] --revision <读到的基线> --vault <路径>（revision 必填，绝对或相对均可）",
    "  enum-append       --segment <段名> --value <值>（闭合枚举段追加——kb-enum 用，幂等跳过已存在） --revision <读到的基线> --vault <路径>",
    "  enums-set-modules --file <modules.json>（整表替换 modules 段——管线 sync-enums 用） --revision <读到的基线> --vault <路径>",
    "  fields-write      --file <fields.json>（字段字典整写——AI 会话迁移通道） --revision <读到的基线|null> --vault <路径>",
    "  validate-article  --file <文章.md> [--stamp]（文章校验闸门——SPEC-022 唯一语义；stdout=校验报告 JSON，exit 0/1/2） [--vault <路径>]",
    "                   探测模式：--detect-stale <dir> / --detect-untracked-wikilinks <dir> / --detect-author-placeholders <dir> / --quality-summary <dir>",
    "",
    "输出：成功 {ok:true, revision, resolvedSynced}（解析物失败＝exit 4 fail-visible）；冲突 exit 3；参数/校验/缺基线 exit 1；未知操作 exit 2",
    "写侧纪律（PR-200）：--revision 必填——「没传」不等于「不用比」。先跑 revision 取基线再原样回传；",
    "  fields 在空库态读到的基线是 null，写首建时传 --revision null 即该断言（文件已在而传 null 走 409 冲突）。",
  ].join("\n");
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : true;
    else out._.push(argv[i]);
  }
  return out;
}

/** D8 守卫：写键/值参数必须是真字符串（防 flag 吞值产生 true/畸形键）。 */
function strArg(args, key) {
  const v = args[key];
  return typeof v === "string" && v !== "" && !v.startsWith("--") ? v : null;
}

async function main() {
  const [op, ...rest] = process.argv.slice(2);
  if (!op || op === "--help" || op === "-h") {
    console.log(usage());
    process.exit(op ? 0 : 2);
  }
  const args = parseArgs(rest);
  const KNOWN_OPS = new Set(["revision", "modules-upsert", "enum-append", "enums-set-modules", "fields-write", "validate-article", "ontology-write"]);
  if (!KNOWN_OPS.has(op)) {
    console.error(JSON.stringify({ ok: false, code: "UNKNOWN_OP", error: `未知操作 '${op}'` }));
    process.exit(2);
  }
  const vault = resolveVault(args.vault);
  if (!vault) {
    console.error(JSON.stringify({ ok: false, code: "VAULT_UNRESOLVED", error: "vault 未解析（须显式 --vault 或 VAULT_PATH 环境变量——.env 回落已因两次误写真库事故移除）" }));
    process.exit(2);
  }
  const fail = (code, error, status = 1) => {
    console.error(JSON.stringify({ ok: false, code, error: String(error).split("\n")[0], ...(process.env.SWC_DEBUG ? { stack: String(error).split("\n").slice(1).join(" | ") } : {}) }));
    process.exit(status);
  };

  const stderrLogger = { info: (...a) => console.error(...a), warn: (...a) => console.error(...a), error: (...a) => console.error(...a) };
  // PR-200：「缺基线即拒」的判定住在服务侧单点闸（server/shared/schema-write-guards.cjs
  // assertRevisionGiven）——CLI 只做参数翻译，不另写一份规则：未给 --revision → undefined（闸拒），
  // 给字面 --revision null → null（＝读侧对缺席 fields.yaml 给出的空库基线，原样回传即首建断言）。
  // 基线从哪来：先跑本客户端的 revision 操作（只读）取当前基线。
  const revisionArg = () => {
    const raw = strArg(args, "revision");
    if (raw === null) return undefined;
    return raw === "null" ? null : raw;
  };
  try {
    if (op === "revision") {
      const segment = strArg(args, "segment");
      const READERS = {
        enums: () => require("../../server/services/schema-manager/enums-write-service.cjs").readEnums(vault).revision,
        relations: () => require("../../server/services/schema-manager/relations-write-service.cjs").readRelationsFile(vault).revision,
        fields: () => require("../../server/services/schema-manager/fields-write-service.cjs")
          .createFieldsWriteService({ vaultPath: vault, logger: stderrLogger }).readFields().revision,
        // 本体/依赖侧基线是无缀 sha256 形（读盘口 readSchemaYaml 给什么就回传什么——写侧比对的即该值）
        ontology: () => require("../../server/services/schema-manager/schema-write-service.cjs").createSchemaWriteService({ vaultPath: vault, logger: stderrLogger }).readSchemaYaml("ontology").revision,
        dependencies: () => require("../../server/services/schema-manager/schema-write-service.cjs").createSchemaWriteService({ vaultPath: vault, logger: stderrLogger }).readSchemaYaml("dependencies").revision,
      };
      if (!segment || !READERS[segment]) {
        return fail("VALIDATION_ERROR", `revision 需要 --segment（${Object.keys(READERS).join("|")}）——未知段名 '${segment ?? ""}'`);
      }
      console.log(JSON.stringify({ ok: true, op, segment, revision: READERS[segment]() }));
      return;
    }
    if (op === "modules-upsert") {
      const name = strArg(args, "name");
      if (!name) return fail("VALIDATION_ERROR", "modules-upsert 需要 --name（非空字符串）");
      const expectedRevision = revisionArg();
      const result = await writeEnums({
        vaultPath: vault,
        expectedRevision,
        logger: stderrLogger,
        mutate: (doc) => {
          if (!doc.has("modules")) doc.set("modules", {});
          const modules = doc.get("modules");
          const existing = modules.has(name) && typeof modules.get(name) === "object" ? modules.get(name).toJSON?.() || {} : {};
          const entry = { ...existing };
          for (const key of ["system", "subdomain", "since", "until"]) {
            const v = strArg(args, key);
            if (v !== null) entry[key] = v;
          }
          modules.set(name, entry);
        },
      });
      return finish(vault, op, result);
    }
    if (op === "enum-append") {
      const segment = strArg(args, "segment");
      const value = strArg(args, "value");
      if (!segment || !value) return fail("VALIDATION_ERROR", "enum-append 需要 --segment 与 --value（非空字符串）");
      const expectedRevision = revisionArg();
      let appended = false;
      const result = await writeEnums({
        vaultPath: vault,
        expectedRevision,
        logger: stderrLogger,
        mutate: (doc) => {
          const current = doc.get(segment);
          if (!current) {
            const { Pair, Scalar } = require("yaml");
            doc.add(new Pair(new Scalar(segment), [value]));
          } else if (Array.isArray(current.items)) {
            // YAMLSeq：items 直判（toJS 在此 yaml 版本需 document 参）
            for (const item of current.items) {
              const v = item && typeof item.value === "object" ? item.value.value : item && item.value !== undefined ? item.value : item;
              if (String(v) === value) return; // 幂等：已存在跳过
            }
            current.items.push(new (require("yaml").Scalar)(value));
          } else {
            throw new Error(`enum-append 只适用列表段（'${segment}' 非序列）`);
          }
          appended = true;
        },
      });
      return finish(vault, op, result, { appended });
    }
    if (op === "enums-set-modules") {
      if (!args.file || !fs.existsSync(args.file)) return fail("VALIDATION_ERROR", "enums-set-modules 需要 --file（存在的 JSON）");
      const modulesMap = JSON.parse(fs.readFileSync(args.file, "utf8"));
      if (!modulesMap || typeof modulesMap !== "object" || Array.isArray(modulesMap)) return fail("VALIDATION_ERROR", "--file 须为 JSON 对象（modules 映射）");
      const expectedRevision = revisionArg();
      const result = await writeEnums({
        vaultPath: vault,
        expectedRevision,
        logger: stderrLogger,
        mutate: (doc) => {
          doc.set("modules", doc.createNode(modulesMap));
        },
      });
      return finish(vault, op, result);
    }
    if (op === "fields-write") {
      if (!args.file || !fs.existsSync(args.file)) return fail("VALIDATION_ERROR", "fields-write 需要 --file（存在的 JSON：{fields:[...]}）");
      const payload = JSON.parse(fs.readFileSync(args.file, "utf8"));
      if (!Array.isArray(payload && payload.fields)) return fail("VALIDATION_ERROR", "--file 须为 {fields:[...]}");
      const { createFieldsWriteService } = require("../../server/services/schema-manager/fields-write-service.cjs");
      const expectedRevision = revisionArg();
      // stdout 只留结果 JSON（机器消费单源）——服务日志全导 stderr
      const fieldsLogger = { info: (...a) => console.error(...a), warn: (...a) => console.error(...a), error: (...a) => console.error(...a) };
      const service = createFieldsWriteService({ vaultPath: vault, logger: fieldsLogger });
      const result = await service.writeFields({ fields: payload.fields, expectedRevision });
      console.log(JSON.stringify({ ok: true, op, revision: result.revision, projectionSynced: result.projectionSynced, resolvedSynced: result.resolvedSynced }));
      return;
    }
    if (op === "ontology-write") {
      // WP-049 余量批：本体 patch 写操作（镜像 PUT /api/schema/ontology 语义——patch＋精确
      // revision OCC＋写闸/快照全走服务层；CLI 侧供数据迁移与工具使用）
      if (!args.file || !fs.existsSync(args.file)) return fail("VALIDATION_ERROR", "ontology-write 需要 --file（存在的 JSON patch 对象）");
      const patch = JSON.parse(fs.readFileSync(args.file, "utf8"));
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("VALIDATION_ERROR", "--file 须为 JSON 对象（patch）");
      const expectedRevision = revisionArg();
      const { createSchemaWriteService, sha256 } = require("../../server/services/schema-manager/schema-write-service.cjs");
      const { loadVocabBundle } = require("../../server/shared/vocab-load-port.cjs");
      const bundle = loadVocabBundle(vault, { files: ["ontology"] });
      const currentRevision = bundle.files.ontology && bundle.files.ontology.state === "present" ? "sha256:" + bundle.files.ontology.fingerprint : sha256("");
      const service = createSchemaWriteService({ vaultPath: vault, logger: stderrLogger });
      const result = service.writeOntology({ patch, revision: expectedRevision });
      console.log(JSON.stringify({ ok: true, op, revision: result.revision, currentRevisionBefore: currentRevision, backupPath: result.backupPath, snapshotId: result.snapshotId }));
      return;
    }
    if (op === "validate-article") {
      const { createArticleValidator, ValidatorFatal } = require("./article-validator-lib.cjs");
      let validator;
      try {
        validator = createArticleValidator({ vaultPath: vault, logger: { warn: (...a) => console.error(...a), info: () => {} } });
      } catch (e) {
        if (e instanceof ValidatorFatal) {
          console.error(e.stderr);
          process.exit(e.exitCode);
        }
        throw e;
      }
      const DETECTORS = {
        "detect-stale": "detectStale",
        "detect-untracked-wikilinks": "detectUntrackedWikilinks",
        "detect-author-placeholders": "detectAuthorPlaceholders",
        "quality-summary": "qualitySummary",
      };
      for (const [flag, method] of Object.entries(DETECTORS)) {
        if (args[flag] !== undefined) {
          const dir = strArg(args, flag);
          if (!dir || !fs.existsSync(dir)) {
            console.error(JSON.stringify({ mode: flag, error: `目录不存在: ${args[flag]}` }));
            process.exit(1);
          }
          const outcome = validator[method](path.resolve(dir));
          console.log(JSON.stringify(outcome.summary, null, 2));
          process.exit(outcome.exitCode);
        }
      }
      const file = strArg(args, "file");
      if (!file) return fail("VALIDATION_ERROR", "validate-article 需要 --file（文章路径）");
      const abs = path.resolve(file);
      const result = args.stamp === true ? validator.validateAndStamp(abs) : validator.validateFile(abs);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }
    return fail("UNKNOWN_OP", `未知操作 '${op}'——${usage()}`, 2);
  } catch (e) {
    // PR-184：错误码优先取服务层 e.code（已登记码），文案正则只作无 code 时的兜底——
    // 此前一律按 message 推码，把咽喉抛的 VALIDATION_ERROR（code 正确、判据在文案前缀）压成泛化 WRITE_FAILED
    const rawCode = typeof e.code === "string" && e.code ? e.code : "";
    const code = rawCode === "ENUMS_REVISION_CONFLICT" || rawCode === "FIELDS_REVISION_CONFLICT" || rawCode === "VERSIONS_REVISION_CONFLICT" || /REVISION_CONFLICT/.test(rawCode) || /REVISION_CONFLICT/.test(e.message || "")
      ? "REVISION_CONFLICT"
      // PR-200：缺基线由服务侧单点闸抛出，码须直达 CLI（PR-184 同款「不压成泛化码」），不得并入 VALIDATION_ERROR
      : rawCode === "SCHEMA_REVISION_REQUIRED"
        ? "SCHEMA_REVISION_REQUIRED"
      : rawCode === "VALIDATION_ERROR" || rawCode === "SHAPE_INVALID" || /SHAPE_INVALID|VALIDATION_ERROR/.test(e.message || "")
        ? "VALIDATION_ERROR"
        : "WRITE_FAILED";
    fail(code, process.env.SWC_DEBUG ? e.stack : e.message, code === "REVISION_CONFLICT" ? 3 : 1);
  }
}

/** 解析物显式重算（客户端路径不依赖写服务内的 fire-and-forget——返回即同步完成）。 */
async function regenResolved(vaultPath) {
  try {
    const { regenerateResolvedDomains } = require("../../server/shared/regenerate-derived-projections.cjs");
    return await regenerateResolvedDomains(vaultPath, { warn: (...a) => console.error(...a) });
  } catch (e) {
    console.error(`resolved-domains 重算失败: ${String(e.message).split("\n")[0]}`);
    return false;
  }
}

/** 统一成功出口：本体已落盘；解析物失败＝exit 4（fail-visible，非静默半绿——红队 D4/2.6）。 */
async function finish(vault, op, result, extra = {}) {
  const resolvedSynced = await regenResolved(vault);
  console.log(JSON.stringify({ ok: true, op, revision: result.revision, resolvedSynced, ...extra }));
  if (!resolvedSynced) process.exit(4);
}

main();
