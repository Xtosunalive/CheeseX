// Assembly 集成测试：approval-state-machine-assembly（S5 快照单版本取代）
// 覆盖：publishArticle 先 snapshotArticle 后 collectCompleteArtifacts 时，snapshotArticle 写新哈希快照
// 必须取代同 article_id 的旧哈希快照——否则 collectCompleteArtifacts 的 scanFormalReleaseSources 按
// article_id 判重抛 DUPLICATE_DOCUMENT_ID（document-source-scanner.cjs:118）。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const net = require("node:net");
const yaml = require("yaml");
const { gitFixtureEnv } = require("../../../scripts/quality/shared/git-fixture-env.cjs");

const { registerApprovalStateMachine } = require("../release-governance/approval-state-machine-assembly.cjs");
const { createArticleWorkflowService } = require("../article-workflow/article-workflow-service.cjs");
const { createFormalEditService } = require("../article-workflow/formal-edit-service.cjs");
const { createVaultWatcherService } = require("../governance/vault-watcher-service.cjs");
const { createReleaseBuilderService } = require("../release-governance/release-builder-service.cjs");
const { createReleaseReaderService } = require("../release-governance/release-reader-service.cjs");

function git(args, cwd) {
  return execFileSync("git", args, { env: gitFixtureEnv(process.env), cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

// macOS 上 rmSync recursive 对含 0o444 Release 产物的深树会 ENOTEMPTY——先 chmod 再删（snapshot-store.test.cjs 同款模式）
function cleanTree(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) { try { fs.chmodSync(absolute, 0o755); } catch {} stack.push(absolute); }
      else { try { fs.chmodSync(absolute, 0o644); } catch {} }
    }
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

// 可被 collectCompleteArtifacts 完整消费的 git 仓库 fixture（minimal-vault + 必需派生产物）
// SPEC-012 wave-2 图族：图/清单真身迁 derived-index.db、master_graph.db 住 repo 侧 data/——
// 种子改种 store（fixture 图原文入行，物化字节与旧盘读一致）＋临时 KB_DATA_DIR
let fixtureDataDir = null;
function fixtureVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asm-assembly-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-pin-"); // Master 加固批：镜像写通道钉 /tmp
  const source = path.resolve(__dirname, "../../../test/fixtures/minimal-vault");
  fs.cpSync(source, root, { recursive: true });
  write(root, "知识库/wiki/entities/fixture-component.md", "---\ntitle: Fixture Component\narchitecture-node-id: fixture-component\narch_component: true\nmodule: fixture-module\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Fixture Component\n");
  write(root, "知识库/wiki/entities/incomplete-component.md", "---\ntitle: Incomplete Component\narchitecture-node-id: incomplete-component\narch_component: true\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Incomplete Component\n");
  git(["init", "-b", "main"], root);
  git(["config", "user.email", "test@example.invalid"], root);
  git(["config", "user.name", "Asm Test"], root);
  git(["add", "-A"], root);
  git(["commit", "-m", "fixture"], root);
  fixtureDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-assembly-data-"));
  process.env.KB_DATA_DIR = fixtureDataDir;
  write(fixtureDataDir, "master_graph.db", "");
  const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
  const store = getDerivedIndexStore(root);
  // fixture 图原文入行（minimal-vault 自带 .ledger/master_graph.json；物化走 stable 变换后与旧盘读等价）
  const graphRaw = fs.readFileSync(path.join(source, ".ledger", "master_graph.json"), "utf8");
  const extractRaw = '{"generatedAt":"volatile","files":{}}\n';
  store.artifacts.put("master_graph", graphRaw);
  store.artifacts.put("extract_manifest", extractRaw);
  write(fixtureDataDir, "staging/master_graph.json", graphRaw);
  write(fixtureDataDir, "staging/extract_manifest.json", extractRaw);
  return root;
}

function buildAssembly(vaultPath) {
  const logger = { info() {}, warn() {}, error() {} };
  return registerApprovalStateMachine({
    vaultPath,
    logger,
    articleWorkflowService: {
      // B2 实时探针（真实语义）：按 articleId 定位 precleaned 源文件、每次调用现算哈希——
      // 固定哈希 mock 掩盖了「探针值与存储 revision 同源恒等」的探针错配缺陷（定性文档 D2 §1.3）
      getPrecleaned: (articleId) => {
        // 精确 ${articleId}.md 优先；legacy fixture（article_id=001 ↔ 文件名 fixture-candidate.md）兜底
        const candidates = [path.join(vaultPath, "知识库", "raw", "precleaned", `${articleId}.md`), path.join(vaultPath, "知识库", "raw", "precleaned", "fixture-candidate.md")];
        for (const abs of candidates) {
          if (fs.existsSync(abs)) {
            return { standardizationStatus: "standardized", formalContentHash: sha256(fs.readFileSync(abs, "utf8")), sourcePath: path.relative(vaultPath, abs) };
          }
        }
        return { standardizationStatus: "pending_standardization", formalContentHash: null };
      },
    },
  });
}

async function standardizeToApproved(sm, articleId, H) { // PR-056：transition 异步化随迁
  await sm.transition(articleId, "standardize", {
    sourcePath: "知识库/raw/precleaned/fixture-candidate.md",
    contentHash: H,
    title: "测试候选文章",
    product: "FixtureProduct",
    version: "1.0.0",
  });
  await sm.transition(articleId, "confirm", { contentHash: H });
}

test("正式文章外部修改重检待审，旧 Release 不变，重新确认后再发布", async () => {
  const vaultPath = fixtureVault();
  try {
    let reader = null;
    const warnings = [];
    const logger = { info() {}, warn(entry) { warnings.push(entry); }, error() {} };
    const workflow = createArticleWorkflowService({ vaultPath, logger, getReleaseReader: () => reader });
    const articleId = "fixture-candidate-001";
    const candidate = workflow.getPrecleaned(articleId);
    workflow.standardize(articleId, true);
    const standardized = workflow.getPrecleaned(articleId);
    const sm = registerApprovalStateMachine({ vaultPath, logger, articleWorkflowService: workflow });
    await sm.transition(articleId, "standardize", { sourcePath: candidate.sourcePath, contentHash: standardized.formalContentHash });
    await sm.transition(articleId, "confirm", { sourcePath: candidate.sourcePath, contentHash: standardized.formalContentHash });
    const first = await sm.transition(articleId, "publish", { sourcePath: candidate.sourcePath, title: candidate.title });
    assert.equal(first.status, "snapshot");
    const releasesDir = path.join(vaultPath, ".releases");
    const builder = createReleaseBuilderService({ releasesDir, logger });
    reader = createReleaseReaderService({ builderService: builder, releasesDir });
    const oldVersion = workflow.readPublishedContent(articleId);
    const formalFile = path.join(vaultPath, first.snapshotPath);
    const edited = fs.readFileSync(formalFile, "utf8").replace("#", "# 外部编辑\n\n#");
    fs.writeFileSync(formalFile, edited);
    const processor = createFormalEditService({ vaultPath, articleWorkflowService: workflow, approvalStateMachine: sm, logger });
    const watcher = createVaultWatcherService({ vaultPath, logger, gitLedger: { scheduleLedger() {}, markSystemFile() {} }, onExternalWrite: (paths) => processor.handle(paths) });
    watcher.handleEventNow(formalFile);
    assert.equal(sm.getStatus(articleId).status, "pending", JSON.stringify(warnings));
    assert.equal(sm.getStatus(articleId).status, "pending");
    assert.equal(sm.getStatus(articleId).changeSummary.bodyChanged, true);
    assert.equal(workflow.readPublishedContent(articleId), oldVersion);
    assert.equal(processor.handle([formalFile])[0].changed, false);
    const changedCandidate = workflow.getPrecleaned(articleId);
    await sm.transition(articleId, "confirm", { sourcePath: changedCandidate.sourcePath, contentHash: changedCandidate.formalContentHash });
    const second = await sm.transition(articleId, "publish", { sourcePath: changedCandidate.sourcePath, title: changedCandidate.title });
    assert.notEqual(second.releaseId, first.releaseId);
    assert.match(workflow.readPublishedContent(articleId), /外部编辑/);
    assert.equal(sm.getStatus(articleId).status, "snapshot");
    const beforeBlocked = workflow.readPublishedContent(articleId);
    fs.appendFileSync(path.join(vaultPath, changedCandidate.sourcePath), "\n工作副本未提交改动\n");
    fs.writeFileSync(formalFile, fs.readFileSync(formalFile, "utf8").replace("product: FixtureProduct", "product: 不存在的产品"));
    watcher.handleEventNow(formalFile);
    const backups = fs.readdirSync(path.join(vaultPath, "知识库/raw/drafts")).filter((name) => name.includes("修改备份"));
    assert.equal(backups.length, 1, "正式文件同步前保留独立工作副本");
    assert.match(fs.readFileSync(path.join(vaultPath, "知识库/raw/drafts", backups[0]), "utf8"), /工作副本未提交改动/);
    assert.equal(sm.getStatus(articleId).status, "pending", "检查失败也必须撤销旧批准");
    assert.equal(workflow.getPrecleaned(articleId).standardizationStatus, "blocked");
    assert.equal(workflow.readPublishedContent(articleId), beforeBlocked);
    await assert.rejects(() => sm.transition(articleId, "confirm", { sourcePath: workflow.getPrecleaned(articleId).sourcePath }), /校验|变化|标准化/);
    fs.writeFileSync(formalFile, fs.readFileSync(formalFile, "utf8").replace("article_id: fixture-candidate-001", "article_id: changed-id"));
    watcher.handleEventNow(formalFile);
    assert.equal(sm.getStatus(articleId).status, "pending", "身份字段变更仍归旧审批身份待处理");
  } finally { cleanTree(vaultPath); }
});

test("HTTP 真进程：正式文件外部改动后状态与变更摘要经公开接口可读", { timeout: 90_000 }, async () => {
  const vaultPath = fixtureVault();
  const candidateFixture = "知识库/raw/precleaned/fixture-candidate.md";
  write(vaultPath, candidateFixture, fs.readFileSync(path.join(vaultPath, candidateFixture), "utf8")
    .replace(/^(title: .+)$/m, "$1\npreview_note: WP185 visible field"));
  const port = await new Promise((resolve, reject) => { const socket = net.createServer(); socket.once("error", reject); socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); }); });
  // WP-170：夹具基底本体缺 KnowledgeArticle（minimal-vault 精简 TheSchema）——注入（与 WP-161 节同款手法）
  {
    const yaml = require("yaml");
    const ontologyPath = path.join(vaultPath, "知识库/TheSchema/ontology.yaml");
    const definitions = yaml.parse(fs.readFileSync(ontologyPath, "utf8"));
    definitions.node_types = definitions.node_types || {};
    definitions.node_types.Document = { ...definitions.node_types.Document, allows_relations: ["DOCUMENTS", "REFERENCES", "MENTIONS", "APPLIES_TO", "BELONGS_TO", "HAS_SYMPTOM"] };
    definitions.node_types.KnowledgeArticle = { subClassOf: "Document", data_properties: { title: { required: true } } };
    // WP-171：drafts-validate 动作化后，动作注册表（vault 侧本体）须含新条目——夹具同步
    definitions.action_types = definitions.action_types || {};
    definitions.action_types["articles.drafts-validate"] = {
      http_route: "POST /api/articles/drafts/validate",
      executor: "article-workflow.drafts-validate",
      required_roles: [],
      preconditions: [],
      input_schema: { contract_ref: "POST /api/articles/drafts/validate requestBody" },
    };
    const shippingOntology = yaml.parse(fs.readFileSync(path.resolve(__dirname, "../../../data/theschema/ontology.yaml"), "utf8"));
    definitions.action_types["articles.status"] = shippingOntology.action_types["articles.status"];
    fs.writeFileSync(ontologyPath, yaml.stringify(definitions));
  }
  const wp170DataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp170-data-"));
  fs.mkdirSync(path.join(wp170DataDir, "staging"), { recursive: true });
  // 生产形态种子：py 落库形（nodes/connections）——与真实管线产物同构（review 路由读 connections）
  fs.writeFileSync(path.join(wp170DataDir, "staging", "master_graph.json"), JSON.stringify({
    _format_version: "1.0",
    nodes: [
      { id: "fixture-component", labels: ["Entity"], properties: { name: "Fixture Component" } },
      { id: "incomplete-component", labels: ["Entity"], properties: { name: "Incomplete Component" } },
    ],
    connections: [],
  }));
  const serverEnv = { ...process.env, VAULT_PATH: vaultPath, API_PORT: String(port), THESCHEMA_DIR: path.join(vaultPath, "知识库/TheSchema"), VAULT_GIT_LEDGER_DISABLE: "1", KB_DATA_DIR: wp170DataDir, GRAPH_DRIFT_REFRESH: "0" }; // WP-170：断图族自刷新（防枚举同步洗注入本体＋基底窗口），候选链确定性
  let child = spawn(process.execPath, [path.resolve(__dirname, "../../../server/main.cjs")], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let vite = null;
  let browser = null;
  child.stdout.on("data", (value) => { log += value; });
  child.stderr.on("data", (value) => { log += value; });
  const request = async (method, endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json(), retained: response.headers.get("X-Derivation-Retained") };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { const response = await request("GET", "/api/health"); if (response.body?.data?.readyState === "ready") { ready = true; break; } } catch { /* still booting */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert(ready, `server 未 ready: ${log.slice(-1200)}`);
    const id = "fixture-candidate-001";
    let reviewedEdgeId;
    const statusPath = `/api/articles/${id}/status`;
    const derivationPath = "/api/derivation/article";
    const initialDerivation = await request("GET", derivationPath);
    assert.equal(initialDerivation.status, 200, JSON.stringify(initialDerivation.body));
    assert.equal(initialDerivation.body.data.classId, "KnowledgeArticle");
    assert.equal(initialDerivation.body.data.apiRoutes.find(({ actionId }) => actionId === "articles.status").pathTemplate, "/api/articles/:id/status");
    const parameterized = await request("GET", statusPath);
    assert.equal(parameterized.body.data.article_id, id);
    assert.equal(parameterized.body.data.derivation_version, initialDerivation.body.data.version);
    const missing = await request("GET", "/api/articles/nonexistent-article/status");
    assert.equal(missing.status, 200, JSON.stringify(missing.body));
    assert.equal(missing.body.data.stage, "no_draft");
    assert.equal(missing.body.data.next_actions[0].action, "upload_draft");
    const standardized = await request("POST", `/api/articles/precleaned/${id}/standardization`, { confirmed: true });
    assert.equal(standardized.status, 200, JSON.stringify(standardized.body).slice(0, 500));
    // WP-169（SPEC-095 §3.1 首批）：预置候选无草稿快照→保守口径（有值=human/无值=not-extracted），三态闭合
    {
      const fp = standardized.body.data.fieldProvenance;
      assert.ok(fp && fp.title && fp.date && fp.module, "标准化响应必须携带受管字段来源标记");
      assert.ok(Object.values(fp).every((entry) => ["auto", "human", "not-extracted"].includes(entry.source)), "来源三态闭合");
      assert.equal(fp.title.source, "human", "无快照存量候选：有值按保守口径报 human（不冒认 auto）");
    }
    // WP-169 全链：直写草稿→真进程 validate（autoFill+快照落任务）→promote→标准化（快照合并报告）
    {
      const draftRel = "知识库/raw/drafts/投稿/wp169-全链来源.md";
      fs.mkdirSync(path.join(vaultPath, "知识库/raw/drafts/投稿"), { recursive: true });
      // 必填骨架对齐预置候选（product/version 等标准化硬门），受控变量：tags=人工、title/date/updated 留空（机械 auto）、module 留空（未提取到）
      fs.writeFileSync(path.join(vaultPath, ...draftRel.split("/")),
        "---\narticle_id: wp169-全链来源\nproduct: FixtureProduct\nversion: \"1.0.0\"\nmodule: fixture-module\ncategory-path: ops:maintain\ntags:\n  - 人工标签\narchitecture_associations: []\n---\n全链正文：本篇详述 Fixture Component 与 Incomplete Component 的协作。\n", "utf8");
      const validated = await request("POST", "/api/articles/drafts/validate", { filePath: draftRel });
      assert.equal(validated.status, 200, JSON.stringify(validated.body).slice(0, 400));
      const vfp = validated.body.data.fieldProvenance;
      assert.ok(vfp, "草稿校验响应必须携带 fieldProvenance");
      assert.equal(vfp.title.source, "auto", "空白标题→机械填（文件名）＝auto");
      assert.equal(vfp.tags.source, "human", "人工预填 tags＝human");
      assert.equal(vfp.module.source, "human", "人工 module＝human");
      assert.ok(vfp["doc-type"].source === "not-extracted" || vfp.article_type.source === "not-extracted", "留空可选字段＝未提取到");
      // 真实用户流：校验报告「未提取到」→人补填（模拟采纳建议的人工动作）
      const draftAbs = path.join(vaultPath, ...draftRel.split("/"));
      fs.writeFileSync(draftAbs, fs.readFileSync(draftAbs, "utf8").replace("module: fixture-module", "module: fixture-module\narticle_type: 排错指南\ndoc-type: 用户手册"), "utf8");
      const promoted = await request("POST", "/api/articles/drafts/promote", { filePath: draftRel, confirmed: true });
      assert.equal(promoted.status, 200, JSON.stringify(promoted.body).slice(0, 400));
      const newId = "wp169-全链来源";
      const chainStandardized = await request("POST", `/api/articles/precleaned/${encodeURIComponent(newId)}/standardization`, { confirmed: true });
      assert.equal(chainStandardized.status, 200, JSON.stringify(chainStandardized.body).slice(0, 400));
      const cfp = chainStandardized.body.data.fieldProvenance;
      assert.equal(cfp.title.source, "auto", "全链：快照携带 title=auto 到标准化报告");
      assert.equal(cfp.date.source, "auto", "全链：快照携带 date=auto");
      assert.equal(cfp.tags.source, "human", "全链：人工 tags 保持 human");
      assert.equal(cfp.module.source, "human", "全链：人工 module 保持 human");
      assert.equal(cfp.article_type.source, "human", "全链漂移合并：快照 not-extracted→人工补填→human");
      assert.equal(cfp.article_type.source, "human", "全链漂移合并：快照 not-extracted→人工补填→human");
      assert.equal(cfp["doc-type"].source, "human", "全链漂移合并：doc-type 同");
      // WP-170（SPEC-095 §3.2 首批）：标准化自动生成关系候选——正文提及实体→MENTIONS 待审边进既有审查流
      {
        // 候选异步落位（发射器有界重试＋摄取链）——轮询至出现或超时
        let pendingResp = null;
        let candidates = [];
        for (let i = 0; i < 30 && candidates.length === 0; i += 1) {
          pendingResp = await request("GET", "/api/kg/pending-review");
          const pendingEdges = (pendingResp.body.data && (pendingResp.body.data.edges || pendingResp.body.data.pendingEdges)) || [];
          candidates = pendingEdges.filter((e) => e.properties && e.properties.source === "wp170-standardize-candidates");
          if (candidates.length === 0) await new Promise((resolve) => setTimeout(resolve, 300));
        }
        assert.equal(pendingResp.status, 200, JSON.stringify(pendingResp.body).slice(0, 400));
        const evidence = candidates.length === 0
          ? log.split("\n").filter((l) => /relation-candidates/.test(l)).slice(-6).join(" | ")
          : "";
        assert.equal(candidates.length, 2, `提及两实体应各生成一条候选（实得 ${candidates.length}）｜服务端证据：${evidence}`);
        const approve = await request("POST", "/api/kg/review", { edgeId: candidates[0].edgeId, action: "approved", reason: "WP-170全链验收" });
        assert.equal(approve.status, 200, JSON.stringify(approve.body).slice(0, 400));
        assert.equal(approve.body.data.reviewStatus, "approved");
        reviewedEdgeId = approve.body.data.edgeId || candidates[0].edgeId;
        const after = await request("GET", "/api/kg/pending-review");
        const afterEdges = (after.body.data && (after.body.data.edges || after.body.data.pendingEdges)) || [];
        const left = afterEdges.filter((e) => e.properties && e.properties.source === "wp170-standardize-candidates");
        assert.equal(left.length, 1, "批准一条后待审候选减一（人工裁决生效、账本主权）");
      }
    }
    // WP-169 红队P1-1/P1-2 回归钉：本地草稿 lane 全链＋重复校验——机器署名不冒认 human
    {
      const draftRel = "知识库/raw/drafts/本地草稿/wp169-本地链.md";
      fs.mkdirSync(path.join(vaultPath, "知识库/raw/drafts/本地草稿"), { recursive: true });
      const draftAbs = path.join(vaultPath, ...draftRel.split("/"));
      fs.writeFileSync(draftAbs,
        "---\narticle_id: wp169-本地链\nproduct: FixtureProduct\nversion: \"1.0.0\"\nmodule: fixture-module\ncategory-path: ops:maintain\ntags:\n  - 人工标签\narchitecture_associations: []\n---\n本地链正文\n", "utf8");
      const v1 = await request("POST", "/api/articles/drafts/validate", { filePath: draftRel });
      assert.equal(v1.status, 200, JSON.stringify(v1.body).slice(0, 300));
      assert.equal(v1.body.data.fieldProvenance.title.source, "auto", "本地链首校验：title=auto");
      const v2 = await request("POST", "/api/articles/drafts/validate", { filePath: draftRel }); // 重复校验（设计内循环：校验→查看→再校验）
      assert.equal(v2.status, 200, JSON.stringify(v2.body).slice(0, 300));
      assert.equal(v2.body.data.fieldProvenance.title.source, "auto", "P1-2回归：二次校验不把机器值冒认 human");
      assert.equal(v2.body.data.fieldProvenance.date.source, "auto", "P1-2回归：date 同");
      fs.writeFileSync(draftAbs, fs.readFileSync(draftAbs, "utf8").replace("module: fixture-module", "module: fixture-module\narticle_type: 排错指南\ndoc-type: 用户手册"), "utf8");
      const promoted = await request("POST", "/api/articles/drafts/promote", { filePath: draftRel, confirmed: true });
      assert.equal(promoted.status, 200, JSON.stringify(promoted.body).slice(0, 300));
      const standardized = await request("POST", `/api/articles/precleaned/${encodeURIComponent("wp169-本地链")}/standardization`, { confirmed: true });
      assert.equal(standardized.status, 200, JSON.stringify(standardized.body).slice(0, 300));
      const lfp = standardized.body.data.fieldProvenance;
      assert.equal(lfp.title.source, "auto", "P1-1回归：本地lane任务↔候选链接修复，快照命中——title=auto 不冒认");
      assert.equal(lfp.date.source, "auto", "P1-1回归：date=auto");
      assert.equal(lfp.tags.source, "human");
    }
    const sourcePath = standardized.body.data.sourcePath;
    const contentHash = standardized.body.data.formalContentHash;
    const transition = (operation, input = {}) => request("POST", `/api/approval/${id}/transition`, {
      operation, input: { sourcePath, contentHash, title: "测试候选文章", ...input },
    });
    const fieldsPath = path.join(serverEnv.THESCHEMA_DIR, "fields.yaml");
    const fields = yaml.parse(fs.readFileSync(fieldsPath, "utf8"));
    // WP-195 v2 类属主：新增属性挂文章类 properties（无 scope/label 字段——属主类即作用域，display 即绑定名）
    fields.classes.article.properties.push({ name: "review_note", display: "测试校对说明", type: "string", required: "否", layer: "内容属性", value_domain: { source: "free" }, description: "测试注入属性。" });
    fields.classes.article.properties.push({ name: "preview_note", display: "测试校对说明", type: "string", required: "否", layer: "内容属性", value_domain: { source: "free" }, description: "测试注入属性。" });
    write(vaultPath, "知识库/TheSchema/fields.yaml", yaml.stringify(fields));
    const ontologyPath = path.join(serverEnv.THESCHEMA_DIR, "ontology.yaml");
    const definitions = yaml.parse(fs.readFileSync(ontologyPath, "utf8"));
    definitions.node_types.KnowledgeArticle = {
      subClassOf: "Document", data_properties: { title: { required: true } },
    };
    const saveOntology = () => write(vaultPath, "知识库/TheSchema/ontology.yaml", yaml.stringify(definitions));
    saveOntology();
    const candidatePath = `/api/articles/precleaned/${id}`;
    const beforeField = (await request("GET", derivationPath)).body.data;
    const candidateBefore = (await request("GET", candidatePath)).body.data;
    assert.equal(candidateBefore.derivedFields.version, beforeField.version);
    assert.equal(candidateBefore.derivedFields.values.title, candidateBefore.title);
    definitions.node_types.KnowledgeArticle.data_properties.module = { required: false };
    saveOntology();
    const revised = (await request("GET", derivationPath)).body.data;
    assert.notEqual(revised.version, beforeField.version);
    assert(revised.uiConfig.displayFields.includes("module"));
    const revisedFields = (await request("GET", candidatePath)).body.data.derivedFields;
    assert.equal(revisedFields.version, revised.version);
    assert.equal(revisedFields.values.module, "fixture-module");
    definitions.node_types.KnowledgeArticle.data_properties.unregistered_wp185_field = { required: true };
    saveOntology();
    const retained = await request("GET", derivationPath);
    assert.equal(retained.retained, "true");
    assert.deepEqual(retained.body.data, revised, "不合法的定义不能激活");
    assert.deepEqual((await request("GET", candidatePath)).body.data.derivedFields, revisedFields);
    delete definitions.node_types.KnowledgeArticle.data_properties.unregistered_wp185_field;
    delete definitions.node_types.KnowledgeArticle.data_properties.module;
    saveOntology();
    assert.equal((await transition("standardize")).status, 200);
    const wrongSource = await transition("confirm", { sourcePath: sourcePath + ".bak" });
    assert.equal(wrongSource.status, 409, JSON.stringify(wrongSource.body));
    assert.equal(wrongSource.body.error_code, "ARTICLE_NOT_STANDARDIZED");

    // 用同一篇文章重试，不改内容或确认哈希。现行类绑定发生变化后必须重新校验。
    definitions.node_types.KnowledgeArticle.data_properties.version = { required: true };
    saveOntology();
    const unavailable = await transition("confirm");
    assert.equal(unavailable.status, 503, JSON.stringify(unavailable.body));
    assert.equal(unavailable.body.error_code, "VALIDATOR_UNAVAILABLE");
    assert.equal((await request("GET", `/api/approval/status/${id}`)).body.data.status, "pending");

    delete definitions.node_types.KnowledgeArticle.data_properties.version;
    definitions.node_types.KnowledgeArticle.data_properties.review_note = { required: true };
    saveOntology();
    const invalid = await transition("confirm");
    assert.equal(invalid.status, 409, JSON.stringify(invalid.body));
    assert.equal(invalid.body.error_code, "ARTICLE_VALIDATION_FAILED");
    assert.equal((await request("GET", `/api/approval/status/${id}`)).body.data.status, "pending");

    delete definitions.node_types.KnowledgeArticle.data_properties.review_note;
    saveOntology();
    const confirmed = await transition("confirm");
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    // 只在隔离词表中挂高风险，覆盖真实 GET 和命令入口的缺单反例。
    definitions.risk_types = { ...definitions.risk_types, "test-signoff": { decision: "approve" } };
    definitions.action_types["approval.transition"].risk_id = "test-signoff";
    saveOntology();
    const approvalRequired = await request("GET", statusPath);
    assert.equal(approvalRequired.status, 200, JSON.stringify(approvalRequired.body));
    const requiresSignoff = approvalRequired.body.data.next_actions.find((entry) => entry.action === "publish");
    assert.deepEqual([requiresSignoff.allowed, requiresSignoff.reason], [false, "ACTION_APPROVAL_REQUIRED"]);
    const writeWithoutSignoff = await transition("publish");
    assert.equal(writeWithoutSignoff.status, 403, JSON.stringify(writeWithoutSignoff.body));
    assert.equal(writeWithoutSignoff.body.error_code, "ACTION_APPROVAL_REQUIRED");
    delete definitions.action_types["approval.transition"].risk_id;
    delete definitions.risk_types["test-signoff"];
    definitions.node_types.KnowledgeArticle.data_properties.review_note = { required: true };
    saveOntology();
    const refusedPublish = await transition("publish");
    assert.equal(refusedPublish.status, 409, JSON.stringify(refusedPublish.body));
    assert.equal(refusedPublish.body.error_code, "ARTICLE_VALIDATION_FAILED");
    assert.equal((await request("GET", `/api/approval/status/${id}`)).body.data.status, "approved");
    const refusedStatus = await request("GET", statusPath);
    assert.equal(refusedStatus.status, 200, JSON.stringify(refusedStatus.body));
    const refusedAction = refusedStatus.body.data.next_actions.find((entry) => entry.action === "publish");
    assert.deepEqual([refusedAction.allowed, refusedAction.reason], [false, "ARTICLE_VALIDATION_FAILED"]);
    assert.equal(fs.existsSync(path.join(vaultPath, "知识库/wiki/articles/ops")), false);

    delete definitions.node_types.KnowledgeArticle.data_properties.review_note;
    saveOntology();
    const readyToPublish = await request("GET", statusPath);
    assert.equal(readyToPublish.status, 200, JSON.stringify(readyToPublish.body));
    assert.equal(readyToPublish.body.data.next_actions.find((entry) => entry.action === "publish")?.allowed, true);
    const published = await transition("publish");
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const formalDir = path.join(vaultPath, "知识库/wiki/articles/ops");
    const formal = path.join(formalDir, fs.readdirSync(formalDir).find((name) => name.endsWith(".md")));
    fs.appendFileSync(formal, "\n外部新增正文\n");
    let pending = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request("GET", `/api/approval/status/${id}`);
      if (response.body?.data?.status === "pending") { pending = response.body.data; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(pending, `外部编辑未进入待审: ${log.slice(-1200)}`);
    assert.equal(pending.changeSummary.bodyChanged, true);
    assert.match(pending.changeSummary.afterExcerpt, /外部新增正文/);
    const unpublishedSearch = await request("GET", `/api/documents/search?keyword=${encodeURIComponent("外部新增正文")}`);
    assert.equal(unpublishedSearch.status, 200, JSON.stringify(unpublishedSearch.body).slice(0, 400));
    assert.equal(unpublishedSearch.body.data.documents.length, 0, "未再发布的正文不得进入正式文档清单");
    const movedFormal = path.join(formalDir, "测试候选文章-改名.md");
    fs.renameSync(formal, movedFormal);
    assert.equal(fs.existsSync(formal), false);
    assert.equal(fs.existsSync(movedFormal), true);
    const historyPath = "/api/kg/review-history";
    const decisionsBefore = (await request("GET", historyPath)).body.data.records;
    assert(reviewedEdgeId && decisionsBefore.some((entry) => entry.edgeId === reviewedEdgeId && entry.action === "approved"));
    const searchBefore = (await request("GET", "/api/documents/search")).body.data.documents;
    assert(searchBefore.some((entry) => entry.documentKind === "standard-article"));
    const releaseFile = path.join(vaultPath, ".releases", published.body.data.releaseId, "artifacts/知识库/wiki/articles/ops", path.basename(formal));
    const releaseBefore = fs.readFileSync(releaseFile);
    const releaseReviewsPath = path.join(vaultPath, ".releases", published.body.data.releaseId, "artifacts/.ledger/review_actions.json");
    const releaseReviews = fs.readFileSync(releaseReviewsPath);
    assert(releaseReviews.includes(reviewedEdgeId), "历史发布包含该关系的裁决记录");
    const journalPath = path.join(vaultPath, ".ledger/state-journal.jsonl");
    const journalBefore = fs.readFileSync(journalPath);
    const derivationBeforeRebuild = (await request("GET", derivationPath)).body.data;
    const fieldsBeforeRebuild = (await request("GET", candidatePath)).body.data.derivedFields;
    let rebuiltTopology;
    let publicGraph;
    for (const round of [1, 2]) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      // 删除本隔离实例全部 SQLite、边车和 staging，业务文件、流水与 Release 留存。
      fs.rmSync(wp170DataDir, { recursive: true });
      assert(!fs.existsSync(wp170DataDir));
      child = spawn(process.execPath, [path.resolve(__dirname, "../../../server/main.cjs")], { env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (value) => { log += value; });
      child.stderr.on("data", (value) => { log += value; });
      let restarted = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try { const response = await request("GET", "/api/health"); if (response.body?.data?.readyState === "ready") { restarted = true; break; } } catch { /* restarting */ }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert(restarted, `第 ${round} 轮重启未 ready: ${log.slice(-1200)}`);
      for (const filename of ["runtime-state.db", "derived-index.db", "telemetry.db"]) {
        assert(fs.statSync(path.join(wp170DataDir, filename)).size > 0, filename);
      }
      const afterRestart = await request("GET", `/api/approval/status/${id}`);
      assert.deepEqual(afterRestart.body.data, pending, "审批状态与变更摘要完整重放");
      assert.deepEqual((await request("GET", derivationPath)).body.data, derivationBeforeRebuild, "两次完整重建产物一致");
      assert.deepEqual((await request("GET", candidatePath)).body.data.derivedFields, fieldsBeforeRebuild, "字段投影从原文重建");
      const history = await request("GET", historyPath);
      assert.equal(history.status, 200, JSON.stringify(history.body).slice(0, 400));
      const decisionIdentity = ({ edgeId, action, decidedAt, source, target }) => ({ edgeId, action, decidedAt, source, target });
      assert.deepEqual(history.body.data.records.map(decisionIdentity), decisionsBefore.map(decisionIdentity), "关系裁决未丢失");
      assert.deepEqual((await request("GET", "/api/documents/search")).body.data.documents, searchBefore, "发布文档可通过公开接口读取");
      assert.deepEqual(fs.readFileSync(releaseFile), releaseBefore, "历史发布字节不变");
      assert.deepEqual(fs.readFileSync(releaseReviewsPath), releaseReviews, "历史关系工件不变");
      const graphArtifact = path.join(wp170DataDir, "staging/master_graph.json");
      for (let attempt = 0; attempt < 50 && !fs.existsSync(graphArtifact); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert(fs.existsSync(graphArtifact), `第 ${round} 轮管线没有再生主图: ${log.split("\n").filter((line) => /pipeline-(run|due)/.test(line)).slice(-8).join("\n")}`);
      const regenerated = JSON.parse(fs.readFileSync(graphArtifact, "utf8"));
      assert(regenerated.nodes.length > 0, "真实抽取重新生成非空主图");
      const graphIdentity = {
        nodes: regenerated.nodes.map(({ id }) => id).sort(),
        edges: regenerated.connections.map(({ from, to, relationType }) => {
          assert(from && to && relationType, "抽取关系必须包含有效端点及类型");
          return JSON.stringify([from, to, relationType]);
        }).sort(),
      };
      if (rebuiltTopology) assert.deepEqual(graphIdentity, rebuiltTopology, "两次全量重建的节点和边一致");
      rebuiltTopology = graphIdentity;
      let topology;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        topology = await request("GET", "/api/dashboard/topology?scope=full");
        if (topology.body.data?.topology?.nodes.some(({ id }) => graphIdentity.nodes.includes(id))) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.equal(topology.status, 200, JSON.stringify(topology.body).slice(0, 400));
      assert.equal(topology.body.data.dataSource, "worktree");
      const view = topology.body.data.topology;
      const publicIdentity = {
        nodes: view.nodes.map(({ id }) => id).sort(),
        edges: view.edges.map(({ source, target, type }) => {
          assert(source && target && type, "公开图关系必须包含有效端点及类型");
          return JSON.stringify([source, target, type]);
        }).sort(),
      };
      assert(publicIdentity.nodes.some((id) => graphIdentity.nodes.includes(id)), "公开工作图须读到重新摄取的节点");
      if (publicGraph) assert.deepEqual(publicIdentity, publicGraph, "两次重启的公开节点及边一致");
      publicGraph = publicIdentity;
      assert.deepEqual(fs.readFileSync(journalPath), journalBefore, "重放没有再写一次流水");
    }
    const uiPort = await new Promise((resolve, reject) => { const socket = net.createServer(); socket.once("error", reject); socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); }); });
    vite = spawn(process.execPath, [path.resolve(__dirname, "../../../node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
      cwd: path.resolve(__dirname, "../../.."), env: { ...process.env, API_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
    });
    let uiReady = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { if ((await fetch(`http://127.0.0.1:${uiPort}/`)).ok) { uiReady = true; break; } } catch { /* vite boot */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(uiReady, "前端服务未就绪");
    browser = await require("playwright").chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiPort}/#/article-workflow`);
    const openPreview = () => page.getByRole("button", { name: "查看 测试候选文章", exact: true }).click({ timeout: 15_000 });
    await openPreview();
    assert.equal(await page.getByRole("dialog").getByText("WP185 visible field", { exact: true }).count(), 0);
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    definitions.node_types.KnowledgeArticle.data_properties.preview_note = { required: false };
    saveOntology();
    await openPreview();
    await page.getByRole("dialog").getByText("WP185 visible field", { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: /发布.*测试候选文章/ }).click({ timeout: 15_000 });
    await page.getByTestId("approval-change-summary").waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId("approval-change-summary").innerText(), /外部新增正文/);
    const formalSearch = await request("GET", "/api/documents/search");
    assert.equal(formalSearch.status, 200, JSON.stringify(formalSearch.body).slice(0, 600));
    assert(formalSearch.body.data.documents.some((document) => document.documentKind === "standard-article"), JSON.stringify(formalSearch.body.data).slice(0, 1200));
    // 第 3 批对象浏览器 IA：document-inventory 旧路由并入图谱检索枢纽页签——正式文件全景住
    // 枢纽 search 页签（#/data-dashboard/search；#/document-inventory 旧 hash 落枢纽 topo 页签）
    await page.goto(`http://127.0.0.1:${uiPort}/#/data-dashboard/search`);
    await page.getByRole("button", { name: /测试候选文章/ }).first().click({ timeout: 15_000 });
    const formalDetail = page.getByRole("region", { name: "文章全景" });
    await formalDetail.waitFor({ timeout: 15_000 });
    await formalDetail.getByText(/当前文件审批状态：待审/).waitFor({ timeout: 15_000 });
    assert.match(await formalDetail.innerText(), /下列字段属于已发布版本/);
    assert.match(await formalDetail.innerText(), /当前文件审批状态：待审/);
    assert.match(await formalDetail.innerText(), /发布时来源路径/);
    assert.equal(await formalDetail.getByRole("link").count(), 0, "Release 的旧路径不得伪装成当前文件链接");
  } finally {
    if (browser) await browser.close();
    if (vite) { vite.kill("SIGTERM"); await new Promise((resolve) => vite.once("exit", resolve)); }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    cleanTree(vaultPath);
    fs.rmSync(wp170DataDir, { recursive: true, force: true });
  }
});

