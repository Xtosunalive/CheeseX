// @component: Playwright globalSetup——e2e 隔离守卫等价迁移（WP-096 / PR-233 试点批）
// @context: 与旧件头部守卫逐条同源（scripts/e2e/entity-compliance-repair-flow.e2e.mjs）：
//   ①requireE2EVault（三重拒绝：未设／真库／非 fixture）②requireE2EServiceScope
//   （脚本通道＋浏览器通道双作用域证明，PR-120＋2026-10-27 双通道补丁）③契约锚定
//   （防幽灵端点带病跑绿，#1828 家族）。任一不过＝运行器拒启，零测试执行（fail-closed）。
//   ④WP-138 R3（PR-262）：夹具 status 词表对账守卫（assertFixtureStatusVocabAligned）——
//   夹具 frontmatter／夹具词表里出现的每个 status 值必须命中产品词表，不命中即拒启。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import docLoadPort from "../../../server/shared/document-load-port.cjs";
import vocabLoadPort from "../../../server/shared/vocab-load-port.cjs"; // 词表装载端口（读产品主源/夹具词表唯一合法通道）
const vocabLoadPortBundle = (root) => {
  const f = vocabLoadPort.loadVocabBundle(root, { files: ["enums"] }).files.enums;
  return f && f.state === "present" && f.data ? f.data : null;
}; // 文档装载端口出口（宿主 require 接单点棘轮：唯一直连=document-load-port；WP-138 R3 集成态直修）
import { requireE2EVault, requireE2EServiceScope } from "./e2e-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * 产品 status 词表宿主（fail-closed：取不到即抛，不静默放行）。
 * 四受控值单源＝contracts/entity-readiness-rules.json statusMachine.values
 * （server/shared/status-domain.cjs statusFourValues 的语义宿主）；
 * legacy 键集单源＝产品主源 data/theschema/enums.yaml lifecycle.legacy_status_map
 * （normalizeStatus 存量迁移域——legacy 值可被归一进四值，算「产品词表命中」）。
 */
function loadProductStatusVocab() {
  const rulesPath = path.join(REPO_ROOT, "contracts", "entity-readiness-rules.json");
  let four;
  try {
    four = JSON.parse(fs.readFileSync(rulesPath, "utf8"))?.statusMachine?.values;
  } catch (e) {
    throw new Error(`E2E_GUARD: 产品状态机契约不可读（${rulesPath}）：${e?.message || e}`);
  }
  if (!Array.isArray(four) || four.length === 0) {
    throw new Error(`E2E_GUARD: 契约 statusMachine.values 缺失或为空（${rulesPath}）——夹具词表对账失去产品基准，拒绝运行`);
  }
  let legacyKeys = [];
  try {
    // 经词表装载端口读产品主源（回落档=data/theschema）；缺文件时端口给 absent 态＝无 legacy 映射面
    const productEnums = docLoadPort && vocabLoadPortBundle(REPO_ROOT);
    const legacy = productEnums?.lifecycle?.legacy_status_map;
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) legacyKeys = Object.keys(legacy);
  } catch (e) {
    throw new Error(`E2E_GUARD: 产品词表主源不可读（词表装载端口）：${e?.message || e}`);
  }
  return { four, legacyKeys };
}

/** 递归收集 dir 下全部 .md 文件绝对路径（目录不可读即抛——夹具结构异常不该被静默吞掉） */
function walkMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMdFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * WP-138 R3（PR-262）夹具 status 词表对账守卫：
 *   ① 夹具词表 lifecycle.status 每个值 ∈ 产品四受控值（夹具不得自造状态值）；
 *   ② 产品四受控值每个 ∈ 夹具词表 lifecycle.status（产品会盖章的值夹具必须收得下——
 *      PR-262 事故形状：系统盖章「灰度」不在夹具词表，修复旅程永远修不平）；
 *   ③ 夹具词表 default_status ∈ 产品四受控值；
 *   ④ 夹具全量 .md frontmatter 出现的每个 status 值 ∈ 四受控值 ∪ legacy 键集
 *      （legacy 值可经 normalizeStatus 归一，属产品词表命中；两者皆不属＝夹具自造，红）。
 * 任一不满足即抛错（playwright globalSetup 抛错＝运行器拒启、零测试执行——fail-closed）。
 * @param {string} vaultPath 经 requireE2EVault() 验证过的 fixture 绝对路径
 */
