// @component: Persistence-F2-Replay-Journey——Playwright 迁移件（WP-096 T3 批）
// @context: 旧件 scripts/e2e/persistence-journey.e2e.mjs 的运行器层等价迁移——
//   断言集逐条同源（旧 record() 步 ↔ 本 expect/test.step 块），不借机改测试口径：
//   ①boot＋健康新字段（A 层断言）②③类写 → state-journal 落账 ③kill -9＋删 runtime-state.db
//   ④重启 → boot 按水位重放 ⑤一致性——状态恢复且流水零回声（F2 §四.12 演练的 e2e 化）。
//   本流全程无浏览器：自管 server（需要在流程中途 kill -9 并重启，不经共享栈）＋自管 vault 副本
//  （图族 boot 导入是消费式的——共享 fixture 会被本流首个 boot 吃掉图，故 cpSync 独立副本，旧件同因同解）。
//   守卫（vault/作用域）在 lib/playwright-global-setup.mjs 前置（共享栈面）；本流自管 server 的
//   vaultId 对账在 Phase1 内原地执行（旧件同位）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
// SPEC-011 WP1：e2e 物理隔离守卫（globalSetup 已前置，此处进程级再证——与旧件头部同形态）
import { requireE2EVault, buildE2EEnv, requireE2EServiceScope } from "./lib/e2e-env.mjs";

const sharedVault = requireE2EVault();
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 18110;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts) {
  const res = await fetch(`${BASE}${p}`, { headers: { "Content-Type": "application/json" }, ...opts });
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, body };
}

async function waitHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await api("/api/health");
      if (r.status === 200 && r.body?.data?.readyState === "ready") return r.body.data;
    } catch { /* 未起 */ }
    await sleep(500);
  }
  return null;
}

function journalLines(VAULT) {
  const jp = path.join(VAULT, ".ledger", "state-journal.jsonl");
  if (!fs.existsSync(jp)) return [];
  return fs.readFileSync(jp, "utf8").split("\n").filter((l) => l.trim());
}

