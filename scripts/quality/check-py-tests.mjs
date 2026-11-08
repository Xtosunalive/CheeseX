#!/usr/bin/env node
// check-py-tests.mjs — Python 域测试全量门禁（SPEC-025 C11，#75：CI Python 面）
// @responsible: 跑 scripts/vault-py/＋scripts/vault-runtime/__tests__/ 全量 pytest（串行默认）；
//   pytest 不可用 fail-closed 拦截（与 pre-commit Python 桶同款纪律——W0.5）。
//   解释器经 resolvePythonPath 单源解析（ADR-002：调用点禁止裸 python3／自写 PYTHON_PATH 回退）。
// @outputs: py_tests=ok N passed（exit 0）／py_tests=FAIL（exit 1）
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { resolvePythonPath } = require_("../../server/shared/python-path.cjs");
const pythonPath = resolvePythonPath();

const probe = spawnSync(pythonPath, ["-c", "import pytest"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error(`py_tests=FAIL——${pythonPath} 无 pytest（按 docs/环境启动说明.md 安装：uv pip install pytest 或 python3 -m pip install --user pytest）`);
  process.exit(1);
}
const r = spawnSync(pythonPath, ["-m", "pytest", "-p", "no:cacheprovider", "-q", "scripts/vault-py/", "scripts/vault-runtime/__tests__/"], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