export function assertFixtureStatusVocabAligned(vaultPath) {
  const { four, legacyKeys } = loadProductStatusVocab();
  const fourSet = new Set(four);
  const frontmatterAllowed = new Set([...four, ...legacyKeys]);
  const violations = [];

  // ①②③ 夹具词表对账
  let fixtureLifecycle = null;
  try {
    const fixtureEnums = vocabLoadPortBundle(vaultPath);
    fixtureLifecycle = fixtureEnums?.lifecycle ?? null;
  } catch (e) {
    throw new Error(`E2E_GUARD: 夹具词表不可读（词表装载端口@vault）：${e?.message || e}`);
  }
  const fixtureStatus = Array.isArray(fixtureLifecycle?.status) ? fixtureLifecycle.status : [];
  for (const v of fixtureStatus) {
    if (!fourSet.has(v)) violations.push(`夹具词表 lifecycle.status 含产品状态机外的值「${v}」（四受控值：${four.join("、")}）`);
  }
  for (const v of four) {
    if (!fixtureStatus.includes(v)) violations.push(`产品盖章值「${v}」不在夹具词表 lifecycle.status——PR-262 形状（系统盖章值夹具收不下，修复旅程修不平）`);
  }
  const fixtureDefault = fixtureLifecycle?.default_status;
  if (typeof fixtureDefault !== "string" || !fourSet.has(fixtureDefault)) {
    violations.push(`夹具词表 default_status「${String(fixtureDefault)}」不在产品四受控值内（${four.join("、")}）`);
  }

  // ④ 夹具全量 .md frontmatter status 扫描（实体／文章造数全部覆盖）
  const kbDir = path.join(vaultPath, "知识库");
  const mdFiles = fs.existsSync(kbDir) ? walkMdFiles(kbDir) : [];
  if (mdFiles.length === 0) violations.push(`夹具 知识库/ 下没有任何 .md（${kbDir}）——夹具残缺，拒绝运行`);
  for (const file of mdFiles) {
    const rel = path.relative(vaultPath, file);
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch (e) {
      violations.push(`${rel}：不可读（${e?.message || e}）`);
      continue;
    }
    // 装载宿主 strict 通道：三边界（未闭合/非法 YAML/非对象）逐态诊断，不吞错（WP-138 R3 集成态直修——
    // 原手写正则切分触 runtime-scope ⑩装载唯一性红；夹具造数必须经文档装载宿主或登记理由，取前者）
    const parsed = docLoadPort.parseEntityDocumentStrict(content, rel);
    const diag = parsed.diagnostics || [];
    if (diag.length > 0) {
      violations.push(`${rel}：frontmatter 不可解析（${diag.map((d) => d.message).join("; ")}）——夹具造数必须是产品可接受的形状`);
      continue;
    }
    const fm = parsed.doc.frontmatter && Object.keys(parsed.doc.frontmatter).length > 0 ? parsed.doc.frontmatter : null;
    if (!fm) continue; // 无 frontmatter 的 md（如说明页）不涉状态域
    const raw = fm?.status;
    if (raw == null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (typeof v !== "string" || !frontmatterAllowed.has(v)) {
        violations.push(`${rel}：frontmatter status「${String(v)}」不在产品词表内（四受控值：${four.join("、")}；legacy 可归一值：${legacyKeys.join("、") || "无"}）`);
      }
    }
  }

  if (violations.length) {
    throw new Error(
      "E2E_GUARD: 夹具 status 域与产品词表对账失败（WP-138 R3／PR-262 fail-closed）——夹具只允许产品会接受的数据：\n"
      + violations.map((v) => `  - ${v}`).join("\n")
      + `\n  修复路径：夹具词表/实体造数由 scripts/e2e/lib/build-e2e-vault.mjs 从产品主源（data/theschema/enums.yaml lifecycle 段）构造，重建夹具即可对齐；`,
    );
  }
  return { four, legacyKeys, scannedMd: mdFiles.length };
}

export default async function playwrightGlobalSetup() {
  const vaultPath = requireE2EVault();
  // ④ 夹具 status 词表对账（WP-138 R3）：夹具构建完成后、任何测试执行前——词表越域即拒启
  const vocab = assertFixtureStatusVocabAligned(vaultPath);
  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5174";
  const apiBase = process.env.API_BASE || "http://127.0.0.1:18083";
  await requireE2EServiceScope(apiBase, vaultPath, { baseUrl });
  const { assertEndpointsInContract } = await import("./contract-anchor.mjs");
  assertEndpointsInContract([
    "GET /api/health",
    "GET /api/entity/check",
    "POST /api/entity/repair/preview",
  ]);
  process.stderr.write(`[pw-global-setup] 守卫通过：VAULT_PATH=${vaultPath} API_BASE=${apiBase} status词表=[${vocab.four.join("、")}] legacy=[${vocab.legacyKeys.join("、")}] 扫描md=${vocab.scannedMd}\n`);
}
