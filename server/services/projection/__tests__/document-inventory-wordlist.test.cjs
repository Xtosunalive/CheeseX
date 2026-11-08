// Component: Document-Inventory-Wordlist-Test
// @responsible: seq194 刀2 词表单源快照锁——MULTI_FACETS 内容一字不差 + 防复活断言。
// @inputs: document-inventory-service.cjs（单源）、kg-routes.cjs（消费方源码）
// @outputs: node --test 断言结果
// @context: Canvas
// 红灯输入 = 审计族 W（ledger:48「逐字符同」）：收敛前 kg-routes.cjs:61 存在第二份字面量。
const { test } = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { MULTI_FACETS } = require("../document-inventory-service.cjs");

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

// ── 快照锁：词表内容一字不差（含顺序；篡改任一字符或乱序同键集均须红）──
test("MULTI_FACETS snapshot: exact content and order (seq194 wordlist SSOT)", () => {
  assert.deepStrictEqual(
    MULTI_FACETS,
    ["arch_status", "arch_category", "arch_layer", "arch_subdomain", "tags", "relationType", "documentKind", "graphStatus"],
  );
});

test("MULTI_FACETS is exported as the single source (module surface)", () => {
  assert.ok(Array.isArray(MULTI_FACETS) && MULTI_FACETS.length === 8);
});

// ── 防复活断言：kg-routes 不得再出现第二份词表字面量，必须引用单源 ──
test("kg-routes consumes the SSOT constant, no duplicated literal (anti-revival)", () => {
  const routesSrc = readFileSync(join(REPO_ROOT, "server", "routes", "kg-routes.cjs"), "utf8");
  assert.ok(
    !routesSrc.includes('const multi = ["arch_status"'),
    "kg-routes.cjs must not re-declare the MULTI_FACETS wordlist literal (audit family W revived)",
  );
  assert.ok(
    routesSrc.includes("MULTI_FACETS"),
    "kg-routes.cjs must reference the exported MULTI_FACETS constant",
  );
});

// ── 单源唯一性：service 源内 MULTI_FACETS 字面量定义仅出现一次 ──
test("MULTI_FACETS literal is declared exactly once in the service (SSOT uniqueness)", () => {
  const svcSrc = readFileSync(join(REPO_ROOT, "server", "services", "projection", "document-inventory-service.cjs"), "utf8");
  const hits = svcSrc.match(/const MULTI_FACETS = \[/g) || [];
  assert.strictEqual(hits.length, 1, "MULTI_FACETS wordlist must be declared exactly once");
});
