#!/usr/bin/env node
// 运行所有 E2E 测试
// 用法（默认自起受控服务栈，复用域 runtime-scope 波1／PR-120）：
//   VAULT_PATH=/tmp/cheese-e2e node scripts/e2e/run-all-e2e.mjs
// 外部服务形态（须自行起一个 VAULT_PATH=fixture 的服务；守卫仍向其取 /api/health.vaultId 对账，不等即拒跑）：
//   E2E_EXTERNAL_SERVER=1 API_BASE=http://127.0.0.1:18099 BASE_URL=http://127.0.0.1:5199 VAULT_PATH=... node scripts/e2e/run-all-e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// SPEC-011 WP1：e2e 物理隔离守卫——禁止写入真实 vault
import { requireE2EVault, requireE2EServiceScope } from "./lib/e2e-env.mjs";
import { startE2EStack } from "./lib/e2e-server.mjs";
// WP-189 probe runner 的解释器解析走单点（ADR-002：调用点禁止裸 python3／自写回退）
import { resolvePythonPath } from "../../server/shared/python-path.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT_PATH = requireE2EVault(); // 守卫验证后返回绝对路径
const EXTERNAL = process.env.E2E_EXTERNAL_SERVER === "1";

// WP-096（T3 迁移批 2026-11-06）：七条旅程全部迁 @playwright/test——旧自研断言件（record/observe
//   形态）退役删除，spec 顶替原槽位、流程名保持（e2e-baseline 豁免名单按名对账）、governance 保持
//   末位（其对同一 fixture 不可重入：注册 2.0 draft→冻结→推进指针，双执行必假红——收编方案实测结论）。
//   runner:"playwright"＝经运行器 CLI 跑，守卫/断言/trace 由 playwright.config.mjs 托管；
//   契约锚定（contract-anchor.mjs）与夹具构建（build-e2e-vault.mjs）复用不动。
const tests = [
  {
    name: "Persistence → F2 Replay Journey",
    script: "persistence-journey.spec.mjs",
    requiresVault: true,
    runner: "playwright",
  },
  {
    name: "Entity Compliance → Repair Flow",
    script: "entity-compliance-repair-flow.spec.mjs",
    requiresVault: true,
    runner: "playwright",
  },
  {
    name: "Relation Review → Approve Flow",
    script: "relation-review-approve-flow.spec.mjs",
    requiresVault: false,
    runner: "playwright",
  },
  {
    name: "Article Upload → Standardize Flow",
    script: "article-upload-standardize-flow.spec.mjs",
    requiresVault: false,
    runner: "playwright",
  },
  {
    name: "Schema Release → Promote Flow",
    script: "schema-release-promote-flow.spec.mjs",
    requiresVault: false,
    runner: "playwright",
  },
  {
    name: "GraphExplorer → Pipeline Integration",
    script: "dashboard-pipeline-integration-flow.spec.mjs",
    requiresVault: true,
    runner: "playwright",
  },
  {
    // WP-067：治理链全旅程（身份→注册→冻结→铸版→消费面→恢复）——真实通道防线
    name: "Governance Release Journey",
    script: "governance-release-journey.spec.mjs",
    requiresVault: true,
    runner: "playwright",
  },
  {
    // WP-189：契约巡检（OpenBKN api_contract_diff 整搬）——真打服务逐字段对账文档，
    // 旅程测试抓不到的文档漂移在此层。只读保证＝GET-only（零写请求）；
    // probe runner 参数见 buildProbeArgs()（动态 host-map＋运行时 id 种子）。
    // 退出码语义：0 无缺口 / 1 有缺口（文档漂移即红）/ 2 执行错误。
    name: "Contract Probe → API doc field-level reconciliation",
    script: "contract-probe/api_contract_diff.py",
    requiresVault: true,
    runner: "probe",
  },
];

// 单跑形态（npm run test:e2e:<key>）：--only 子串过滤 tests[]——流名与脚本路径仍由本表单源，
// 不在 package.json 另抄一份「别名→脚本文件」。抄第二份必漂移：eb05e587（WP-096/T3）删旧件改跑
// playwright 运行器后，五个 test:e2e:* 别名集体指向不存在的文件，至 2026-11-06 实测仍 MODULE_NOT_FOUND。
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : null;
})();
const selected = ONLY ? tests.filter((t) => t.name.toLowerCase().includes(ONLY.toLowerCase())) : tests;
if (ONLY && selected.length === 0) {
  console.error(`--only "${ONLY}" 未命中任何流（fail-closed，不静默跑全量）。tests[] 现行名：\n  ${tests.map((t) => t.name).join("\n  ")}`);
  process.exit(1);
}

