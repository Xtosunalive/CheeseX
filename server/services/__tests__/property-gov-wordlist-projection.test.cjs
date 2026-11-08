// @responsible: seq203 族 W 收尾——property-gov 前后端字段词表投影锁（seq194 wordlist 同型）。
// 锁死关系：FormatArtifactCard.PROPOSAL_FIELDS ≡ FIELDS_TO_SCAN − "label"（一字不差）。
// 词表唯一事实源 = server/services/property-format-scan.cjs（seq203 自 property-governance-service 拆出），
// property-governance-service 保持 re-export 兼容（同引用）；前端禁 import server .cjs（既定立法），
// 故投影以源码解析断言。改任一端词表必须双端同步，否则本文件红灯。
const { test } = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const SCAN = join(__dirname, "..", "entity-compliance", "property-format-scan.cjs");
const SERVICE = join(__dirname, "..", "entity-compliance", "property-governance-service.cjs");
const CARD = join(__dirname, "..", "..", "..", "src", "features", "property-gov", "FormatArtifactCard.tsx");

const { FIELDS_TO_SCAN } = require(SCAN);
const serviceExports = require(SERVICE);
const cardSrc = readFileSync(CARD, "utf8");
const scanSrc = readFileSync(SCAN, "utf8");
const svcSrc = readFileSync(SERVICE, "utf8");

test("FIELDS_TO_SCAN snapshot: exact content and order (seq203 wordlist projection SSOT)", () => {
  assert.deepStrictEqual(FIELDS_TO_SCAN, [
    "module",
    "label",
    "arch_layer",
    "arch_category",
    "arch_status",
    "arch_subdomain",
  ]);
});

test("service re-export stays the same reference (module surface compat)", () => {
  assert.strictEqual(serviceExports.FIELDS_TO_SCAN, FIELDS_TO_SCAN, "re-export must not copy the wordlist");
  assert.strictEqual(typeof serviceExports.checkFormat, "function");
});

// SEQ203_PROJECTION：前端提案字段集合 ≡ 后端扫描字段 − label（一字不差投影）
test("SEQ203_PROJECTION: PROPOSAL_FIELDS ≡ FIELDS_TO_SCAN minus label (cross-end, source-parsed)", () => {
  const m = cardSrc.match(/PROPOSAL_FIELDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "FormatArtifactCard.tsx must declare PROPOSAL_FIELDS as the exported Set literal");
  const frontendFields = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const expected = FIELDS_TO_SCAN.filter((f) => f !== "label");
  assert.deepStrictEqual(
    frontendFields,
    expected,
    "PROPOSAL_FIELDS must stay the exact projection of backend FIELDS_TO_SCAN minus 'label' — update both ends together",
  );
});

test("anti-revival: card component body must not re-declare the wordlist literal (audit family W)", () => {
  assert.ok(
    !/new Set\(\[\s*"/.test(cardSrc.replace(/PROPOSAL_FIELDS = new Set\(\[[^\]]*\]\)/, "")),
    "FormatArtifactCard.tsx must not re-declare an inline field Set literal — reference PROPOSAL_FIELDS",
  );
  assert.ok(cardSrc.includes("PROPOSAL_FIELDS"), "FormatArtifactCard.tsx must reference the exported PROPOSAL_FIELDS");
});

test("SSOT uniqueness: FIELDS_TO_SCAN literal declared exactly once in the scan module, none in the service", () => {
  const hits = scanSrc.match(/var FIELDS_TO_SCAN = \[/g) || [];
  assert.strictEqual(hits.length, 1, "FIELDS_TO_SCAN wordlist must be declared exactly once (property-format-scan.cjs)");
  assert.strictEqual(
    (svcSrc.match(/var FIELDS_TO_SCAN = \[/g) || []).length,
    0,
    "property-governance-service.cjs must not re-declare the wordlist (require the scan module instead)",
  );
  assert.ok(
    /module\.exports[\s\S]*FIELDS_TO_SCAN/.test(svcSrc),
    "service must keep the FIELDS_TO_SCAN re-export in module.exports",
  );
});
