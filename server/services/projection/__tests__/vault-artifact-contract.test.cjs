// vault-artifact-contract.test.cjs — Consumer-driven contract tests for Vault artifacts.
// Pattern: node --test runner, passed++/failed++ counters.
const fs = require("fs");
const path = require("path");
const os = require("os");

var passed = 0, failed = 0;
function assertEq(a, e, l) { if (a === e) passed++; else { console.error("FAIL: " + l + " — expected " + JSON.stringify(e) + ", got " + JSON.stringify(a)); failed++; } }
function assert(c, l) { if (c) passed++; else { console.error("FAIL: " + l); failed++; } }

var mgs = require("../master-graph-service.cjs");
var sas = require("../semantic-architecture-service.cjs");

var FIXTURE_DIR = path.resolve(__dirname, "../../../../test/fixtures");
var MG_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "master_graph.v1.json"), "utf-8"));
var SA_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "semantic_architecture.v1.json"), "utf-8"));

// ===== Format Version Validation: master_graph =====
// SPEC-012 wave-2 图族：主图真身迁 derived-index.db——版本契约测试改种 store 原文行
var tempVault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-contract-mg-"));
var ledgerDir = path.join(tempVault, ".ledger");
fs.mkdirSync(ledgerDir, { recursive: true });
mgs.setVaultPath(tempVault);
var { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
var graphStore = getDerivedIndexStore(tempVault);

// Test: matching _format_version
graphStore.artifacts.put("master_graph", JSON.stringify(MG_FIXTURE));
var result = mgs.readMasterGraph();
assert(result !== null, "MG: matching _format_version -> data returned");
assertEq(result.nodes.length, 5, "MG: 5 nodes in fixture");

// Test: missing _format_version -> warning, data still returned
var noVersionGraph = JSON.parse(JSON.stringify(MG_FIXTURE));
delete noVersionGraph._format_version;
graphStore.artifacts.put("master_graph", JSON.stringify(noVersionGraph));
var result2 = mgs.readMasterGraph();
assert(result2 !== null, "MG: missing _format_version -> data still returned (backward compat)");

// Test: incompatible major version -> throws FORMAT_VERSION_MISMATCH
var badVersionGraph = JSON.parse(JSON.stringify(MG_FIXTURE));
badVersionGraph._format_version = "9.0";
graphStore.artifacts.put("master_graph", JSON.stringify(badVersionGraph));
var threwVersion = false;
try { mgs.readMasterGraph(); } catch (e) { threwVersion = true; assertEq(e.code, "FORMAT_VERSION_MISMATCH", "MG: incompatible version throws FORMAT_VERSION_MISMATCH"); }
assert(threwVersion, "MG: incompatible _format_version -> throws");

// Test: minor version bump within same major -> ok
var minorBumpGraph = JSON.parse(JSON.stringify(MG_FIXTURE));
minorBumpGraph._format_version = "1.5";
graphStore.artifacts.put("master_graph", JSON.stringify(minorBumpGraph));
var result3 = mgs.readMasterGraph();
assert(result3 !== null, "MG: minor version bump (1.5) within major 1 -> still accepted");

fs.rmSync(tempVault, { recursive: true, force: true });

// ===== Format Version Validation: semantic_architecture =====
// PR-082：SA 派生通用槽迁库——同主图段改种 store 原文行（旧 vault 产品段路径退役）

var saVault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-contract-sa-"));
sas.setVaultPath(saVault);
var saStore = getDerivedIndexStore(saVault);

// Test: matching _format_version
saStore.artifacts.put("sa", JSON.stringify(SA_FIXTURE));
var saResult = sas.readSemanticArchitecture();
assert(saResult !== null, "SA: matching _format_version -> data returned");
assertEq(saResult.components.length, 2, "SA: 2 components in fixture");
assertEq(saResult.layers.length, 3, "SA: 3 layers in fixture");

// Test: missing _format_version -> warning, data still returned
var noVersionSA = JSON.parse(JSON.stringify(SA_FIXTURE));
delete noVersionSA._format_version;
saStore.artifacts.put("sa", JSON.stringify(noVersionSA));
var saResult2 = sas.readSemanticArchitecture();
assert(saResult2 !== null, "SA: missing _format_version -> data still returned");

// SA freshness (must run before bad-version test which corrupts the file)
var freshSA = JSON.parse(JSON.stringify(SA_FIXTURE));
freshSA.updatedAt = "2020-01-01";
freshSA._generated_at = new Date().toISOString();
saStore.artifacts.put("sa", JSON.stringify(freshSA));
var freshness = sas.validateFreshness(24);
assert(freshness.fresh, "SA freshness: current generation time wins over source update date");
assertEq(freshness.version, "1.0.0", "SA freshness: version from fixture");

// Test: incompatible version -> throws
var badVersionSA = JSON.parse(JSON.stringify(SA_FIXTURE));
badVersionSA._format_version = "2.0";
saStore.artifacts.put("sa", JSON.stringify(badVersionSA));
var threwSA = false;
try { sas.readSemanticArchitecture(); } catch (e) { threwSA = true; assertEq(e.code, "FORMAT_VERSION_MISMATCH", "SA: incompatible version throws FORMAT_VERSION_MISMATCH"); }
assert(threwSA, "SA: incompatible _format_version -> throws");

fs.rmSync(saVault, { recursive: true, force: true });

// ===== Schema Validation: master_graph normalization =====

var normalized = mgs.normalizeTopology(MG_FIXTURE);
assertEq(normalized.nodes.length, 5, "Normalize: 5 nodes");
assertEq(normalized.edges.length, 3, "Normalize: 3 edges");

var filtered = mgs.filterTopologyEntities(normalized.nodes, normalized.edges);
assertEq(filtered.nodes.length, 3, "Entity filter: 3 entity nodes (2 AC + 1 Module)");
assertEq(filtered.edges.length, 2, "Entity filter: 2 edges between entities");

// ===== EXPECTED_FORMAT_VERSION constants =====

assertEq(mgs.EXPECTED_FORMAT_VERSION, "1.0", "MG: EXPECTED_FORMAT_VERSION is '1.0'");
assertEq(sas.EXPECTED_FORMAT_VERSION, "1.0", "SA: EXPECTED_FORMAT_VERSION is '1.0'");

console.log("vault-artifact-contract tests: " + passed + " passed, " + failed + " failed");
if (!process.env.VITEST) process.exit(failed > 0 ? 1 : 0);
