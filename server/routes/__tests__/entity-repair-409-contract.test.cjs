// Component: Entity-Repair-409-Contract-Routes-Test
// @responsible: PR-012 回归——repair preview/apply 三码族 409 直达客户端（不被 enforce 500 化）。
//   真实 HTTP 层验证（enforce 默认开）：不带 revision 调 preview → 409+SOURCE_CHANGED 原样外泄。
//   复现路径与 9-30 核实复现同构（minimal-vault 副本 + 真实 server/main.cjs）。
// @context: Sync（node --test；server/routes/__tests__ 发现规则）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_VAULT = path.join(REPO_ROOT, "test", "fixtures", "minimal-vault");

// 红队复核处置（PR-116 附批）：原硬编码 18097——同文件并发双开（或端口被占）时请求会
// 打到另一实例（健康探测被对方应答、夹具却不同源 → error_code undefined 式莫名红）；
// 实测复现见 docs/recon/2026-10-26-pr116-redteam.md。改 freePort（unmounted-subject 同式）。
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

function http(method, url, body) {
  const cmd = [
    "-sS", "--noproxy", "*", "-o", "/dev/null", "-w", "%{http_code}",
    "-X", method, url, "-H", "Content-Type: application/json",
  ];
  if (body) cmd.push("-d", JSON.stringify(body));
  const r = spawnSync("curl", cmd, { encoding: "utf8", timeout: 15000 });
  return Number(r.stdout || 0);
}

function httpBody(method, url, body) {
  const cmd = ["-sS", "--noproxy", "*", "-X", method, url, "-H", "Content-Type: application/json"];
  if (body) cmd.push("-d", JSON.stringify(body));
  const r = spawnSync("curl", cmd, { encoding: "utf8", timeout: 15000 });
  try { return JSON.parse(r.stdout); } catch { return { _raw: r.stdout }; }
}

async function withServer(t, env, fn) {
  // PR-116：真进程起 main.cjs 必须钉持久层目录——此前缺省落 repo data/derived-index.db，
  // boot 全量重建把夹具（fixture-component）写进任务树持久层（本机两树实测各 1 行）。
  // 缺省即临时目录（调用方显式给出时不覆盖）；SPEC-012「e2e/单测显式注入」同构。
  const dataDir = env.KB_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "pr012-data-"));
  t.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 尽力清理 */ } });
  const port = await freePort();
  const child = spawn("node", [path.join(REPO_ROOT, "server", "main.cjs")], {
    env: { ...process.env, ...env, KB_DATA_DIR: dataDir, API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = "";
  child.stdout.on("data", (d) => { ready += d.toString(); });
  t.after(() => { child.kill("SIGKILL"); });
  const deadline = Date.now() + 30000;
  const base = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    if (/readyState.{0,20}ready|listening/i.test(ready)) break;
    const probe = http("GET", `${base}/api/health`);
    if (probe === 200) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await fn(base);
}

test("PR-012: 不带 revision 调 preview → 409+SOURCE_CHANGED 直达（enforce 不再 500 化）", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr012-regress-"));
  fs.cpSync(FIXTURE_VAULT, vault, { recursive: true });
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  // 制造 sourceRevision 冲突：传一个格式合法（契约 contentHash 形状 sha256:<64hex>）但必然不匹配的 revision
  //（PR-085 第 1 步起契约形状校验先于服务层比对——格式非法会先得 400 VALIDATION_ERROR，而非进入 409 比对）
  const wrongRevision = { mtimeMs: 1, size: 1, contentHash: "sha256:" + "0".repeat(64) };
  await withServer(t, { VAULT_PATH: vault }, async (base) => {
    const status = http("POST", `${base}/api/entity/repair/preview`, {
      sourceKey: "知识库/wiki/entities/fixture-component.md",
      changes: { title: "X" },
      sourceRevision: wrongRevision,
    });
    const body = httpBody("POST", `${base}/api/entity/repair/preview`, {
      sourceKey: "知识库/wiki/entities/fixture-component.md",
      changes: { title: "X" },
      sourceRevision: wrongRevision,
    });
    assert.equal(status, 409, `期望 409,实际 ${status},body=${JSON.stringify(body).slice(0,200)}`);
    assert.equal(body.error_code, "SOURCE_CHANGED", `error_code 应为 SOURCE_CHANGED,实际 ${body.error_code}`);
    assert.match(String(body.message || ""), /源文件已变化|已经存在/, "message 应为抛点人话文案");
  });
});

test("PR-012: apply 假 previewId → 409+PREVIEW_EXPIRED 直达", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr012-regress2-"));
  fs.cpSync(FIXTURE_VAULT, vault, { recursive: true });
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  await withServer(t, { VAULT_PATH: vault }, async (base) => {
    // apply 入口前置校验要求 confirmed===true（entity-repair-service.cjs:311），缺它 400 VALIDATION_ERROR
    const status = http("POST", `${base}/api/entity/repair/apply`, { previewId: "pr_nonexistent_000", confirmed: true });
    const body = httpBody("POST", `${base}/api/entity/repair/apply`, { previewId: "pr_nonexistent_000", confirmed: true });
    assert.equal(status, 409, `期望 409,实际 ${status}`);
    assert.equal(body.error_code, "PREVIEW_EXPIRED", `error_code 应为 PREVIEW_EXPIRED,实际 ${body.error_code}`);
  });
});