test("持久层 F2 重放全旅程（③类写 → 流水落账 → 灾难 → boot 重放 → 状态一致）", async () => {
  // 两次 boot＋灾难间隙轮询，120s 默认可能吃紧——给足余量（断言语义不变）
  test.setTimeout(240_000);
  // 独立 vault 副本（PR-062 复盘修正）：图族 boot 导入是消费式（读 vault 旧件→入库→删件）——
  // 共享 fixture 会被本流首个 boot 吃掉图，殃及同轮其余流。本流全自管，不触碰共享 fixture 任何状态。
  const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "f2-journey-vault-"));
  fs.cpSync(sharedVault, VAULT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "f2-journey-"));
  const startServer = () => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "server", "main.cjs")], {
      // 作用域全集经单一构造器（runtime-scope 波1）：显式项在后覆盖——本流自管 dataDir/端口
      env: { ...buildE2EEnv(VAULT), KB_DATA_DIR: dataDir, API_PORT: String(PORT), VAULT_GIT_LEDGER_DISABLE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.log = "";
    child.stdout.on("data", (d) => { child.log += d.toString(); });
    child.stderr.on("data", (d) => { child.log += d.toString(); });
    return child;
  };

  let server = null;
  let totalBefore = -1; // Phase2 基线（旧件 totalBefore，Phase5 一致性对照用）
  let linesAtDisaster = 0; // Phase3 灾时流水水位（Phase5 零回声对照用）
  try {
    // ── 阶段 1：boot＋健康新字段（A 层断言）──
    await test.step("Phase1 boot + /api/health 新契约字段（SPEC-012 WP-B）", async () => {
      server = startServer();
      const health = await waitHealth();
      expect(health, "server 未就绪（waitHealth 60s 超时）").toBeTruthy();
      // 服务端作用域证明（runtime-scope 波1）：自管的 server 也要证 vaultId，不以端口推定
      const scope = await requireE2EServiceScope(BASE, VAULT);
      expect(scope.vaultId, "service scope vaultId 对账").toBeTruthy();
      expect(health.readyState, "health readyState=ready").toBe("ready");
      expect(
        typeof health.lastReconcileAt === "string" && health.lastReconcileAt.length > 0,
        `lastReconcileAt 非空（=${health.lastReconcileAt}）`,
      ).toBe(true);
      expect(health.reconcileStale, `reconcileStale=false（=${health.reconcileStale}）`).toBe(false);
    });

    // ── 阶段 2：③类写（API 触发）→ ⑤类流水落账 ──
    await test.step("Phase2 ③类写 → ⑤类流水落账", async () => {
      const before = await api("/api/anomalies?includeResolved=true");
      totalBefore = before.body?.data?.total ?? -1;
      expect(before.status, `GET /api/anomalies 200（total=${totalBefore}）`).toBe(200);
      // PR-085：契约无 requestBody 的操作禁止携带 body（空对象亦拒）——与前端 anomaly-workbench-api 同口径不带 body
      const rec = await api("/api/anomalies/reconcile", { method: "POST" });
      expect(rec.status === 200 || rec.status === 201, `POST /api/anomalies/reconcile（status=${rec.status}）`).toBe(true);
      await sleep(1500);
      const lines = journalLines(VAULT);
      const families = new Set(lines.map((l) => { try { return JSON.parse(l).family; } catch { return "?"; } }));
      expect(
        lines.length > 0,
        `state-journal.jsonl 存在且有事件（${lines.length} 行；族=${[...families].join(",")}）`,
      ).toBe(true);
      const channelLogPath = path.join(VAULT, ".ledger", "channel-write-log.jsonl");
      if (fs.existsSync(channelLogPath)) {
        const lastEntry = JSON.parse(fs.readFileSync(channelLogPath, "utf8").trim().split("\n").pop());
        expect(
          typeof lastEntry.path === "string" && String(lastEntry.contentHash).startsWith("sha256:") && ("domain" in lastEntry),
          "channel-write-log 形态（路径+哈希+域）",
        ).toBe(true);
      } else {
        console.log("• observe: channel-write-log（本流未触发 vault 写——形态执法由单测/真实 vault 承载）— skip-with-note");
      }
    });

    // ── 阶段 3：灾难模拟——kill -9 ＋ 删 runtime-state.db ──
    await test.step("Phase3 kill -9 + 删 runtime-state.db（§四.12 演练）", async () => {
      server.kill("SIGKILL");
      await sleep(800);
      for (const suf of ["", "-wal", "-shm"]) fs.rmSync(path.join(dataDir, `runtime-state.db${suf}`), { force: true });
      expect(
        !fs.existsSync(path.join(dataDir, "runtime-state.db")),
        "runtime-state.db 已删（含 WAL 边车）",
      ).toBe(true);
      linesAtDisaster = journalLines(VAULT).length;
    });

    // ── 阶段 4：重启 → boot 按水位重放 ──
    await test.step("Phase4 重启 + boot 重放", async () => {
      server = startServer();
      const h2 = await waitHealth();
      expect(h2, "重启后未就绪（waitHealth 60s 超时）").toBeTruthy();
      expect(h2.readyState, "重启后 readyState=ready").toBe("ready");
    });

    // ── 阶段 5：一致性——状态恢复且流水零回声 ──
    await test.step("Phase5 一致性核验", async () => {
      await sleep(1000);
      const after = await api("/api/anomalies?includeResolved=true");
      const totalAfter = after.body?.data?.total ?? -2;
      expect(after.status, `重放后 GET /api/anomalies 200（total=${totalAfter}）`).toBe(200);
      expect(
        totalAfter === totalBefore,
        `③类状态与灾前一致（重放生效）（before=${totalBefore} after=${totalAfter}）`,
      ).toBe(true);
      const linesAfterReplay = journalLines(VAULT).length;
      expect(
        linesAfterReplay === linesAtDisaster,
        `流水零回声（重放不记流水）（灾时=${linesAtDisaster} 重放后=${linesAfterReplay}）`,
      ).toBe(true);
    });
  } catch (err) {
    if (server?.log) console.error(`[f2-journey] server log tail:\n${server.log.split("\n").slice(-8).join("\n")}`);
    throw err;
  } finally {
    if (server) { try { server.kill("SIGKILL"); } catch { /* best-effort */ } }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(VAULT, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
