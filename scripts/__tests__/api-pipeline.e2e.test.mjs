import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gitFixtureEnv } from "../quality/shared/git-fixture-env.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureVaultPath = path.join(rootDir, "test", "fixtures", "minimal-vault");

function startApi(vaultPath, dataPath) {
  const child = spawn(process.execPath, [path.join(rootDir, "server", "main.cjs")], {
    cwd: rootDir,
    // KB_DATA_DIR＝SPEC-012 持久层测试缝（data-dir.cjs 注释明示「e2e 临时目录」用途）：
    // 不注入则 spawn 服务端打开所在树共享 data/（dev 服务真实运行态）——夹具检查被树间差异污染
    //（2026-10-16 实证：任务树绿/main 红，property total 1→2）。密闭化后两树判定一致。
    env: { ...process.env, API_PORT: "0", VAULT_PATH: vaultPath, KB_DATA_DIR: dataPath, GRAPH_DRIFT_REFRESH: "0" }, // PR-299：断图族自刷新——boot 后 CI 已完成 SA 重建（含 doc 节点入列 total=2）而本机未及（恒 1），两侧读数不可判定形态；断后一致读冻结槽
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = new Promise((resolve, reject) => {
    let buffer = "";
    let stderr = "";
    // 启动窗口 5s→30s（2026-09-27）：冷启动实测 ~6.3s（inference-engine + manifests rebuild + 82 路由
    // schema enforce 串联），慢机器/资源压力下 5s 必超时——假红（不该拦拦了，安全但挡门禁）。
    // 30s 与 parity 测试 bootServer 同口径；server-start 事件即 resolve，窗口宽不拖慢正常路径。
    const timeout = setTimeout(() => reject(new Error("API fixture startup timed out")), 30000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.event === "server-start") {
            clearTimeout(timeout);
            resolve(entry.port);
          }
        } catch (_error) {
          // Ignore non-JSON process output.
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`API fixture exited before startup with code ${code}: ${stderr.trim()}`));
    });
    child.once("error", reject);
  });

  return { child, ready };
}

test("minimal Vault keeps maintenance APIs available and dashboard live-reads without a Release (ADR067)", async () => {
  const vaultPath = mkdtempSync(path.join(tmpdir(), "api-pipeline-vault-"));
  const dataPath = mkdtempSync(path.join(tmpdir(), "api-pipeline-data-"));
  cpSync(fixtureVaultPath, vaultPath, { recursive: true });
  // seq163（#1325 盲区根治）：夹具 git spawn 一律走 gitFixtureEnv 净化——防 GIT_DIR 等
  // GIT_* 敌意上下文把夹具仓库重定向到宿主仓（第 6 次家族事故实录：夹具提交落真实分支）。
  const fixtureEnv = gitFixtureEnv(process.env);
  execFileSync("git", ["init", "-b", "main"], { cwd: vaultPath, stdio: "ignore", env: fixtureEnv });
  execFileSync("git", ["config", "user.name", "API Fixture"], { cwd: vaultPath, env: fixtureEnv });
  execFileSync("git", ["config", "user.email", "api-fixture@example.invalid"], { cwd: vaultPath, env: fixtureEnv });
  execFileSync("git", ["add", "."], { cwd: vaultPath, env: fixtureEnv });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: vaultPath, stdio: "ignore", env: fixtureEnv });
  // 落点断言（防御纵深）：夹具仓的 gitdir 必须位于 mktemp vaultPath 内——cwd 错位类
  // 泄漏（夹具命令落到真实工作树）在此处立即 fail-closed，而不是污染宿主仓后被事后取证。
  const fixtureGitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: vaultPath, encoding: "utf8", env: fixtureEnv }).trim();
  // macOS：/var → /private/var 符号链接，两侧都归一到 realpath 再比较
  assert.ok(
    fixtureGitDir.startsWith(realpathSync(vaultPath)),
    `fixture gitdir escaped vault: ${fixtureGitDir}`,
  );
  // PR-082：SA/layout 派生通用槽——夹具快照预置 dataPath/staging/sa/（走新链 boot 摄取入
  // derived-index.db；master_graph 仍由 boot legacy 导入器从夹具 .ledger/ 迁入）
  const saFixtureDir = path.join(fixtureVaultPath, "知识库", "architecture", "FixtureProduct", "1.0.0");
  mkdirSync(path.join(dataPath, "staging", "sa"), { recursive: true });
  cpSync(path.join(saFixtureDir, "semantic_architecture.json"), path.join(dataPath, "staging", "sa", "semantic_architecture.json"));
  cpSync(path.join(saFixtureDir, "architecture_layout.json"), path.join(dataPath, "staging", "sa", "architecture_layout.json"));
  const { child, ready } = startApi(vaultPath, dataPath);
  try {
    const port = await ready;
    const baseUrl = `http://127.0.0.1:${port}`;

    const health = await fetch(`${baseUrl}/api/health`).then((res) => res.json());
    assert.equal(health.success, true);
    assert.equal(health.data.status, "ok");
    assert.equal(health.data.service, "cheese");
    assert(health.data.capabilities.includes("pipeline"));

    // ADR067（#1775 契约迁移）：dashboard 恒活读工作投影——无 Release 也 success=true
    //（数据源单一化），不再 NO_CURRENT_RELEASE fail-closed；正式存档退回审计/版本对照职责。
    const dashboard = await fetch(`${baseUrl}/api/dashboard/topology?scope=full`).then((res) => res.json());
    assert.equal(dashboard.success, true);
    assert.equal(dashboard.data.dataSource, "worktree");
    assert.equal(dashboard.data.freshness, undefined);
    assert.ok(dashboard.data.workingRevision, "dashboard live-read → workingRevision present");

    const property = await fetch(`${baseUrl}/api/property/check?filter=all`).then((res) => res.json());
    assert.equal(property.success, true);
    // WP-138 取证强化：同一断言在 CI（Linux runner）稳定实得 2、本机与浅克隆整桶恒得 1，
    // 旧写法只留「2 !== 1」两个数字——多出来那项是谁、从哪条链进来，事后无从分辨（PR-275 同族：
    // 失败自取证不足以判据）。改由断言消息自带项身份，红一次即得一次可归因的现场。
    const propertyItems = Array.isArray(property.data.items) ? property.data.items : [];
    const propertyCensus = propertyItems
      .map((it) => `${it.componentId || "(无 id)"}|module=${it.module ?? "null"}|layer=${it.archLayer || "(空)"}|src=${it.sourcePath || "(无)"}|exists=${it.sourcePathExists}`)
      .join("  ;;  ");
    assert.equal(
      property.data.total,
      1,
      `property/check filter=all 期望 1 项，实得 ${property.data.total} 项（items 长度 ${propertyItems.length}）：${propertyCensus || "(空)"}`,
    );
    assert.equal(property.data.items[0].sourcePathExists, true);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    // PR-140：exit 事件≠句柄全释放（SQLite WAL 边车/孙进程收尾中）——rmSync 对 ENOTEMPTY/
    // EBUSY 内建重试（5×100ms）吸收瞬时竞态，消除全量批并发下的清理随机红（隔离恒绿实录在案）
    rmSync(vaultPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(dataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
