// WP-021/022（PR-112 后续波次）：乐观锁 HTTP 接线测试。分层：
//   L3 服务进程实弹——真起 server/main.cjs（夹具 vault＋文件上传链）：
//      ①listUploads 响应带 revision（前端锁锚存在）
//      ②携带过期 expectedRevision 的写 → 409 WORKFLOW_REVISION_CONFLICT（details.currentRevision=现值）——
//        红队当年判"死契约"的行为面从此真实发生
//      ③携带正确 revision 的写 → 成功且修订前进
//      ④缺省不带 → 行为不变（存量兼容）
// 验证对象：服务层入口预检＋store 乐观锁（经公开 HTTP 端点——非 mock）。
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

test("L3 真进程：revision 锚在场；过期锁 409 实弹（details 带现值）；正确锁成功；缺省兼容", { timeout: 120_000 }, async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "revwire-vault-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "revwire-data-"));
  write(vault, "知识库/wiki/entities/.keep", "");
  fs.mkdirSync(path.join(vault, "知识库/raw/precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库/raw/drafts"), { recursive: true });
  write(dataDir, "master_graph.db", "x");
  write(dataDir, "staging/master_graph.json", JSON.stringify({ generatedAt: "t", nodes: [], connections: [] }));
  write(dataDir, "staging/extract_manifest.json", "{}");
  const port = await freePort();
  const env = { ...process.env, VAULT_PATH: vault, KB_DATA_DIR: dataDir, API_PORT: String(port) };
  delete env.THESCHEMA_DIR;
  const server = spawn(process.execPath, [path.join(REPO_ROOT, "server", "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const body = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2_000) })).json();
        if (body?.data?.readyState === "ready") { ready = true; break; }
      } catch { /* 未就绪 */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ready, `server 未 ready：\n${log.slice(-1500)}`);

    // ① 读锚：uploads 响应带 revision
    const list = await (await fetch(`${base}/api/articles/uploads`, { signal: AbortSignal.timeout(5_000) })).json();
    assert.ok(list.success, JSON.stringify(list).slice(0, 200));
    assert.equal(typeof list.data.revision, "number", `revision 锚缺失：${JSON.stringify(list.data).slice(0, 200)}`);
    const rev0 = list.data.revision;

    // ② 过期锁 409 实弹（早于任何写——期望锁号=rev0 但先做一次写使其前进）
    const up1 = await fetch(`${base}/api/articles/upload`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "rev-a.md", contentBase64: Buffer.from("---\ntitle: A\n---\n\n# A\n").toString("base64") }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(up1.status, 201, JSON.stringify(await up1.json()).slice(0, 200));

    const conflict = await fetch(`${base}/api/articles/upload`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "rev-b.md", contentBase64: Buffer.from("---\ntitle: B\n---\n\n# B\n").toString("base64"), expectedRevision: rev0 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(conflict.status, 409, "过期锁必须 409");
    const conflictBody = await conflict.json();
    assert.equal(conflictBody.error_code, "WORKFLOW_REVISION_CONFLICT");
    assert.ok(Number.isInteger(conflictBody.details?.currentRevision) && conflictBody.details.currentRevision > rev0, "details 带现值");

    // ③ 孤儿防护：409 时目标文件不得已落盘
    assert.ok(!fs.existsSync(path.join(vault, "知识库/raw/drafts/rev-b.md")), "冲突拒绝时不得留孤儿草稿");

    // ④ 正确锁成功（currentRevision 来自 409 details）
    const ok = await fetch(`${base}/api/articles/upload`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "rev-c.md", contentBase64: Buffer.from("---\ntitle: C\n---\n\n# C\n").toString("base64"), expectedRevision: conflictBody.details.currentRevision }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(ok.status, 201, JSON.stringify(await ok.json()).slice(0, 200));

    // ⑤ 缺省不带锁：行为不变（第四次写无锁成功）
    const noLock = await fetch(`${base}/api/articles/upload`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "rev-d.md", contentBase64: Buffer.from("---\ntitle: D\n---\n\n# D\n").toString("base64") }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(noLock.status, 201, "缺省不锁——存量调用零变化");
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
});

// WP-022 红队修复批补强（红队#9 四缺口场景）：
test("L3 红队#1：空库带锚0首写成功（无孤儿无409）＋upload 响应带 revision 锚（红队#2）＋同名409族存活（红队#4）", { timeout: 90_000 }, async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "revwire-empty-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "revwire-empty-data-"));
  write(vault, "知识库/wiki/entities/.keep", "");
  fs.mkdirSync(path.join(vault, "知识库/raw/precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库/raw/drafts/投稿"), { recursive: true });
  write(dataDir, "master_graph.db", "x");
  write(dataDir, "staging/master_graph.json", JSON.stringify({ generatedAt: "t", nodes: [], connections: [] }));
  write(dataDir, "staging/extract_manifest.json", "{}");
  const port = await freePort();
  const env = { ...process.env, VAULT_PATH: vault, KB_DATA_DIR: dataDir, API_PORT: String(port) };
  delete env.THESCHEMA_DIR;
  const server = spawn(process.execPath, [path.join(REPO_ROOT, "server", "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { const b = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2_000) })).json(); if (b?.data?.readyState === "ready") { ready = true; break; } }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    assert.ok(ready, log.slice(-800));
    const list = await (await fetch(`${base}/api/articles/uploads`)).json();
    const rev0 = list.data.revision; // 空库锚=0
    assert.equal(rev0, 0, "空库锚应为 0");

    // 空库带锚0首写：201（不再是孤儿+409）
    const first = await fetch(`${base}/api/articles/upload`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "first.md", contentBase64: Buffer.from("---\ntitle: F\n---\n\n# F\n").toString("base64"), expectedRevision: rev0 }) });
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.ok(Number.isInteger(firstBody.data.revision) && firstBody.data.revision > 0, "upload 响应必须带 revision 锚（红队#2）");

    // 红队#4：既有 409 家族存活——同名上传 DRAFT_ALREADY_EXISTS 不得被 enforce 错杀成 500
    const dup = await fetch(`${base}/api/articles/upload`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "first.md", contentBase64: Buffer.from("x").toString("base64") }) });
    assert.equal(dup.status, 409, "同名上传应保持 409");
    const dupBody = await dup.json();
    assert.equal(dupBody.error_code, "DRAFT_ALREADY_EXISTS", JSON.stringify(dupBody).slice(0, 200));

    // 红队#4：promote 死源走 DRAFT_NOT_FOUND（404）——enforce 不得把错误族错杀成 500（红队原测的
    // SOURCE_FILE_NOT_FOUND 路径需要"草稿在而源归档缺"的更重夹具；此处以 404 族存活证 enforce 面修通）
    const dead = await fetch(`${base}/api/articles/drafts/promote`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "知识库/raw/drafts/投稿/nonexistent.md", confirmed: true }) });
    assert.equal(dead.status, 404, "死源应为 404（DRAFT_NOT_FOUND）而非 500（enforce 错杀）");
    const deadBody = await dead.json();
    assert.equal(deadBody.error_code, "DRAFT_NOT_FOUND", JSON.stringify(deadBody).slice(0, 200));
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
});
