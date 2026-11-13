"use strict";
// PR-303 回归钉：跨文章脏闸——B 待审字节不得经 A 的发布/铸版进入 Release 工件
// 复现背景（Master 2026-11-14 疑点，双文章真进程复现坐实）：收集器曾打包 FORMAL_ROOT 全目录而无同批待审校验。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const net = require("node:net");
const crypto = require("node:crypto");

const VAULT_SOURCE = path.resolve(__dirname, "../../../test/fixtures/minimal-vault");
const B_DIRTY_MARK = "未批准的B外部改动XZXZ";

test("跨文章脏闸：B 待审时 A 发布/独立铸版 409；B 恢复后 A 发布 200 且工件无脏字节", { timeout: 120_000 }, async () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dirty-gate-"));
  process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-gate-");
  const fixtureDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-data-"));
  fs.cpSync(VAULT_SOURCE, vaultPath, { recursive: true });
  const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(vaultPath, rel)), { recursive: true }); fs.writeFileSync(path.join(vaultPath, rel), content); };
  write("知识库/wiki/entities/fixture-component.md", "---\ntitle: Fixture Component\narchitecture-node-id: fixture-component\narch_component: true\nmodule: fixture-module\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Fixture Component\n");
  write("知识库/wiki/entities/incomplete-component.md", "---\ntitle: Incomplete Component\narchitecture-node-id: incomplete-component\narch_component: true\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Incomplete Component\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: vaultPath });
  execFileSync("git", ["config", "user.email", "t@e.invalid"], { cwd: vaultPath });
  execFileSync("git", ["config", "user.name", "t"], { cwd: vaultPath });
  execFileSync("git", ["add", "-A"], { cwd: vaultPath });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: vaultPath });
  fs.writeFileSync(path.join(fixtureDataDir, "master_graph.db"), "");
  const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
  const store = getDerivedIndexStore(vaultPath);
  const graphRaw = fs.readFileSync(path.join(VAULT_SOURCE, ".ledger", "master_graph.json"), "utf8");
  store.artifacts.put("master_graph", graphRaw);
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  fs.mkdirSync(path.join(fixtureDataDir, "staging"), { recursive: true });
  fs.writeFileSync(path.join(fixtureDataDir, "staging", "master_graph.json"), graphRaw);
  fs.writeFileSync(path.join(fixtureDataDir, "staging", "extract_manifest.json"), '{"generatedAt":"volatile","files":{}}\n');
  {
    const yaml = require("yaml");
    const repo = yaml.parse(fs.readFileSync(path.resolve(__dirname, "../../../data/theschema/ontology.yaml"), "utf8")) || {};
    const fixtureOntology = path.join(vaultPath, "知识库/TheSchema/ontology.yaml");
    const target = fs.existsSync(fixtureOntology) ? (yaml.parse(fs.readFileSync(fixtureOntology, "utf8")) || {}) : {};
    if (repo.action_types) target.action_types = repo.action_types;
    if (repo.risk_types) target.risk_types = repo.risk_types;
    fs.writeFileSync(fixtureOntology, yaml.stringify(target));
  }
  fs.mkdirSync(path.join(vaultPath, "知识库/raw/drafts/投稿"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库/raw/drafts/投稿/cross-b.md"),
    "---\narticle_id: cross-b\ntitle: 跨批文章B\nproduct: FixtureProduct\nversion: \"1.0.0\"\nmodule: fixture-module\ncategory-path: ops:maintain\narticle_type: 排错指南\ndoc-type: 用户手册\ntags:\n  - b\narchitecture_associations: []\n---\n\nB 初版正文。\n");

  const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const v = s.address().port; s.close(() => resolve(v)); }); });
  const serverEnv = { ...process.env, VAULT_PATH: vaultPath, API_PORT: String(port), THESCHEMA_DIR: path.join(vaultPath, "知识库/TheSchema"), KB_DATA_DIR: fixtureDataDir, VAULT_GIT_LEDGER_DISABLE: "1", GRAPH_DRIFT_REFRESH: "0" };
  let child = spawn(process.execPath, [path.resolve(__dirname, "../../../server/main.cjs")], { env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (v) => { log += v; }); child.stderr.on("data", (v) => { log += v; });
  const request = async (method, endpoint, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    return { status: r.status, body: await r.json() };
  };
  const cleanup = () => { child.kill("SIGKILL"); try { fs.rmSync(vaultPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { } try { fs.rmSync(fixtureDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { } };
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { try { const r = await request("GET", "/api/health"); if (r.body?.data?.readyState === "ready") ready = true; } catch { } await new Promise((r) => setTimeout(r, 300)); }
    assert.ok(ready, "server ready:\n" + log.slice(-500));
    const refetch = async (id) => { const it = (await request("GET", "/api/articles/precleaned")).body.data.items.find((i) => i.id === id); return { sourcePath: it.sourcePath, contentHash: it.formalContentHash, title: it.title }; };
    const waitStatus = async (id, want) => { for (let i = 0; i < 20; i++) { const r = await request("GET", `/api/approval/status/${encodeURIComponent(id)}`); if (r.body.data && r.body.data.status === want) return true; await new Promise((r2) => setTimeout(r2, 300)); } return false; };
    const transition = (id, operation, input = {}) => request("POST", `/api/approval/${encodeURIComponent(id)}/transition`, { operation, input });

    // B 草稿→precleaned
    assert.equal((await request("POST", "/api/articles/drafts/validate", { filePath: "知识库/raw/drafts/投稿/cross-b.md" })).status, 200);
    assert.equal((await request("POST", "/api/articles/drafts/promote", { filePath: "知识库/raw/drafts/投稿/cross-b.md", confirmed: true })).status, 200);

    // A、B 各发布#1
    for (const id of ["fixture-candidate-001", "cross-b"]) {
      assert.equal((await request("POST", `/api/articles/precleaned/${encodeURIComponent(id)}/standardization`, { confirmed: true })).status, 200);
      assert.equal((await transition(id, "standardize", await refetch(id))).status, 200);
      assert.equal((await transition(id, "confirm", await refetch(id))).status, 200);
      const pub = await transition(id, "publish", await refetch(id));
      if (pub.status !== 200) {
        const lines = log.split(String.fromCharCode(10)).filter((l) => l.indexOf("DIRTY") >= 0);
        console.log(id + " 服务端脏点:", lines.slice(-2).join(" || ").slice(0, 900));
      }
      assert.equal(pub.status, 200, id + " 发布#1: " + JSON.stringify(pub.body).slice(0, 400));
    }

    // B 外部改动 → 待审（脏字节）
    const formalRoot = path.join(vaultPath, "知识库/wiki/articles");
    let bFormal = null; const findMd = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) findMd(p); else { try { if (fs.readFileSync(p, "utf8").includes("B 初版正文")) bFormal = p; } catch { } } } };
    findMd(formalRoot);
    assert.ok(bFormal, "B 正式文件定位");
    const bOriginal = fs.readFileSync(bFormal, "utf8");
    fs.appendFileSync(bFormal, `\n${B_DIRTY_MARK}\n`);
    assert.ok(await waitStatus("cross-b", "pending"), "B 回待审");

    // ① 独立铸版被闸（全净要求，无豁免）
    const mintDirty = await request("POST", "/api/releases/mint");
    assert.equal(mintDirty.status, 409, "铸版被跨文章脏闸拦: " + JSON.stringify(mintDirty.body).slice(0, 300));
    assert.equal(mintDirty.body.error_code, "RELEASE_CROSS_ARTICLE_DIRTY");

    // ② A 的再发布被闸（豁免仅本次快照；B 脏仍拦）
    let aFormal = null; const findA = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) findA(p); else { try { if (fs.readFileSync(p, "utf8").includes("测试候选文章")) aFormal = p; } catch { } } } };
    findA(formalRoot); assert.ok(aFormal, "A 正式文件定位");
    fs.appendFileSync(aFormal, "\nA 二次修改（正式区）\n");
    assert.ok(await waitStatus("fixture-candidate-001", "pending"), "A 回待审");
    assert.equal((await request("POST", "/api/articles/precleaned/fixture-candidate-001/standardization", { confirmed: true })).status, 200);
    assert.equal((await transition("fixture-candidate-001", "standardize", await refetch("fixture-candidate-001"))).status, 200);
    assert.equal((await transition("fixture-candidate-001", "confirm", await refetch("fixture-candidate-001"))).status, 200);
    const aBlocked = await transition("fixture-candidate-001", "publish", await refetch("fixture-candidate-001"));
    assert.equal(aBlocked.status, 409, "A 发布被跨文章脏闸拦: " + JSON.stringify(aBlocked.body).slice(0, 300));
    assert.equal(aBlocked.body.error_code, "RELEASE_CROSS_ARTICLE_DIRTY");
    assert.ok(JSON.stringify(aBlocked.body.details).includes("跨批文章B.md"), "脏文章点名");

    // ③ B 恢复已批准字节 → 闸判据＝字节与基线一致（审批态另由 SPEC-094 链管理）→ A 发布放行，新 Release 无脏字节
    fs.writeFileSync(bFormal, bOriginal);
    const aOk = await transition("fixture-candidate-001", "publish", await refetch("fixture-candidate-001"));
    assert.equal(aOk.status, 200, "B 恢复后 A 发布放行: " + JSON.stringify(aOk.body).slice(0, 300));
    const { resolveReleasesDir } = require("../../shared/releases-dir.cjs");
    const home = resolveReleasesDir({ vaultPath }).dir;
    const current = JSON.parse(fs.readFileSync(path.join(home, "current.json"), "utf8"));
    let artifactHit = null;
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else { try { if (fs.readFileSync(p, "utf8").includes(B_DIRTY_MARK)) artifactHit = p; } catch { } } } };
    walk(path.join(home, current.releaseId));
    assert.equal(artifactHit, null, "新 Release 工件零脏字节（曾实测泄漏——本闸回归锚）");
  } finally { cleanup(); }
});