// WP-189 probe runner 参数（在 main() 起栈后、进流前构建一次，经 env 传入 runTest）：
// host-map 按契约 /api/<顶层段>/ 逐段映射受控栈——上游 DISCOVERY 表为 OpenBKN 域数据，
// 不命中本仓段即零伪请求；--ids 从列表端点运行时深搜真实 id，取不到的参数名不进种子，
// 由 probe 报告如实记「缺少路径参数」（诚实优于硬凑）。
function buildProbeArgs(apiBase) {
  const repoRoot = path.join(__dirname, "..", "..");
  const contractPath = path.join(repoRoot, "contracts", "http-api.openapi.json");
  const spec = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const segments = new Set();
  for (const p of Object.keys(spec.paths ?? {})) {
    const m = p.match(/^\/api\/([^/{]+)/);
    if (m) segments.add(m[1]);
  }
  const hostMap = {};
  // 引擎 host_of 为 startswith 前缀匹配——裸键覆盖根路径（如 /api/health），带斜杠键覆盖子路径
  for (const s of segments) {
    hostMap[`/api/${s}`] = apiBase;
    hostMap[`/api/${s}/`] = apiBase;
  }
  // 报告落点目录按需创建——整搬件按原封形态直开文件（不建目录），目录缺失＝执行错误（退出 2）
  fs.mkdirSync(path.join(repoRoot, "scripts", "test-results", "contract-probe"), { recursive: true });
  return [
    "--spec-dir", contractPath,
    "--exec-mode", "direct",
    "--face", "ex",
    "--host-map", JSON.stringify(hostMap),
    // --ids 种子在 probe 流起跑时现取（seedIds）——旅程先改写夹具，数据态编号才取得到
    "--out", path.join(repoRoot, "scripts", "test-results", "contract-probe", "contract-probe-report.md"),
    "--json-out", path.join(repoRoot, "scripts", "test-results", "contract-probe", "contract-probe.json"),
  ];
}

// 运行时种子：只读 GET 列表端点深搜真实值。候选三元组＝（probe 参数名, 源端点, 响应内查找键名）
// ——查找键名可与参数名不同（edgeId↔edge_id；articleIds 数组取首元素，WP-198 七参数全覆盖，
// 源形态受控栈实测见设计稿§二）。进流前构建段串行发出；端点不可达/非 200/键不命中时该参数名
// 不进种子，probe 报告如实记 skip——诚实优于硬凑。
async function seedIds(apiBase) {
  const candidates = [
    ["issueId", "/api/anomalies", "issueId"],
    ["id", "/api/articles/precleaned", "id"],
    ["documentId", "/api/documents/search", "id"],
    ["edge_id", "/api/kg/pending-review", "edgeId"],
    ["articleId", "/api/articles/uploads", "articleIds"],
    ["taskId", "/api/articles/uploads", "taskId"],
    ["node", "/api/graph/master", "id"],
    ["product", "/api/kg/product-versions", "product"],
    ["version", "/api/kg/product-versions", "version"],
    ["sourceKey", "/api/entity/check", "sourceKey"],
    ["nodeId", "/api/graph/master", "id"],
  ];
  // documentId 命名空间兜底：本仓文档 id＝"entity:"+entityId（历史种子命中两回实证的仓内约定，
  // 非猜测格式——search 响应 id 为 null 态时的确定性重建；约定变更时该兜底自然 miss、probe 如实 skip）
  try {
    const res = await fetch(apiBase + "/api/entity/check", { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const eid = deepFind(await res.json(), "entityId", 0);
      if (eid !== undefined && eid !== null && eid !== "") ids.documentId = "entity:" + String(eid);
    }
  } catch { /* miss 照旧如实 skip */ }
  const ids = {};
  for (const [param, route, findKey] of candidates) {
    try {
      const res = await fetch(apiBase + route, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      let hit = deepFind(await res.json(), findKey, 0);
      if (Array.isArray(hit)) hit = hit.find((x) => x !== null && x !== undefined && x !== "");
      if (hit !== undefined && hit !== null && hit !== "") ids[param] = String(hit);
    } catch { /* 结构性不可达时留空，probe 如实记 skip */ }
  }
  return ids;
}

function deepFind(node, key, depth) {
  if (depth > 6 || node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFind(item, key, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (node[key] !== undefined && node[key] !== null && node[key] !== "") return node[key];
  for (const v of Object.values(node)) {
    const hit = deepFind(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function runTest(test, childEnv) {  return new Promise((resolve) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${test.name}`);
    console.log(`${"=".repeat(60)}\n`);

    if (test.requiresVault && !VAULT_PATH) {
      console.log(`⚠️  Skipping ${test.name} (requires VAULT_PATH)`);
      resolve({ name: test.name, skipped: true, exitCode: 0 });
      return;
    }

    const scriptPath = path.join(__dirname, test.script);
    // runner: "playwright"＝@playwright/test 运行器平行件（WP-096）：经运行器 CLI 跑，
    // 守卫/断言/trace 由 playwright.config.mjs 托管；
    // runner: "probe"（WP-189）＝python3 直调契约巡检整搬件（参数经 env 预构建）；
    // 其余仍为直跑脚本形态。
    const wire = (child) => {
    child.on("close", (code) => {
      // 红队复核 P2-3 假绿护栏：probe 退出码 0 但完成比对数为 0（全 skip/全非 200）
      // ＝口径假绿（全绿≠全验），按失败计；结果文件不可读同罪（fail-closed）。
      if (test.runner === "probe" && code === 0) {
        try {
          const args = JSON.parse(childEnv.CONTRACT_PROBE_ARGS ?? "[]");
          const jsonOut = args[args.indexOf("--json-out") + 1];
          const ops = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
          const compared = ops.filter((o) => "actual" in o).length;
          if (compared === 0) {
            console.error(`❌ probe 假绿护栏：退出码 0 但完成比对数为 0（全部跳过）——按失败计（红队 P2-3）`);
            resolve({ name: test.name, exitCode: 1, passed: false });
            return;
          }
        } catch (e) {
          console.error(`❌ probe 假绿护栏：巡检结果文件不可读（${e?.message}）——按失败计`);
          resolve({ name: test.name, exitCode: 1, passed: false });
          return;
        }
      }
      resolve({
        name: test.name,
        exitCode: code,
        passed: code === 0,
      });
    });

    child.on("error", (error) => {
      console.error(`Error running ${test.name}:`, error);
      resolve({
        name: test.name,
        exitCode: 1,
        passed: false,
        error: error.message,
      });
    });
    };

    if (test.runner === "probe") {
      // WP-198：--ids 种子在 probe 流起跑时现取（此时旅程已改写夹具——上传/清单数据
      // 就位，数据态编号 articleId/taskId/documentId… 才取得到）；净态空数据照旧如实 skip。
      (async () => {
        try {
          const staticArgs = JSON.parse(childEnv.CONTRACT_PROBE_ARGS ?? "[]");
          const seeds = await seedIds(childEnv.API_BASE ?? "http://127.0.0.1:18083");
          wire(spawn(resolvePythonPath(), [scriptPath, ...staticArgs, "--ids", JSON.stringify(seeds)], { env: childEnv, stdio: "inherit" }));
        } catch (e) {
          console.error(`Error building probe seeds:`, e);
          resolve({ name: test.name, exitCode: 1, passed: false, error: e?.message });
        }
      })();
      return;
    }

    const child = test.runner === "playwright"
      ? spawn(process.execPath, [path.join(__dirname, "..", "..", "node_modules", "@playwright", "test", "cli.js"), "test", scriptPath, "--config", path.join(__dirname, "playwright.config.mjs")], { env: childEnv, stdio: "inherit" })
      : spawn(process.execPath, [scriptPath], { env: childEnv, stdio: "inherit" });
    wire(child);
  });
}

/** 零脏终检快照：宿主仓 data/ 的 git 状态（含未跟踪）＋真库 drafts 文件数（真库经 .env VAULT_PATH 单源取）。 */
function snapshotSafety() {
  let repoData = "";
  try {
    repoData = execFileSync("git", ["-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=all", "--", "data/"], { cwd: path.resolve(__dirname, "..", ".."), encoding: "utf8" }).trim();
  } catch { repoData = "(git status 不可读)"; }
  let realDrafts = -1;
  try {
    const envLine = fs.readFileSync(path.resolve(__dirname, "..", "..", ".env"), "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
    if (envLine) {
      const realVault = envLine.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      realDrafts = fs.readdirSync(path.join(realVault, "知识库", "raw", "drafts"), { withFileTypes: true }).filter((e) => e.isFile()).length;
    }
  } catch { realDrafts = -1; }
  return { repoData, realDrafts };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║          E2E Test Suite - All Flows                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // 零脏终检基线（PR-120 验收③，机器固化）：跑流前快照宿主仓 data/ 与真库 drafts，
  // 全部流跑完（含栈停止）后对账——e2e 不得让两者出现任何新增（含未跟踪文件）。
  const safetyBaseline = snapshotSafety();
  const safetyCheck = () => {
    const after = snapshotSafety();
    const diffs = [];
    if (after.repoData !== safetyBaseline.repoData) diffs.push(`宿主仓 data/ 出现脏文件：\n${after.repoData}`);
    if (after.realDrafts !== safetyBaseline.realDrafts) diffs.push(`真库 drafts 文件数变化：${safetyBaseline.realDrafts} → ${after.realDrafts}`);
    return diffs;
  };


  // 作用域：默认自起受控栈（服务与其 spawn 的管线全部钉临时目录／fixture）；外部形态须过服务端作用域证明。
  let stack = null;
  let BASE_URL;
  let API_BASE;
  let childEnv;
  if (EXTERNAL) {
    BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5174";
    API_BASE = process.env.API_BASE || "http://127.0.0.1:18083";
    await requireE2EServiceScope(API_BASE, VAULT_PATH); // 不等即抛，exit 1
    childEnv = { ...process.env, BASE_URL, API_BASE, VAULT_PATH };
  } else {
    stack = await startE2EStack({ vaultPath: VAULT_PATH });
    BASE_URL = stack.baseUrl;
    API_BASE = stack.apiBase;
    childEnv = { ...stack.env, BASE_URL, API_BASE };
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Base: ${API_BASE}${stack ? "（自起受控栈）" : "（外部服务，作用域已证明）"}`);
  console.log(`Vault Path: ${VAULT_PATH}\n`);
  if (ONLY) console.log(`⚠ 局部跑（--only "${ONLY}"）：${selected.length}/${tests.length} 条流——报告标 only，基线门禁不据此判定\n`);

  // WP-189：probe 流参数在起栈后、进流前构建一次（host-map 需真实 API_BASE；--ids 种子
  // 需栈上列表端点可读），经 env 传入 runTest 的 python 直调。
  if (selected.some((t) => t.runner === "probe")) {
    childEnv.CONTRACT_PROBE_ARGS = JSON.stringify(buildProbeArgs(API_BASE));
  }

  const startTime = Date.now();
  const results = [];

  try {
    for (const test of selected) {
      const result = await runTest(test, childEnv);
      results.push(result);
    }
  } finally {
    if (stack) {
      // PR-166 回归固化（WP-047）：有流失败即倾倒受控栈服务端日志尾——flake（如文章 promote
      // 间歇 500）的根因只在这份日志里，此前非 verbose 轮失败即丢证，红一次瞎一次。
      const failedFlows = results.filter((r) => !r.passed && !r.skipped);
      if (failedFlows.length > 0) {
        const tail = Object.entries(stack.logs)
          .map(([k, v]) => `--- ${k} 末 60 行 ---\n${v.split("\n").slice(-60).join("\n")}`)
          .join("\n");
        console.error(`\n❌ ${failedFlows.length} 条流失败——受控栈服务端日志尾（失败自取证，PR-166）:\n${tail}`);
        try {
          fs.mkdirSync(path.join(__dirname, "..", "..", "test-results"), { recursive: true });
          fs.writeFileSync(path.join(__dirname, "..", "..", "test-results", "e2e-stack-logs-on-failure.log"), tail + "\n");
        } catch { /* 落盘尽力而为，主证据已在 stderr */ }
      }
      await stack.stop();
    }
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // 零脏终检（PR-120 验收③）：栈已停、全部流跑完后对账——不等即计失败，退出码非 0
  const safetyDiffs = safetyCheck();
  if (safetyDiffs.length > 0) {
    results.push({ name: "Safety Net（零脏终检：宿主仓 data/ 与真库 drafts）", exitCode: 1, passed: false });
    for (const d of safetyDiffs) console.error(`❌ ${d}`);
  } else {
    console.log("✓ 零脏终检：宿主仓 data/ 与真库 drafts 与跑前一致");
  }

  // 生成总结报告
  console.log("\n\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                   Test Results Summary                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  results.forEach((result, index) => {
    const status = result.skipped ? "⊘ SKIPPED" : result.passed ? "✓ PASSED" : "✗ FAILED";
    console.log(`${index + 1}. ${status}  ${result.name}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = results.length;

  console.log("\n" + "─".repeat(60));
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log(`Duration: ${duration}s`);
  console.log("─".repeat(60) + "\n");

  // 保存结果
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    apiBase: API_BASE,
    vaultPath: VAULT_PATH,
    ownStack: Boolean(stack),
    only: ONLY, // 非 null＝局部跑：e2e-baseline 据此拒绝判定（局部绿冒充全量基线是假绿形态）
    scopePins: stack ? { KB_DATA_DIR: stack.env.KB_DATA_DIR, PIPELINE_TRAJECTORIES_DIR: stack.env.PIPELINE_TRAJECTORIES_DIR, THESCHEMA_DIR: stack.env.THESCHEMA_DIR } : null,
    duration: `${duration}s`,
    summary: {
      total,
      passed,
      failed,
      skipped,
    },
    results: results,
  };

  const reportPath = path.join(process.cwd(), "test-results", "e2e-all-tests-summary.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Full report saved: ${reportPath}\n`);

  // 退出码
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err?.message || err);
  process.exit(1);
});