// S4（gherkin 场景⑧）：publish 失败必须落持久 Issue（release_publication_failure，listIssues 可读）。
// 缺必需产物 master_graph.db → collectCompleteArtifacts 抛 RELEASE_ARTIFACT_MISSING →
// publishArticle 的 catch 复用 publisherService.recordFailure 写 .releases/issues/publication-issues.json。
//（SPEC-012 wave-2：db 字节工件住 data/——删除 dataDir 内文件触发同款失败）
test("S4：publish 失败落持久 Issue（release_publication_failure，listIssues 可读）", async () => {
  const vaultPath = fixtureVault();
  try {
    const precleaned = path.join(vaultPath, "知识库/raw/precleaned/fixture-candidate.md");
    const HA = sha256(fs.readFileSync(precleaned, "utf8"));
    const sm = buildAssembly(vaultPath);
    await standardizeToApproved(sm, "fixture-candidate-001", HA);
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved");
    // 删除必需产物触发发布失败
    fs.rmSync(path.join(fixtureDataDir, "master_graph.db"), { force: true });
    await assert.rejects(
      () => sm.transition("fixture-candidate-001", "publish", {
        sourcePath: "知识库/raw/precleaned/fixture-candidate.md",
        title: "测试候选文章",
        product: "FixtureProduct",
        version: "1.0.0",
      }),
      (e) => e.code === "RELEASE_ARTIFACT_MISSING" || e.message.includes("master_graph.db"),
      "publish 应因缺 master_graph.db 失败",
    );
    // 失败后状态不得推进到 snapshot
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved", "失败后状态不得推进");
    // 持久 Issue 已落盘且可被 listIssues 读
    const issuesPath = path.join(vaultPath, ".releases", "issues", "publication-issues.json");
    assert.ok(fs.existsSync(issuesPath), "发布失败应落持久 Issue 文件");
    const issues = JSON.parse(fs.readFileSync(issuesPath, "utf8"));
    assert.equal(issues.length, 1, "应恰好 1 条发布失败 Issue");
    assert.equal(issues[0].issueKind, "release_publication_failure");
    assert.equal(issues[0].status, "open");
    assert.ok(issues[0].stage, "Issue 应记录失败阶段 stage");
    assert.ok(issues[0].errorCode, "Issue 应记录错误码");
  } finally {
    cleanTree(vaultPath);
  }
});

