const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  readJsonArtifact,
  readPropertyInspectionArtifacts,
  readVaultSourceIdentity,
  readYamlArtifact,
  resolveVaultFile,
} = require("../working-artifact-snapshot.cjs");

function revision(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

test("JSON data and working revision come from the same exact bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-artifact-json-"));
  try {
    const file = path.join(root, "artifact.json");
    const bytes = Buffer.from('{"nodes":[]}\n', "utf8");
    fs.writeFileSync(file, bytes);
    const snapshot = readJsonArtifact(file);
    assert.deepEqual(snapshot.data, { nodes: [] });
    assert.equal(snapshot.revision, revision(bytes));
    assert.deepEqual(snapshot.bytes, bytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("byte-only differences change revision without changing parsed YAML", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-artifact-yaml-"));
  try {
    const file = path.join(root, "enums.yaml");
    fs.writeFileSync(file, "layers: []\n", "utf8");
    const first = readYamlArtifact(file);
    fs.writeFileSync(file, "layers: []\n\n", "utf8");
    const second = readYamlArtifact(file);
    assert.deepEqual(first.data, second.data);
    assert.notEqual(first.revision, second.revision);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("missing artifacts are explicit and Vault-relative paths cannot escape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-artifact-path-"));
  try {
    assert.deepEqual(readJsonArtifact(path.join(root, "missing.json")), {
      data: null, bytes: null, revision: null, path: path.join(root, "missing.json"), exists: false,
    });
    assert.equal(resolveVaultFile(root, "../outside.md"), null);
    assert.equal(resolveVaultFile(root, "/absolute.md"), null);
    assert.equal(resolveVaultFile(root, "知识库/wiki/a.md").relativePath, "知识库/wiki/a.md");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("property inspection snapshots all four exact working inputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-property-inputs-"));
  try {
    const schema = path.join(root, "知识库", "TheSchema");
    fs.mkdirSync(schema, { recursive: true });
    fs.writeFileSync(path.join(schema, "enums.yaml"), "architecture_projection:\n  product: Product\n  version: main\n", "utf8");
    // SPEC-012 wave-2 图族＋PR-082 SA 族：派生工件真身迁 derived-index.db——种子种 store
    // （原文行字节精确，revision 口径与旧文件字节一致；SA 走通用槽无产品段）
    const { getDerivedIndexStore } = require("../persistence/derived-index-store.cjs");
    const store = getDerivedIndexStore(root);
    store.artifacts.put("master_graph", '{"nodes":[],"connections":[]}\n');
    store.artifacts.put("extract_manifest", '{"files":{}}\n');
    store.artifacts.put("sa", '{"components":[]}\n');
    const result = readPropertyInspectionArtifacts(root);
    assert.deepEqual(Object.keys(result.workingRevisions), ["enums", "semanticArchitecture", "masterGraph", "extractManifest"]);
    assert.equal(Object.values(result.workingRevisions).every((value) => /^sha256:[a-f0-9]{64}$/.test(value)), true);
    assert.deepEqual(result.semanticArchitecture.data, { components: [] });
    assert.equal(result.masterGraph.revision, revision(Buffer.from('{"nodes":[],"connections":[]}\n', "utf8")));
    assert.equal(result.extractManifest.revision, revision(Buffer.from('{"files":{}}\n', "utf8")));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Vault source identity is bound to a contained regular file and its exact bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-source-identity-"));
  try {
    const sourcePath = path.join(root, "知识库", "wiki", "entities", "api.md");
    const bytes = Buffer.from("# API\n", "utf8");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, bytes);
    const identity = readVaultSourceIdentity(root, "知识库/wiki/entities/api.md");
    assert.equal(identity.sourceKey, "知识库/wiki/entities/api.md");
    assert.equal(identity.revision.size, bytes.length);
    assert.equal(typeof identity.revision.mtimeMs, "number");
    assert.equal(identity.revision.contentHash, revision(bytes));
    const absoluteIdentity = readVaultSourceIdentity(root, sourcePath);
    assert.deepEqual(absoluteIdentity, identity);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Vault source identity rejects traversal, directories, and symlinks escaping the Vault", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "working-source-boundary-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "working-source-outside-"));
  try {
    fs.mkdirSync(path.join(root, "inside"), { recursive: true });
    const outsideFile = path.join(outside, "outside.md");
    fs.writeFileSync(outsideFile, "outside\n", "utf8");
    fs.symlinkSync(outsideFile, path.join(root, "escape.md"));
    assert.equal(readVaultSourceIdentity(root, "../outside.md"), null);
    assert.equal(readVaultSourceIdentity(root, outsideFile), null);
    assert.equal(readVaultSourceIdentity(root, "inside"), null);
    assert.equal(readVaultSourceIdentity(root, "escape.md"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
