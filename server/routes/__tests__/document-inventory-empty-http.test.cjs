"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFileSync, spawn } = require("node:child_process");

test("空 Vault 真进程：正式文档清单返回空态指引，不被响应契约拦成 500", { timeout: 60_000 }, async () => {
  const repo = path.resolve(__dirname, "../../..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-empty-http-"));
  const vault = path.join(root, "vault");
  const data = path.join(root, "data");
  const schema = path.join(vault, "知识库/TheSchema");
  fs.mkdirSync(path.join(vault, "知识库/wiki/articles"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库/wiki/entities"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库/wiki/sources"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库/raw/precleaned"), { recursive: true });
  fs.cpSync(path.join(repo, "data/theschema"), schema, { recursive: true });
  execFileSync("git", ["init", "-q", vault]);
  execFileSync("git", ["-C", vault, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-q", "-m", "empty"]);
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); });
  });
  const child = spawn(process.execPath, [path.join(repo, "server/main.cjs")], {
    env: { ...process.env, VAULT_PATH: vault, KB_DATA_DIR: data, THESCHEMA_DIR: schema, API_PORT: String(port), VAULT_GIT_LEDGER_DISABLE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (value) => { log += value; });
  child.stderr.on("data", (value) => { log += value; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
        if ((await response.json()).data?.readyState === "ready") { ready = true; break; }
      } catch { /* still booting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, `server 未 ready: ${log.slice(-1000)}`);
    let response;
    let body;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      response = await fetch(`http://127.0.0.1:${port}/api/documents/search`, { signal: AbortSignal.timeout(5_000) });
      body = await response.json();
      if (response.status !== 503 || body.error_code !== "DOCUMENT_INDEX_UNAVAILABLE") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(response.status, 200, `${JSON.stringify(body).slice(0, 600)}\n${log.match(/.{0,100}document-index-init-failed.{0,500}/)?.[0] || log.slice(-500)}`);
    assert.deepEqual(body.data.documents, []);
    assert.equal(body.data.dataSource, "worktree");
    assert.deepEqual(body.data.availability.kinds, ["no-formal-release"]);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
