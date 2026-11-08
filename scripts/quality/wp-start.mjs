#!/usr/bin/env node
// wp-start.mjs — 工作包开工单入口（ADR-013）：生成合同实例骨架＋schema 校验。
// @responsible: 「开工＝一个命令」的落点——合规是起点不是审查结果。骨架生成后人工填
//   wiring/domain_mapping/in_scope_zones/deliverables/acceptance，填齐走 wp:derive --write 并入义务，
//   Master 批后 status→approved 进 building。
// @inputs: argv——<package_id> --title <标题> --kind <mainline|support|audit> [--spec <路径>] [--adr <路径>]
// @outputs: docs/work-packages/<package_id>.json（draft 骨架，schema 可过）
// @context: 建树仍走 GIT-CONTEXT §四手工命令（git 操作保持可审计透明，脚本不包办）；
//   骨架自带 coverage.gaps 默认缺口集（TALOS「缺口自声明」纪律——至少声明语义与判断两类不在执法面）。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Ajv 2020 构造（先例＝dev-log-ledger.loadAjv）：schema 声明 2020-12 时须用 dist/2020 类
function makeValidator(schema) {
  const AjvCtor = require("ajv/dist/2020.js").default ?? require("ajv/dist/2020.js");
  return new AjvCtor({ strict: false, allErrors: true }).compile(schema);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--title") out.title = argv[++i];
    else if (argv[i] === "--kind") out.kind = argv[++i];
    else if (argv[i] === "--spec") (out.spec ||= []).push(argv[++i]);
    else if (argv[i] === "--adr") (out.adr ||= []).push(argv[++i]);
    else out._.push(argv[i]);
  }
  return out;
}

export function scaffold({ package_id, title, kind = "mainline", spec = [], adr = [] }) {
  return {
    $schema: "./work-package.schema.json",
    schema_version: 1,
    package_id,
    title,
    kind,
    phase: "",
    status: "draft",
    upstream: { adr, spec: spec.length > 0 ? spec : ["（draft 待填：含追踪矩阵的 SPEC/设计稿路径）"], proposal: [] },
    wiring: { trigger: "（draft 待填）", logging: "（draft 待填）", source: "（draft 待填）", sink: "（draft 待填）" },
    domain_mapping: [],
    in_scope_zones: [],
    in_scope_paths: [],
    non_goals: ["（必填——空 non_goals 违反显式排除纪律）"],
    deliverables: ["（draft 待填）"],
    acceptance: { criteria: ["（draft 待填：满足则验收通过的可判定句式）"], revision: 1 },
    pending_decisions: [],
    validation_commands: [],
    change_requests: [],
    scope_revision: 1,
    obligations: [],
    coverage: {
      gaps: [
        "语义质量（矩阵/证据/验收条款内容真不真）不在执法面——机器保证问到，判断归人",
        "扩域 vs 拆域判断、D 类裁决（object_kind/住址/取舍）归 Master——合同只保证其在场",
      ],
      notes: "",
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageId = args._[0];
  if (!packageId || !args.title) {
    console.error("用法：npm run wp:start -- <package_id> --title <标题> [--kind mainline] [--spec <路径>] [--adr <路径>]");
    console.error("编号惯例：业务包沿用既有（如 EDGE-RELATION-GOV-001）；机制包 WP-00N。建树：git worktree add ../cheeseh-<短名> -b task/<短名> main（GIT-CONTEXT §四）");
    process.exit(2);
  }
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/work-package.schema.json"), "utf8"));
  const contract = scaffold({ package_id: packageId, title: args.title, kind: args.kind, spec: args.spec || [], adr: args.adr || [] });
  const validate = makeValidator(schema);
  if (!validate(contract)) {
    console.error("骨架 schema 不过（不应发生）：" + JSON.stringify(validate.errors));
    process.exit(1);
  }
  const dir = path.join(ROOT, "docs/work-packages");
  const file = path.join(dir, `${packageId}.json`);
  if (fs.existsSync(file)) { console.error(`合同已存在：${file}`); process.exit(1); }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(contract, null, 2) + "\n");
  console.log(`已生成合同骨架：${file}`);
  console.log("        ⓪ 取号前先推拉对齐远端（git fetch origin && git merge origin/main；本地在飞提交先 push）——取号/树基线以对齐后 main 为准，防并行会话撞号（PR-098/WP-007 先例）；");
  console.log("下一步：① 填 wiring 四键＋domain_mapping＋in_scope_zones/paths＋deliverables＋acceptance；");
  console.log("        ② npm run wp:derive -- " + packageId + " --write（并入派生义务）；");
  console.log("        ③ 请示 Master 批准后 status→approved，进 building。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
