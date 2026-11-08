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
    name: "Dashboard → Pipeline Integration",
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
    // 守卫/断言/trace 由 playwright.config.mjs 托管；其余仍为直跑脚本形态。
    const child = test.runner === "playwright"
      ? spawn(process.execPath, [path.join(__dirname, "..", "..", "node_modules", "@playwright", "test", "cli.js"), "test", scriptPath, "--config", path.join(__dirname, "playwright.config.mjs")], { env: childEnv, stdio: "inherit" })
      : spawn(process.execPath, [scriptPath], { env: childEnv, stdio: "inherit" });

    child.on("close", (code) => {
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
