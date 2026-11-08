#!/usr/bin/env node
// project-resolved-domains.mjs — resolved-domains.json 派生投影生成器（SPEC-020 波 2）
// @responsible: 从 fields.yaml 结构化配方（波 1 落地）生成 vault 侧 resolved-domains.json 只读派生物
//               ——每个字段的合法值集合/别名表/缺省值/输入归一标记/混合域结构，机器可消费的单一解析面。
//               Python 校验器与 Node 消费方（合规/画像/录入）切换到此面，配方解释逻辑只在
//               value-domain-resolver.cjs 活一份（生成器即校验器：--check 比对防漂移）。
// @inputs: vault（经 VAULT_PATH/.env 解析）——fields.yaml＋enums.yaml＋versions.yaml
// @outputs: 重写 知识库/TheSchema/resolved-domains.json；--check 只读比对（derivation-sync 门禁用）。
// @context: SPEC-020 波 2；确定性生成（无时间戳，同输入同输出字节一致——连续两遍 diff 为空为验收）。
//           写者登记：本脚本是 resolved-domains.json 投影的显式授权写者；写路径联动见
//           fields/enums/versions 三写服务（失败记 warn 不回滚本体，与 entity-frontmatter-schema 先例同款）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveTheSchemaDir } from "./shared/theschema-root.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const { resolveValueDomains } = require("../../server/shared/value-domain-resolver.cjs");
const { replaceTheSchemaFile } = require("../../server/shared/theschema-write.cjs"); // WP-079 唯一门：TheSchema 投影写也走咽喉（内部即目的地执法网关），服务与生成器一律不自判通道
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveVault() {
  const fromEnv = process.env.VAULT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return null;
  const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
  if (!line) return null;
  const v = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return v && fs.existsSync(v) ? v : null;
}

/** 纯构建（写路径联动复用，防两份生成逻辑）：三源 → 派生物文本（确定性，无时间戳）。 */
export function buildResolvedArtifacts({ fields, enums, versions }) {
  const { byField, errors } = resolveValueDomains({ fields, enums, versions });
  if (errors.length) {
    const err = new Error(`project-resolved-domains: 配方解析有 ${errors.length} 红——先过 check:fields-registry：\n  ${errors.join("\n  ")}`);
    err.code = "RECIPE_ERRORS";
    throw err;
  }
  // 红队高-1 修复：以字段声明为基座——required/scope 事实不依赖 value_domain 配方存在
  //（title 无配方但其必填执法必须保留）；解析产物（值集/归一/缺省）按 名＋作用域 合并。
  const resolvedByKey = new Map(byField.map((rec) => [`${rec.name}|${(rec.scope || []).join(",")}`, rec]));
  const rows = (fields.fields || []).filter((f) => f && typeof f.name === "string").map((decl) => {
    const rec = resolvedByKey.get(`${decl.name}|${(Array.isArray(decl.scope) ? decl.scope : []).join(",")}`) || {};
    return {
      name: decl.name,
      scope: Array.isArray(decl.scope) ? decl.scope : [],
      required: typeof decl.required === "string" ? decl.required : null,
      values: rec.values !== undefined ? rec.values : null,
      aliasMap: rec.aliasMap || null,
      default: rec.default !== undefined ? rec.default : null,
      wikilinkStrip: Boolean(rec.wikilinkStrip),
      composite: rec.composite || null,
    };
  });
  const doc = {
    $comment:
      "派生物标记：本文件由 scripts/quality/project-resolved-domains.mjs 从 fields.yaml 结构化配方（SPEC-020）生成——禁止手改。配方增删改请改 fields.yaml 后重跑 npm run project:resolved-domains（写路径已联动重生成）。漂移由第 32 号门禁 derivation-sync 在提交/CI 时拦截。",
    schema_version: 1,
    byField: rows,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

function main() {
  const vault = resolveVault();
  if (!vault) {
    if (process.argv.includes("--check")) {
      console.log("project-resolved-domains --check: (skip VAULT_PATH 未解析——本环境无解析物对账面)");
      return;
    }
    console.error("project-resolved-domains: VAULT_PATH 未解析（环境变量或 .env）——无法生成解析物");
    process.exit(1);
  }
  const dir = path.join(resolveTheSchemaDir(vault));
  const readYaml = (name) => {
    const p = path.join(dir, name);
    return fs.existsSync(p) ? YAML.parse(fs.readFileSync(p, "utf8")) || {} : null;
  };
  const fields = readYaml("fields.yaml");
  const enums = readYaml("enums.yaml");
  const versions = readYaml("versions.yaml");
  if (!fields) {
    console.error("project-resolved-domains: fields.yaml 不存在——字段字典未落档");
    process.exit(1);
  }
  const output = buildResolvedArtifacts({ fields, enums: enums || {}, versions: versions || {} });
  const target = path.join(dir, "resolved-domains.json");
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current !== output) {
      console.error("project-resolved-domains --check: 解析物漂移（resolved-domains.json 与 fields.yaml 配方不一致）——重跑 npm run project:resolved-domains");
      process.exit(1);
    }
    console.log("project-resolved-domains --check: ok（解析物与字段配方一致）");
    return;
  }
  replaceTheSchemaFile(target, output, { summary: "投影重生成（TheSchema 主源）" }); // 唯一门：钉扎领地外／vault 侧未钉扎一律拒写
  console.log(`project-resolved-domains: 已生成 ${path.relative(vault, target)}（${JSON.parse(output).byField.length} 字段行）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
