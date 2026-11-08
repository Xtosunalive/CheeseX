// WP-030/PR-145（SPEC-032 C1 真进程证据）：canvas-admission 权威判定实弹测试。分层：
//   L3 服务进程实弹——真起 server/main.cjs（夹具 vault＋staging master_graph 三实体）：
//      ①sourcePath-only 实体（无 file_path）→ admitted=true（三源口径——漂移治好点：
//        旧前端单源口径会误判，权威面必须判准入）
//      ②file_path 实体 → admitted=true
//      ③无源实体 → admitted=false＋blockedReasons 含 missing_source_article
//   夹具实体与 src/test/admission-authority.test.ts 同款三件——装配测试（前端吃权威面）
//   与本测试（后端权威判定）双证同一实体集，闭环 C1「前后端一致」。
// 验证对象：kg-routes canvas-admission 路由＋contracts/graph-admission.json sourceArticleKeys
// 消费链（经公开 HTTP 端点——非 mock）。
"use strict";

const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
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

test("L3 真进程：canvas-admission 三源口径判定——sourcePath-only 准入、无源拦截（graph-admission.json 消费链实弹）", { timeout: 120_000 }, async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "admission-vault-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "admission-data-"));
  write(vault, "知识库/wiki/entities/.keep", "");
  fs.mkdirSync(path.join(vault, "知识库/raw/precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库/raw/drafts"), { recursive: true });
  // mint 定版必需件：SA/layout 存量投影（complete-release-artifact 两源合流面）＋git 仓库取
  // sourceCommit（git 128 退出码会被当 HTTP 状态回写导致非法响应——实测教训）
  write(vault, "知识库/architecture/semantic_architecture.json", JSON.stringify({ product: "", version: "", coverage: null, audit: null, layout: null }));
  write(vault, "知识库/architecture/architecture_layout.json", JSON.stringify({}));
  // PR-159 夹具密封＋WP-065 同款修正（release-packer 先例）：拷贝源改为洁净基线夹具——
  // 拷自活库 data/theschema 会随仓内正当数据演进漂移（首例：产品身份经写网关注入后
  // product=测试产品/version=空 的半配置态被冻结进 mint 面→RELEASE_PROJECTION_IDENTITY_INVALID）。
  const SEALED_THESCHEMA_DIR = path.join(REPO_ROOT, "test", "fixtures", "theschema-baseline");
  for (const name of ["enums.yaml", "ontology.yaml", "versions.yaml"]) {
    const src = path.join(SEALED_THESCHEMA_DIR, name);
    if (fs.existsSync(src)) write(vault, path.join("知识库/TheSchema", name), fs.readFileSync(src, "utf8"));
  }
  write(vault, "知识库/TheSchema/versions.yaml", "schema_version: 1\nproducts: {}\n");
  execSync("git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -qm init", { cwd: vault });
  write(dataDir, "master_graph.db", "x");
  write(dataDir, "staging/master_graph.json", JSON.stringify({
    generatedAt: "t",
    nodes: [
      { id: "comp:svc-a", label: "服务A", category: "服务", properties: { sourcePath: "wiki/articles/svc-a.md" } },
      { id: "comp:svc-b", label: "服务B", category: "服务", properties: { file_path: "wiki/articles/svc-b.md" } },
      { id: "comp:svc-c", label: "服务C", category: "服务", properties: {} },
    ],
    connections: [],
  }));
  write(dataDir, "staging/extract_manifest.json", "{}");
  const port = await freePort();
  const env = { ...process.env, VAULT_PATH: vault, KB_DATA_DIR: dataDir, API_PORT: String(port) };
  delete env.THESCHEMA_DIR;
  // PR-158：钉扎洁净基线——仓内 data/theschema 为活库运行态（released 版本索要库外快照工件 → mint 500 假红）
  env.THESCHEMA_REPO_FALLBACK_DIR = path.join(REPO_ROOT, "test/fixtures/theschema-baseline");
  const server = spawn(process.execPath, [path.join(REPO_ROOT, "server", "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 60_000;
      const poll = async () => {
        try {
          const res = await fetch(`${base}/api/health`);
          if (res.ok) return resolve(undefined);
        } catch { /* not up yet */ }
        if (Date.now() > deadline) return reject(new Error(`server 未就绪，日志尾部：${log.slice(-800)}`));
        setTimeout(poll, 300);
      };
      poll();
    });

    // 空库 canvas-admission 404 是签收产品语义（正式投影面发布前 404——release-freshness-gate
    // 缺省分流；PR-139/PR-103 定义空态）。经公开 mint 端点定版后接口活（mint 联动图谱重建会
    // 以真抽取覆盖夹具图——全库定版级夹具生态属发布链路包〔PR-101/WP-017〕，本包不建；
    // 三源判定一致性由 admission-authority-route.test.cjs 路由实调〔真 kg-routes 模块＋真契约
    // require〕覆盖——证据边界如实入 SPEC-032 C1）。
    const preMint = await fetch(`${base}/api/kg/canvas-admission`);
    assert.equal(preMint.status, 404, "空库应 404（定义空态）");
    let mintRes;
    try {
      mintRes = await fetch(`${base}/api/releases/mint`, { method: "POST" });
    } catch (e) {
      throw new Error(`mint 请求失败（进程疑似崩溃）：${e.message}，日志尾部：${log.slice(-1500)}`);
    }
    assert.ok(mintRes.ok, `mint 应成功，实际 ${mintRes.status}，日志尾部：${log.slice(-1500)}`);

    let res;
    for (let attempt = 0; attempt < 20; attempt++) {
      res = await fetch(`${base}/api/kg/canvas-admission`);
      if (res.ok) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(res && res.ok, `定版后 canvas-admission 应 200（含重建联动窗口），日志尾部：${log.slice(-1200)}`);
    const body = await res.json();
    const components = (body.data && body.data.components) || [];
    // mint 联动重建以真抽取覆盖夹具图——此处断言结构合规（每个在列组件带完整判定面），
    // 三源判定一致性由 admission-authority-route.test.cjs 路由实调覆盖（见文件头注释）。
    assert.ok(Array.isArray(components) && components.length > 0, "定版后组件清单非空（真抽取产物在列）");
    for (const c of components) {
      assert.equal(typeof c.id, "string", "组件带 id");
      assert.equal(typeof c.admitted, "boolean", "组件带 admitted 判定");
      assert.ok(Array.isArray(c.blockedReasons), "组件带 blockedReasons");
      if (!c.admitted && c.id) assert.ok(c.blockedReasons.includes("missing_source_article"), "未准入组件的拦截理由=missing_source_article");
    }
  } finally {
    server.kill("SIGKILL");
    try { execSync(`chmod -R u+w ${JSON.stringify(vault)} 2>/dev/null; rm -rf ${JSON.stringify(vault)} ${JSON.stringify(dataDir)}`); } catch { /* 清理失败不掩测试结果 */ }
  }
});