// S5 重写（B2/D2+D3）：原用例「批准后源变化再 publish 期望成功」钉的正是 D2 要修的假发布——
// 场景⑥/GOAL-5：来源变化使旧审批资格失效，publish 必须 409。合法恢复路径 = reject → resubmit
// 重标准化（D3 管线，快照取代语义在此链路验证，不回归 DUPLICATE_DOCUMENT_ID）→ confirm 新哈希 → publish。
test("S5 重写（B2）：批准后源变化 publish 409；resubmit 重标准化→confirm→publish 走取代语义", async () => {
  const vaultPath = fixtureVault();
  try {
    const sm = buildAssembly(vaultPath);
    const src001 = "知识库/raw/precleaned/fixture-candidate.md";
    const src002 = "知识库/raw/precleaned/fixture-candidate-002.md";
    // 记录 001：批准（A1）后源变化 → publish 409（资格失效），状态保持 approved
    const contentA = fs.readFileSync(path.join(vaultPath, src001), "utf8");
    const HA = sha256(contentA);
    await sm.transition("fixture-candidate-001", "standardize", { sourcePath: src001, contentHash: HA, title: "测试候选文章", product: "FixtureProduct", version: "1.0.0" });
    await sm.transition("fixture-candidate-001", "confirm", { contentHash: HA });
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved");
    // 记录 002（独立源文件/独立 article_id frontmatter——身份源是快照正文的 frontmatter，双 id 共源必撞 DUPLICATE）：
    // standardize(B1) → reject；改源后 resubmit 管线重快照 B2 取代 B1 → confirm 新哈希 → publish
    const contentB1 = `---
article_id: fixture-candidate-002
title: 测试候选文章二
product: FixtureProduct
version: "1.0.0"
module: fixture-module
article_type: 排错指南
doc-type: 用户手册
category-path: ops:maintain
tags: "[测试, 候选]"
architecture_associations: []
---

# 测试候选文章二

第二篇候选正文（v1）。
`;
    write(vaultPath, src002, contentB1);
    const HB1 = sha256(contentB1);
    await sm.transition("fixture-candidate-002", "standardize", { sourcePath: src002, contentHash: HB1, title: "测试候选文章二", product: "FixtureProduct", version: "1.0.0" });
    await sm.transition("fixture-candidate-002", "reject", { contentHash: HB1 });
    // 批准后源变化（001）：publish 必须 fail-closed
    write(vaultPath, src001, `${contentA}\n# 更新内容\n`);
    await assert.rejects(
      () => sm.transition("fixture-candidate-001", "publish", { sourcePath: src001 }),
      (e) => e.code === "APPROVAL_EVIDENCE_STALE",
      "批准后源变化 publish 应 409 APPROVAL_EVIDENCE_STALE（旧审批资格失效）",
    );
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved", "重验失败不得推进 snapshot");
    // 记录 002 合法路径：修改后 resubmit（管线重快照 HB2 取代 HB1）→ confirm 新哈希 → publish
    const contentB2 = `${contentB1}\n更新段落（v2 修改后重新标准化）。\n`;
    write(vaultPath, src002, contentB2);
    const HB2 = sha256(contentB2);
    const r = await sm.transition("fixture-candidate-002", "resubmit", { sourcePath: src002 });
    assert.equal(r.status, "pending");
    assert.equal(r.revision, `sha256:${HB2}`, "resubmit 管线应刷新 revision 为新源哈希");
    await sm.transition("fixture-candidate-002", "confirm", { contentHash: HB2, sourcePath: src002 });
    const result = await sm.transition("fixture-candidate-002", "publish", { sourcePath: src002, title: "测试候选文章二", product: "FixtureProduct", version: "1.0.0" });
    assert.ok(result.releaseId, "重新审批后 publish 应成功（取代语义不得 DUPLICATE_DOCUMENT_ID）");
    assert.equal(sm.getStatus("fixture-candidate-002").status, "snapshot");
    const formalRootA5 = path.join(vaultPath, "知识库", "wiki", "articles");
    const readableFiles = fs.readdirSync(formalRootA5).flatMap((domain) => fs.readdirSync(path.join(formalRootA5, domain)).filter((name) => name.endsWith(".md")).map((name) => path.join(formalRootA5, domain, name)));
    const thisArticle = readableFiles.filter((file) => fs.readFileSync(file, "utf8").includes("article_id: fixture-candidate-002"));
    assert.equal(thisArticle.length, 1, "同 articleId 只保留一份可编辑正式文件");
    assert.equal(sha256(fs.readFileSync(thisArticle[0])), HB2, "正式文件为本次获批内容");
    // current 指针已切换
    const currentPath = path.join(vaultPath, ".releases", "current.json");
    assert.ok(fs.existsSync(currentPath), "publish 成功后 current.json 应存在");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    assert.equal(current.releaseId, result.releaseId);
  } finally {
    cleanTree(vaultPath);
  }
});
