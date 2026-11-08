// domain-test-router.test.mjs — pre-commit 域测试路由纯函数（SPEC-025 C14/W0.5：执行器扩 Python 防假注册）
// 层级：纯单元。验证对象：collectDomainTests（域表 tests 字段 → 按暂存面路由 → node/py 两桶）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectDomainTests } from "../shared/domain-test-router.mjs";

const TABLES = [{ domains: [
  { id: "dom-a", authority: "contracts/a.json", writers: ["scripts/vault-py/a/"], tests: ["scripts/quality/__tests__/a.test.mjs", "scripts/vault-py/a/tests/test_a.py"] },
  { id: "dom-b", authority: "contracts/b.json", tests: ["server/x/__tests__/b.test.cjs", "scripts/vault-py/b/b_test.py", "docs/not-a-test.md"] },
]}];
const exists = () => true;

test("绿：触及域 → node 与 py 两桶分流（.py 被路由——W0.5 之前仅 cjs|mjs，py 登记即假注册）", () => {
  const r = collectDomainTests({ staged: ["contracts/a.json"], tables: TABLES, exists });
  assert.deepEqual(r.node, ["scripts/quality/__tests__/a.test.mjs"]);
  assert.deepEqual(r.py, ["scripts/vault-py/a/tests/test_a.py"]);
});

test("绿：writers 目录前缀触发＋两种 py 命名（test_x.py / x_test.py）＋非测试登记项忽略", () => {
  const r = collectDomainTests({ staged: ["scripts/vault-py/a/mod.py", "contracts/b.json"], tables: TABLES, exists });
  assert.deepEqual(r.py.sort(), ["scripts/vault-py/a/tests/test_a.py", "scripts/vault-py/b/b_test.py"]);
  assert.ok(!r.node.includes("docs/not-a-test.md") && !r.py.includes("docs/not-a-test.md"));
});

test("绿：未触及任何域 → 零路由", () => {
  const r = collectDomainTests({ staged: ["README.md"], tables: TABLES, exists });
  assert.deepEqual(r, { node: [], py: [] });
});

test("红：登记路径不存在的测试不路由（防悬空登记假绿）", () => {
  const r = collectDomainTests({ staged: ["contracts/a.json"], tables: TABLES, exists: (p) => !p.endsWith("test_a.py") });
  assert.deepEqual(r.py, []);
});
