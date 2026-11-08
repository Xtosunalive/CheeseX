// WP-027（PR-142）：schema-graph-freshness 对账单元。WP-049 L3 语义迁移：词面对账改内容指纹
// （端口 sha16 对拍 manifest 注入条目——抽取器同源注入），mtime/size 退出判定（内容是唯一事实：
// touch 不改内容即真新鲜；抽取器注入条目 mtime 恒 0，两面向同方向）。
// manifest 缺席 → upToDate=null（unknown 不假绿）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { computeGraphFreshness, GRAPH_INPUT_BASENAMES } = require("../schema-graph-freshness.cjs");

function sha16(absPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex").slice(0, 16);
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-fresh-"));
  const schemaDir = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  process.env.THESCHEMA_DIR = schemaDir; // 与 fields-write-service.test 同款钉扎
  const stagingDir = path.join(dir, "data", "staging");
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const base of GRAPH_INPUT_BASENAMES) {
    fs.writeFileSync(path.join(schemaDir, base), `# ${base}\nseed: 1\n`, "utf8");
  }
  return { dir, schemaDir, stagingDir, vault: dir };
}

function writeManifest(fixture) {
  const files = {};
  for (const base of GRAPH_INPUT_BASENAMES) {
    const abs = path.join(fixture.schemaDir, base);
    const stat = fs.statSync(abs, { bigint: true });
    files[`知识库/TheSchema/${base}`] = { mtime_ns: Number(stat.mtimeNs), size: Number(stat.size), sha16: sha16(abs) };
  }
  fs.writeFileSync(path.join(fixture.stagingDir, "extract_manifest.json"), JSON.stringify({ version: 1, generatedAt: "2026-10-28T00:00:00.000Z", files }), "utf8");
}

test("manifest 缺席（从未增量抽取）→ upToDate=null 不假绿", () => {
  const fx = makeFixture();
  const r = computeGraphFreshness({ vaultPath: fx.vault, dataDir: path.join(fx.dir, "data") });
  assert.equal(r.upToDate, null);
  assert.deepEqual(r.changed, []);
  assert.equal(r.manifestGeneratedAt, null);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("四件未变 → upToDate=true", () => {
  const fx = makeFixture();
  writeManifest(fx);
  const r = computeGraphFreshness({ vaultPath: fx.vault, dataDir: path.join(fx.dir, "data") });
  assert.equal(r.upToDate, true);
  assert.deepEqual(r.changed, []);
  assert.equal(r.manifestGeneratedAt, "2026-10-28T00:00:00.000Z");
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("内容变更（sha16 变）→ false 且 changed 精确点名", () => {
  const fx = makeFixture();
  writeManifest(fx);
  fs.writeFileSync(path.join(fx.schemaDir, "ontology.yaml"), "# ontology.yaml\nseed: 2\n", "utf8");
  const r = computeGraphFreshness({ vaultPath: fx.vault, dataDir: path.join(fx.dir, "data") });
  assert.equal(r.upToDate, false);
  assert.deepEqual(r.changed, ["ontology.yaml"]);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("mtime_ns 变而内容同（touch）→ true（WP-049 L3：内容指纹是唯一事实——touch 不改词表内容即真新鲜；抽取器注入条目同判，两面向同方向）", () => {
  const fx = makeFixture();
  writeManifest(fx);
  const abs = path.join(fx.schemaDir, "enums.yaml");
  const stat = fs.statSync(abs);
  fs.utimesSync(abs, new Date(), new Date(stat.mtimeMs / 1000 + 5));
  const r = computeGraphFreshness({ vaultPath: fx.vault, dataDir: path.join(fx.dir, "data") });
  assert.equal(r.upToDate, true);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("manifest 无该文件条目（TheSchema 新置备/文件新建）→ changed 含该件", () => {
  const fx = makeFixture();
  writeManifest(fx);
  const manifestPath = path.join(fx.stagingDir, "extract_manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete manifest.files["知识库/TheSchema/versions.yaml"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  const r = computeGraphFreshness({ vaultPath: fx.vault, dataDir: path.join(fx.dir, "data") });
  assert.equal(r.upToDate, false);
  assert.ok(r.changed.includes("versions.yaml"));
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("manifest 损坏（非 JSON）→ null（unknown，不假红也不假绿）", () => {
  const fx = makeFixture();
  fs.writeFileSync(path.join(fx.stagingDir, "extract_manifest.json"), "{broken", "utf8");
  const r = computeGraphFreshness({ vaultPath: fx.vault, dataDir: path.join(fx.dir, "data") });
  assert.equal(r.upToDate, null);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});
