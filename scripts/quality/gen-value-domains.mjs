#!/usr/bin/env node
// Component: gen-value-domains（三机状态值域生成器——WP-133 子项①，ADR-015 副本→生成器）
// @responsible: 真身（值域单源）＝服务端三处枚举源；契约侧投影＝contracts/http-api.openapi.json
//   三个 enum 段。提取语义与退役门禁 check-state-liveness 逐字对齐（extractArray/产出集收集/
//   钉子键集提取三函数同谓词），退役映射：
//   · 三源一致面 → 本生成器 --check（derivation-sync 经 reuse-domains#state-layering 生成行纳保）；
//   · 任务机加产活面＋聚合入口在册面 → server/services/article-workflow/__tests__/
//     upload-task-status-liveness.test.cjs（领域认领测试，node --test）。
// 真身住址：
//   机① 审批五态   server/services/release-governance/approval-state-machine-service.cjs `const STATUSES`
//   机② 标准化三态 server/services/article-workflow/article-workflow-service.cjs 产出集字面量扫描
//       （无显式数组，值域单源=服务端产出字面量集——旧门禁同语义）
//   机③ 任务六态（派生①）server/services/article-workflow/article-upload-status.cjs `const TASK_STATUSES`
// 契约投影段（JSON 导航路径）：
//   /components/schemas/ApprovalStatusEnum/enum
//   /components/schemas/ArticleWorkflowTask/properties/status/enum
//   /components/schemas/PrecleanedArticleItem/properties/standardizationStatus/enum
// 前端钉子（src/lib/domain/StatusDisplay.ts _APPROVAL_NAIL/_STANDARDIZATION_NAIL/_TASK_NAIL）
//   仍手写（含人写中文显示文案，不生成），本生成器 --check 校验键集≡生成值域——键集漂移即红；
//   该对账保留在生成器内，不另设门禁。钉子类型本身挂 api-types 派生类型（契约加值 tsc 红的第二道）。
// 写入方式＝文本级定点替换（JSON.parse 重写会破坏全文格式）：每机一个结构锚正则，命中必须唯一
//   （≠1 即硬错不写），只替换 enum 数组项行；写后以「旧文档深拷贝＋三段替换」与实际写盘内容
//   deepEqual 验证——除三段 enum 外任何内容漂移即判失败不落盘（逐字节保留的机器证明）。
// 顺序纪律：机①③按服务端数组原序投影；机②产出集扫描无稳定序，按「存量契约序保序＋新增值按
//   出现序追加」棘轮投影（集合未变时逐字节零扰动，防纯重排噪音）。
// 用法：node scripts/quality/gen-value-domains.mjs           # --check 语义（投影漂移或钉子键集漂移 exit 1）
//       node scripts/quality/gen-value-domains.mjs --write   # 三机值域定点写 openapi
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.VALUE_DOMAINS_ROOT
  ? path.resolve(process.env.VALUE_DOMAINS_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OPENAPI = "contracts/http-api.openapi.json";
const UPLOAD = "server/services/article-workflow/article-upload-status.cjs";
const APPROVAL = "server/services/release-governance/approval-state-machine-service.cjs";
const SERVICE = "server/services/article-workflow/article-workflow-service.cjs"; // 机②真身住址之一（扫描窗=server/ 全仓，见 extractStandardizationProduced）
const DISPLAY = "src/lib/domain/StatusDisplay.ts";

// ── 真身抽取（与退役门禁同谓词）──

function extractArray(source, marker) {
  const m = source.match(new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`服务端枚举锚缺失: ${marker}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

// 红队 F1 修复（WP-133）：扫描窗从单文件扩到 server/ 全仓生产码——字面量迁出原文件时
//   单文件窗会让 --write 静默收窄契约枚举（红队夹具实测）；全仓窗＝扫描窗≡真实生产面。
//   谓词不变（同旧门禁三态字面量集）；排除 __tests__/.test.（夹具字面量不算产出）。
function collectServerSources(root) {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if ((name.endsWith(".cjs") || name.endsWith(".mjs")) && !name.includes(".test.")) out.push(fs.readFileSync(full, "utf8"));
    }
  })(root);
  return out;
}
function extractStandardizationProduced(serverRoot) {
  const produced = new Set();
  for (const src of collectServerSources(serverRoot)) {
    for (const m of src.matchAll(/"(pending_standardization|blocked|standardized)"/g)) produced.add(m[1]);
  }
  if (!produced.size) throw new Error("标准化机产出集扫描为空——server/ 全仓无三态字面量（真身漂移，拒绝投影空集——若该机确已退役，须走契约 tombstone 显式裁决，不得静默收窄）");
  return [...produced];
}

function extractKeys(source, marker, re) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`前端钉子锚缺失: ${marker}`);
  const segment = source.slice(start, start + 1600);
  const body = segment.slice(0, segment.indexOf("};") === -1 ? segment.length : segment.indexOf("};"));
  return [...body.matchAll(re)].map((m) => m[1]);
}

const KEY_RE = /^\s{2}([a-z_]+):\s*\{/gm;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
const diff = (a, b) => {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
};

// ── 契约投影段定位（JSON 导航）与文本定点替换 ──

function contractEnums(doc) {
  const at = (keys) => keys.reduce((node, k) => {
    if (node == null || typeof node !== "object" || !(k in node)) throw new Error(`契约投影段缺失: ${keys.join("/")}`);
    return node[k];
  }, doc);
  return {
    approval: at(["components", "schemas", "ApprovalStatusEnum", "enum"]),
    task: at(["components", "schemas", "ArticleWorkflowTask", "properties", "status", "enum"]),
    standardization: at(["components", "schemas", "PrecleanedArticleItem", "properties", "standardizationStatus", "enum"]),
  };
}

// 定点替换锚：结构锚（键名＋缩进＋"type": "string"＋"enum": [）在作用域内命中必须唯一，只换数组项行。
// scope＝作用域定界键对（全文同名键多处时先截取 schema 段再锚定——任务机 "status" 同形块全文 16 处，
// 必须 Scoped 到 ArticleWorkflowTask 段内；定界键带 ": {" 后缀只命中定义处不命中 $ref）。
const ENUM_BLOCK_ANCHORS = {
  approval: { re: /^ {6}"ApprovalStatusEnum": \{\n {8}"type": "string",\n {8}"enum": \[\n([\s\S]*?)\n {8}\]/m, indent: "          " },
  task: {
    scope: ['"ArticleWorkflowTask": {', '"ArticleUploadList": {'],
    re: /^ {10}"status": \{\n {12}"type": "string",\n {12}"enum": \[\n([\s\S]*?)\n {12}\]/m,
    indent: "              ",
  },
  standardization: { re: /^ {10}"standardizationStatus": \{\n {12}"type": "string",\n {12}"enum": \[\n([\s\S]*?)\n {12}\]/m, indent: "              " },
};

function spliceEnum(text, machine, values) {
  const anchor = ENUM_BLOCK_ANCHORS[machine];
  let start = 0;
  let end = text.length;
  if (anchor.scope) {
    const s = text.indexOf(anchor.scope[0]);
    const e = s === -1 ? -1 : text.indexOf(anchor.scope[1], s + 1);
    if (s === -1 || e === -1) throw new Error(`定点替换作用域锚缺失（${machine}: ${anchor.scope.join(" → ")}）——openapi 结构漂移，拒绝写入`);
    start = s;
    end = e;
  }
  const scope = text.slice(start, end);
  const matches = [...scope.matchAll(new RegExp(anchor.re.source, anchor.re.flags + "g"))];
  if (matches.length !== 1) throw new Error(`定点替换锚不唯一（${machine} 作用域内命中 ${matches.length} 处）——openapi 格式漂移，拒绝写入`);
  const m = matches[0];
  const [whole, oldBody] = m;
  const body = values.map((v, i) => anchor.indent + JSON.stringify(v) + (i < values.length - 1 ? "," : "")).join("\n");
  const bodyAt = whole.indexOf(oldBody);
  const newWhole = whole.slice(0, bodyAt) + body + whole.slice(bodyAt + oldBody.length);
  const absAt = start + m.index;
  return text.slice(0, absAt) + newWhole + text.slice(absAt + whole.length);
}

// 机②棘轮序：存量契约序保序∩新集，新增值按出现序追加（集合未变→原序原样，零扰动）
function ratchetOrder(prevContract, produced) {
  const kept = prevContract.filter((v) => produced.includes(v));
  const added = produced.filter((v) => !prevContract.includes(v));
  return [...kept, ...added];
}

function expectedDocAfterWrite(oldDoc, domains) {
  const next = structuredClone(oldDoc);
  next.components.schemas.ApprovalStatusEnum.enum = [...domains.approval];
  next.components.schemas.ArticleWorkflowTask.properties.status.enum = [...domains.task];
  next.components.schemas.PrecleanedArticleItem.properties.standardizationStatus.enum = [...domains.standardization];
  return next;
}

// ── 主流程 ──

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

function collectDomains() {
  const approval = extractArray(read(APPROVAL), "const STATUSES");
  const task = extractArray(read(UPLOAD), "const TASK_STATUSES");
  const produced = extractStandardizationProduced(path.join(ROOT, "server"));
  const prevStd = contractEnums(JSON.parse(read(OPENAPI))).standardization;
  return { approval, task, standardization: ratchetOrder(prevStd, produced) };
}

function checkNails(domains) {
  const display = read(DISPLAY);
  const nails = {
    approval: extractKeys(display, "_APPROVAL_NAIL", KEY_RE),
    standardization: extractKeys(display, "_STANDARDIZATION_NAIL", KEY_RE),
    task: extractKeys(display, "_TASK_NAIL", KEY_RE),
  };
  const names = { approval: "审批机", standardization: "标准化机", task: "任务派生①" };
  for (const machine of Object.keys(domains)) {
    if (sameSet(domains[machine], nails[machine])) {
      ok(`${names[machine]}钉子键集≡生成值域（${domains[machine].length} 值）`);
    } else {
      fail(`${names[machine]}钉子键集漂移：生成值域${JSON.stringify(domains[machine])} 前端钉子${JSON.stringify(nails[machine])}——缺${JSON.stringify(diff(domains[machine], nails[machine]))} 死显示键${JSON.stringify(diff(nails[machine], domains[machine]))}（StatusDisplay.ts 手改键集，文案不动）`);
    }
  }
}


// ── 红队 F2：契约锚唯一面——三机值集在全文档只许命中各自投影段一处（重复枚举副本＝ADR-015
//   副本漂移类，旧门禁 contractEnumAt 的「锚不唯一」面在此等价承接；值集复用误伤方向已按旧判据退役）。
function assertProjectionUnique(doc, machines) {
  const hits = { dup: [] };
  const text = JSON.stringify(doc);
  for (const m of machines) {
    const setKey = JSON.stringify([...m.values].sort());
    // 值集作为 enum 数组出现次数：序列化后匹配 ""enum":[...set...]" 精确数组形态
    const re = new RegExp('"enum":\\s*\\[\\s*' + m.values.map((v) => `"${v}"`).join(",\\s*") + '\\s*\\]', "g");
    const n = (text.match(re) || []).length;
    if (n > 1) hits.dup.push(`${m.label} 值集命中 ${n} 处（投影段之外存在重复枚举副本）`);
  }
  return hits.dup;
}
const writeMode = process.argv.includes("--write");
const domains = collectDomains();

if (writeMode) {
  const oldText = read(OPENAPI);
  const oldDoc = JSON.parse(oldText);
  let text = oldText;
  for (const machine of ["approval", "task", "standardization"]) {
    text = spliceEnum(text, machine, domains[machine]);
  }
  // 写盘前机器证明：实际将写入的内容 ≡ 旧文档仅三段 enum 替换（其余逐字节保留的内容级对等）
  const expected = expectedDocAfterWrite(oldDoc, domains);
  const actual = JSON.parse(text);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("state_value_domains=WRITE_ABORT——写后对账不符（三段之外发生漂移），未落盘");
    process.exit(1);
  }
  fs.writeFileSync(path.join(ROOT, OPENAPI), text);
  console.log(`state_value_domains=written approval=${domains.approval.length} task=${domains.task.length} standardization=${domains.standardization.length} → ${OPENAPI}（记得 npm run gen:api-types）`);
  checkNails(domains);
  if (failures > 0) process.exit(1);
  process.exit(0);
}

// --check：契约投影新鲜度（三机值域 ≡ openapi 三段）＋前端钉子键集对账
console.log("gen-value-domains：三机值域生成链校验（真身=服务端枚举源；投影=openapi 三段）");
let contract;
try {
  contract = contractEnums(JSON.parse(read(OPENAPI)));
} catch (e) {
  fail(`契约投影段定位失败：${e.message}`);
  process.exit(1);
}
const names = { approval: "审批机", task: "任务派生①", standardization: "标准化机" };
for (const machine of ["approval", "task", "standardization"]) {
  if (sameSet(domains[machine], contract[machine])) {
    ok(`${names[machine]}契约投影新鲜（${contract[machine].length} 值≡服务端真身）`);
  } else {
    fail(`${names[machine]}契约投影漂移：服务端${JSON.stringify(domains[machine])} 契约${JSON.stringify(contract[machine])}——缺${JSON.stringify(diff(domains[machine], contract[machine]))} 多${JSON.stringify(diff(contract[machine], domains[machine]))}；重跑 node scripts/quality/gen-value-domains.mjs --write`);
  }
}
checkNails(domains);

// 红队 F2：契约锚唯一面——三机值集全文档只许命中投影段一处（重复枚举副本＝ADR-015 副本漂移类）
const dup = assertProjectionUnique(JSON.parse(read(OPENAPI)), [
  { label: names.approval, values: domains.approval },
  { label: names.task, values: domains.task },
  { label: names.standardization, values: domains.standardization },
]);
for (const d of dup) fail(d);

if (failures > 0) {
  console.error(`state_value_domains=FAIL errors=${failures}`);
  process.exit(1);
}
console.log("state_value_domains=ok machines=3 projection=contract nails=handwritten enum_unique=ok");
