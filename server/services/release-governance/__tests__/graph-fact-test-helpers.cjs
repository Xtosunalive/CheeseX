const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitFixtureEnv } = require("../../../../scripts/quality/shared/git-fixture-env.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");

function git(args, cwd) {
  return execFileSync("git", args, { env: gitFixtureEnv(process.env), cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function proposalChangedFiles(proposalService, proposalId) {
  const proposal = proposalService.getProposal(proposalId);
  const output = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--name-only", proposal.baseCommit, proposalService.actualHead(proposal)], {
    cwd: proposal.worktreePath,
    encoding: "utf8",
    env: gitFixtureEnv(process.env),
  }).trim();
  return output ? output.split("\n").sort() : [];
}

function cleanup(root) {
  if (!fs.existsSync(root)) return;
  try { fs.chmodSync(root, 0o700); } catch {}
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    try { fs.chmodSync(target, entry.isDirectory() ? 0o700 : 0o600); } catch {}
    if (entry.isDirectory()) cleanup(target);
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function withGraphFactRepo(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "graph-fact-release-test-"));
  try {
    git(["init", "-b", "main"], root);
    git(["config", "user.email", "fixture@example.invalid"], root);
    git(["config", "user.name", "Fixture"], root);
    git(["config", "core.fsmonitor", "false"], root);
    write(root, "知识库/wiki/entities/component.md", "---\narchitecture-node-id: component\ntitle: Component\naliases: []\narch_subdomain: legacy\n---\n\n# Component\n");
    write(root, "知识库/wiki/entities/target.md", "---\narchitecture-node-id: target\ntitle: Target\naliases: []\n---\n\n# Target\n");
    const articleRaw = "---\narticle_id: article\ntitle: Article\nproduct: Product\nversion: 1.0.0\n---\n\n# Article\n";
    write(root, "知识库/raw/precleaned/article.md", articleRaw);
    write(root, "知识库/releases/article.md", articleRaw);
    const fixtureVault = path.resolve(__dirname, "../../../../test/fixtures/minimal-vault");
    write(root, "知识库/TheSchema/ontology.yaml", fs.readFileSync(path.join(fixtureVault, "知识库/TheSchema/ontology.yaml")));
    write(root, "知识库/TheSchema/enums.yaml", fs.readFileSync(path.join(fixtureVault, "知识库/TheSchema/enums.yaml"), "utf8"));
    write(root, "知识库/TheSchema/dependencies.yaml", "rules: []\n");
    write(root, "知识库/TheSchema/versions.yaml", fs.readFileSync(path.join(fixtureVault, "知识库/TheSchema/versions.yaml")));
    write(root, "知识库/.claude/scripts/pipeline-runner.py", fs.readFileSync(path.join(fixtureVault, "知识库/.claude/scripts/pipeline-runner.py")));
    write(root, "知识库/architecture/Product/1.0.0/semantic_architecture.json", '{"generatedAt":"volatile","nodes":[],"connections":[]}\n');
    write(root, "知识库/architecture/Product/1.0.0/architecture_layout.json", '{"generatedAt":"volatile","positions":{}}\n');
    git(["add", "."], root);
    git(["commit", "-m", "fixture"], root);
    const result = callback(root);
    if (result && typeof result.then === "function") return result.finally(() => cleanup(root));
    cleanup(root);
    return result;
  } catch (error) {
    cleanup(root);
    throw error;
  }
}

function deterministicPipeline(root) {
  // SPEC-012 wave-2 图族：图/清单真身迁 derived-index.db（种 store 原文行）、master_graph.db
  // 住 repo 侧 data/（种临时 KB_DATA_DIR）；pipeline_version 沿 runtime-state 库种入
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-fact-data-"));
  process.env.KB_DATA_DIR = dataDir;
  write(dataDir, "master_graph.db", Buffer.from("sqlite-fixture-v1"));
  const store = getDerivedIndexStore(root);
  store.artifacts.put("master_graph", JSON.stringify({ generatedAt: new Date().toISOString(), nodes: [{ id: "component", label: "Component", properties: { source_path: "知识库/wiki/entities/component.md" } }], connections: [] }));
  store.artifacts.put("extract_manifest", JSON.stringify({ generatedAt: new Date().toISOString(), entities: ["component"] }));
  const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
  getRuntimeStateStore(root).pipeline.versionPut({ generatedAt: new Date().toISOString(), version: "1" });
  // manifest 真身迁 derived-index.db 行级——种 store（scopeKey=root，测试懒建形态）
  getDerivedIndexStore(root).articleManifests.put("article", { generatedAt: new Date().toISOString(), articleId: "article" });
  write(root, ".ledger/article-associations.json", JSON.stringify({ article: ["component"] }));
}

module.exports = { deterministicPipeline, git, proposalChangedFiles, withGraphFactRepo, write };
