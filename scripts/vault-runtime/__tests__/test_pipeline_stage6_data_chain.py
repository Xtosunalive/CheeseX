#!/usr/bin/env python3
"""Slice QG.1.1.1: Pipeline Stage 6 生产测试契约 — 隔离与环境恢复。

通过 importlib.util 直接加载 pipeline-runner.py 模块。
临时目录每进程唯一 (mkdtemp)，环境变量保存/精确恢复。
支持并行运行多份测试进程无路径冲突。

覆盖(与 QG.1.1 相同断言):
  stage_6_verify 失败分支: checker 缺失 / spawn 异常 / timeout /
    非零退出 / 非法 JSON / 非对象 JSON / ok 缺失 / ok=false
  stage_6_verify 成功分支: exit=0 + ok=true
  --skip-api 由生产 _run_data_chain 传入
  凭据脱敏加强
  环境恢复 / 临时路径唯一性
"""
import importlib.util
import json
import os
import random
import shutil
import string
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
# A 类脚本按 PR-016 事实源取版：ARCH_REPO 注入时优先（待验分支修复经此进入测试链），
# 否则用 vault 镜像（realpath 同指主仓 scripts/vault-runtime）
_factsource = os.path.join(os.environ["ARCH_REPO"], "scripts", "vault-runtime") if os.environ.get("ARCH_REPO") else SCRIPTS_DIR
RUNNER_PATH = os.path.join(_factsource, "pipeline-runner.py")
# pipeline-runner 是 A 类脚本（vault 侧 symlink→repo scripts/vault-runtime），模块级导入
# _vault_ledger/_runtime_state_db 只在真身目录可解析——按 realpath 把真身目录上 path
# （缺此步时 setUpModule 加载即崩，tearDownModule 不执行，KB_VAULT/ARCH_REPO 泄漏污染后续模块）
RUNTIME_DIR = os.path.dirname(os.path.realpath(RUNNER_PATH))
if RUNTIME_DIR not in sys.path:
    sys.path.append(RUNTIME_DIR)  # 追加不抢位：vault 侧 kb_paths 优先，repo 目录只补 _vault_ledger 等缺口

# ── 模块级隔离状态（setUpModule 填充，tearDownModule 清理）──

pipeline = None           # importlib 加载的生产模块
_ARCH_DIR = None          # mkdtemp 临时 arch repo
_VAULT_DIR = None         # mkdtemp 临时 vault root
_SAVED_ENV = {}           # {name: (existed_before, old_value)}
_CHECKER_PATH = None      # canonical checker 路径

# KB_VAULT/ARCH_REPO：runner 行为注入；KB_DATA_DIR：runner 模块级 staging_path
# 落点（缺省 fail-closed，指到临时 arch repo 的 data/）
_ENV_NAMES = ("KB_VAULT", "ARCH_REPO", "KB_DATA_DIR")


def _rand_suffix(k=8):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=k))


def setUpModule():
    global pipeline, _ARCH_DIR, _VAULT_DIR, _SAVED_ENV, _CHECKER_PATH

    # 1) 保存环境变量原始状态
    for name in _ENV_NAMES:
        if name in os.environ:
            _SAVED_ENV[name] = (True, os.environ[name])
        else:
            _SAVED_ENV[name] = (False, None)

    # 2) 每次进程唯一临时目录
    suffix = _rand_suffix()
    _ARCH_DIR = tempfile.mkdtemp(prefix=f"qg111-arch-{suffix}-")
    _VAULT_DIR = tempfile.mkdtemp(prefix=f"qg111-vault-{suffix}-")

    os.makedirs(_VAULT_DIR, exist_ok=True)
    quality_dir = os.path.join(_ARCH_DIR, "scripts", "quality")
    os.makedirs(quality_dir, exist_ok=True)

    _CHECKER_PATH = os.path.join(quality_dir, "check-data-chain.mjs")
    with open(_CHECKER_PATH, "w") as f:
        f.write(_GOOD_CHECKER_SCRIPT)
    os.chmod(_CHECKER_PATH, 0o755)

    os.environ["KB_VAULT"] = _VAULT_DIR
    os.environ["ARCH_REPO"] = _ARCH_DIR
    os.environ["KB_DATA_DIR"] = os.path.join(_ARCH_DIR, "data")

    # 3) importlib 加载真实生产模块——加载失败时先恢复环境再抛，
    #    否则 tearDownModule 不执行、env 泄漏污染同进程后续测试模块（discover 模式实证）
    try:
        spec = importlib.util.spec_from_file_location("pipeline_runner", RUNNER_PATH)
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
    except BaseException:
        for name, (existed, old_val) in _SAVED_ENV.items():
            if existed:
                os.environ[name] = old_val
            else:
                os.environ.pop(name, None)
        raise


def tearDownModule():
    # 1) 精确恢复环境变量
    for name, (existed, old_val) in _SAVED_ENV.items():
        if existed:
            os.environ[name] = old_val
        else:
            os.environ.pop(name, None)

    # 2) 清理临时目录（无论成功失败）
    for d in (_ARCH_DIR, _VAULT_DIR):
        if d and os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)


# ── 测试用 checker 脚本 ──

_GOOD_CHECKER_SCRIPT = """#!/usr/bin/env node
const report = { ok: true, master: { ok: true, nodes: 10, connections: 20 },
  semantic: { components: 5, dependencies: 8 }, blockers: {} };
console.log(JSON.stringify(report));
process.exit(0);
"""

_BAD_EXIT_CHECKER_SCRIPT = """#!/usr/bin/env node
const report = { ok: false, master: { ok: false, nodes: 0, connections: 0 } };
console.log(JSON.stringify(report));
process.exit(1);
"""

_OK_FALSE_CHECKER_SCRIPT = """#!/usr/bin/env node
const report = { ok: false, master: { ok: true, nodes: 10, connections: 20 },
  blockers: { danglingDependencies: 1 } };
console.log(JSON.stringify(report));
process.exit(0);
"""

_INVALID_JSON_CHECKER_SCRIPT = """#!/usr/bin/env node
console.log("This is not JSON {broken:");
process.exit(0);
"""

_SKIP_API_FLAG_CHECKER = """#!/usr/bin/env node
const report = {
  ok: process.argv.includes("--skip-api"),
  args: process.argv.slice(2)
};
console.log(JSON.stringify(report));
process.exit(process.argv.includes("--skip-api") ? 0 : 1);
"""


def _make_subprocess_result(returncode=0, stdout="", stderr=""):
    r = MagicMock()
    r.returncode = returncode
    r.stdout = stdout
    r.stderr = stderr
    return r


def _arch_dir():
    return _ARCH_DIR


def _checker():
    return pipeline._resolve_data_chain_path()


# ══════════════════════════════════════════════════════════════
#  测试 0: 隔离性（最先运行）
# ══════════════════════════════════════════════════════════════

class TestIsolation(unittest.TestCase):
    """验证临时目录唯一性、环境变量恢复。"""

    def test_dirs_are_per_process_unique(self):
        self.assertIsNotNone(_ARCH_DIR)
        self.assertIsNotNone(_VAULT_DIR)
        # 路径不得包含旧固定名
        for d in (_ARCH_DIR, _VAULT_DIR):
            self.assertNotIn("test-arch-repo", d)
            self.assertNotIn("test-vault", d)

    def test_arch_and_vault_dirs_are_different(self):
        self.assertNotEqual(os.path.realpath(_ARCH_DIR),
                            os.path.realpath(_VAULT_DIR))

    def test_checker_exists_in_unique_dir(self):
        self.assertTrue(os.path.isfile(_CHECKER_PATH))
        self.assertIn(_ARCH_DIR, os.path.realpath(_CHECKER_PATH))

    def test_env_vars_point_to_unique_dirs(self):
        self.assertEqual(os.environ.get("KB_VAULT"), _VAULT_DIR)
        self.assertEqual(os.environ.get("ARCH_REPO"), _ARCH_DIR)

    def test_env_restore_kb_vault(self):
        name = "KB_VAULT"
        existed_before, old_val = _SAVED_ENV.get(name, (None, None))
        # setUpModule already ran, so env is set to mock now
        self.assertEqual(os.environ.get(name), _VAULT_DIR)
        # Simulate tearDown logic
        if existed_before:
            os.environ[name] = old_val
        else:
            os.environ.pop(name, None)
        if existed_before:
            self.assertEqual(os.environ[name], old_val)
        else:
            self.assertNotIn(name, os.environ)
        # Restore for subsequent tests
        os.environ[name] = _VAULT_DIR

    def test_env_restore_arch_repo(self):
        name = "ARCH_REPO"
        existed_before, old_val = _SAVED_ENV.get(name, (None, None))
        self.assertEqual(os.environ.get(name), _ARCH_DIR)
        if existed_before:
            os.environ[name] = old_val
        else:
            os.environ.pop(name, None)
        if existed_before:
            self.assertEqual(os.environ[name], old_val)
        else:
            self.assertNotIn(name, os.environ)
        os.environ[name] = _ARCH_DIR

    def test_saved_env_has_both_keys(self):
        for name in _ENV_NAMES:
            self.assertIn(name, _SAVED_ENV, f"{name} 应被保存")


# ══════════════════════════════════════════════════════════════
#  测试 1: 生产 helper 单元测试
# ══════════════════════════════════════════════════════════════

class TestStage6ProductionHelpers(unittest.TestCase):

    def test_resolve_data_chain_path_is_canonical(self):
        resolved = pipeline._resolve_data_chain_path()
        self.assertIn("quality", resolved)
        self.assertTrue(resolved.endswith("scripts/quality/check-data-chain.mjs"),
                        f"路径不正确: {resolved}")

    def test_old_path_not_in_resolver(self):
        resolved = pipeline._resolve_data_chain_path()
        old = os.path.join(_ARCH_DIR, "scripts", "check-data-chain.mjs")
        self.assertNotEqual(os.path.realpath(resolved), os.path.realpath(old))

    # ── _run_data_chain ──

    def test_run_data_chain_passes_skip_api(self):
        cp = _checker()
        with open(cp, "w") as f:
            f.write(_SKIP_API_FLAG_CHECKER)
        try:
            exit_code, stdout, stderr, report = pipeline._run_data_chain(cp)
            self.assertEqual(exit_code, 0, f"--skip-api 未传入: exit={exit_code}")
            self.assertTrue(isinstance(report, dict) and report.get("ok") is True)
        finally:
            with open(cp, "w") as f:
                f.write(_GOOD_CHECKER_SCRIPT)

    def test_run_data_chain_ok_true(self):
        cp = _checker()
        exit_code, stdout, stderr, report = pipeline._run_data_chain(cp)
        self.assertEqual(exit_code, 0)
        self.assertTrue(isinstance(report, dict) and report.get("ok") is True)

    def test_run_data_chain_ok_false_exit_nonzero(self):
        cp = _checker()
        with open(cp, "w") as f:
            f.write(_BAD_EXIT_CHECKER_SCRIPT)
        try:
            exit_code, stdout, stderr, report = pipeline._run_data_chain(cp)
            self.assertEqual(exit_code, 1)
            self.assertTrue(isinstance(report, dict) and report.get("ok") is False)
        finally:
            with open(cp, "w") as f:
                f.write(_GOOD_CHECKER_SCRIPT)

    def test_run_data_chain_invalid_json(self):
        cp = _checker()
        with open(cp, "w") as f:
            f.write(_INVALID_JSON_CHECKER_SCRIPT)
        try:
            exit_code, stdout, stderr, report = pipeline._run_data_chain(cp)
            self.assertEqual(exit_code, 0)
            self.assertIsNone(report)
        finally:
            with open(cp, "w") as f:
                f.write(_GOOD_CHECKER_SCRIPT)

    def test_run_data_chain_ok_false_exit_zero(self):
        cp = _checker()
        with open(cp, "w") as f:
            f.write(_OK_FALSE_CHECKER_SCRIPT)
        try:
            exit_code, stdout, stderr, report = pipeline._run_data_chain(cp)
            self.assertEqual(exit_code, 0)
            self.assertTrue(isinstance(report, dict) and report.get("ok") is False)
        finally:
            with open(cp, "w") as f:
                f.write(_GOOD_CHECKER_SCRIPT)

    # ── _evaluate_data_chain ──

    def test_evaluate_missing_checker_fails(self):
        missing = os.path.join(_ARCH_DIR, "nonexistent", "check.mjs")
        ok, msg = pipeline._evaluate_data_chain(0, "", "", None, missing)
        self.assertFalse(ok)
        self.assertIn("缺失", msg)

    def test_evaluate_spawn_exception_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(-1, "", "node 命令不可用", None, cp)
        self.assertFalse(ok)
        self.assertIn("未执行", msg)

    def test_evaluate_timeout_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(-1, "", "超时 (60s)", None, cp)
        self.assertFalse(ok)
        self.assertIn("未执行", msg)

    def test_evaluate_nonzero_exit_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(1, json.dumps({"ok": False}), "", None, cp)
        self.assertFalse(ok)
        self.assertIn("退出码 1", msg)

    def test_evaluate_nonzero_exit_ok_true_still_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(1, json.dumps({"ok": True}), "", {"ok": True}, cp)
        self.assertFalse(ok)
        self.assertIn("退出码 1", msg)

    def test_evaluate_invalid_json_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(0, "not json", "", None, cp)
        self.assertFalse(ok)
        self.assertIn("非法 JSON", msg)

    def test_evaluate_non_dict_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(0, '["array"]', "", ["array"], cp)
        self.assertFalse(ok)
        self.assertIn("非法 JSON", msg)

    def test_evaluate_empty_report_fails(self):
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(0, "{}", "", {}, cp)
        self.assertFalse(ok)
        self.assertIn("ok=None", msg)

    def test_evaluate_ok_false_fails(self):
        report = {"ok": False, "blockers": {"danglingDependencies": 1}}
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(0, json.dumps(report), "", report, cp)
        self.assertFalse(ok)
        self.assertIn("不一致", msg)

    def test_evaluate_ok_missing_fails(self):
        report = {"master": {"nodes": 10}}
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(0, json.dumps(report), "", report, cp)
        self.assertFalse(ok)
        self.assertIn("ok=None", msg)

    def test_evaluate_ok_true_passes(self):
        report = {"ok": True, "master": {"ok": True, "nodes": 10}}
        cp = _checker()
        ok, msg = pipeline._evaluate_data_chain(0, json.dumps(report), "", report, cp)
        self.assertTrue(ok)
        self.assertEqual(msg, "数据链一致")


# ══════════════════════════════════════════════════════════════
#  测试 2: stage_6_verify 调用链
# ══════════════════════════════════════════════════════════════

class TestStage6VerifyCallChain(unittest.TestCase):

    def setUp(self):
        self._orig_api_port = pipeline.API_PORT
        pipeline.API_PORT = None

    def tearDown(self):
        pipeline.API_PORT = self._orig_api_port

    def _call_verify(self, returncode, stdout, stderr=""):
        mock_result = _make_subprocess_result(returncode, stdout, stderr)
        with patch.object(pipeline.subprocess, "run", return_value=mock_result):
            return pipeline.stage_6_verify()

    def test_ok_true_returns_true(self):
        r = {"ok": True, "master": {"ok": True, "nodes": 10},
             "semantic": {"components": 1, "dependencies": 1}, "blockers": {}}
        ok, msg, _data = self._call_verify(0, json.dumps(r))
        self.assertTrue(ok, f"应返回 True: {msg}")

    def test_ok_false_returns_false(self):
        ok, msg, _data = self._call_verify(0, json.dumps({"ok": False}))
        self.assertFalse(ok)

    def test_nonzero_exit_returns_false(self):
        ok, msg, _data = self._call_verify(1, '{"ok": true}')
        self.assertFalse(ok)

    def test_invalid_json_returns_false(self):
        ok, msg, _data = self._call_verify(0, "not json")
        self.assertFalse(ok)

    def test_non_dict_returns_false(self):
        ok, msg, _data = self._call_verify(0, "[1,2,3]")
        self.assertFalse(ok)

    def test_ok_missing_returns_false(self):
        ok, msg, _data = self._call_verify(0, '{"master": {"nodes": 0}}')
        self.assertFalse(ok)

    def test_spawn_exception_returns_false(self):
        with patch.object(pipeline.subprocess, "run",
                          side_effect=FileNotFoundError("node")):
            ok, msg, _data = pipeline.stage_6_verify()
        self.assertFalse(ok)

    def test_timeout_returns_false(self):
        with patch.object(pipeline.subprocess, "run",
                          side_effect=subprocess.TimeoutExpired("node", 60)):
            ok, msg, _data = pipeline.stage_6_verify()
        self.assertFalse(ok)

    def test_checker_missing_returns_false(self):
        with patch.object(pipeline, "_resolve_data_chain_path",
                          return_value=os.path.join(_ARCH_DIR, "gone", "check.mjs")):
            ok, msg, _data = pipeline.stage_6_verify()
        self.assertFalse(ok)
        self.assertIn("缺失", msg)

    def test_uses_skip_api(self):
        captured_cmd = []

        def capture(cmd, **kw):
            captured_cmd.append(cmd)
            return _make_subprocess_result(0, '{"ok": true}')

        with patch.object(pipeline.subprocess, "run", side_effect=capture):
            pipeline.stage_6_verify()

        self.assertTrue(len(captured_cmd) > 0)
        self.assertIn("--skip-api", captured_cmd[0])


# ══════════════════════════════════════════════════════════════
#  测试 3: 凭据脱敏
# ══════════════════════════════════════════════════════════════

class TestStage6CredentialSanitization(unittest.TestCase):

    def test_no_home(self):
        diag = pipeline._data_chain_diag("HOME=/Users/alice\nnormal")
        self.assertNotIn("HOME=", diag)
        self.assertIn("normal", diag)

    def test_no_home_lower(self):
        diag = pipeline._data_chain_diag("export home=/users/alice\nnormal")
        self.assertNotIn("home=", diag.lower())
        self.assertIn("normal", diag)

    def test_no_token_upper(self):
        diag = pipeline._data_chain_diag("API_TOKEN=sk-deadbeef\nnormal")
        self.assertNotIn("sk-deadbeef", diag)

    def test_no_token_lower(self):
        diag = pipeline._data_chain_diag("github_token=ghp_xxxx\nnormal")
        self.assertNotIn("ghp_xxxx", diag)

    def test_no_secret_upper(self):
        diag = pipeline._data_chain_diag("CLIENT_SECRET=abc123\nnormal")
        self.assertNotIn("abc123", diag)

    def test_no_secret_lower(self):
        diag = pipeline._data_chain_diag("db_secret=xyz789\nnormal")
        self.assertNotIn("xyz789", diag)

    def test_no_password_upper(self):
        diag = pipeline._data_chain_diag("DB_PASSWORD=p@ssw0rd\nnormal")
        self.assertNotIn("p@ssw0rd", diag)

    def test_no_password_lower(self):
        diag = pipeline._data_chain_diag("user_password=letmein\nnormal")
        self.assertNotIn("letmein", diag)

    def test_no_api_key_upper(self):
        diag = pipeline._data_chain_diag("API_KEY=key-12345\nnormal")
        self.assertNotIn("key-12345", diag)

    def test_no_api_key_lower(self):
        diag = pipeline._data_chain_diag("api_key=sk-live-abc\nnormal")
        self.assertNotIn("sk-live-abc", diag)

    def test_no_api_key_kebab(self):
        diag = pipeline._data_chain_diag('x-api-key: abc-def-ghi\nnormal')
        self.assertNotIn("abc-def-ghi", diag)

    def test_no_authorization(self):
        diag = pipeline._data_chain_diag("Authorization: Bearer eyJ\nnormal")
        self.assertNotIn("eyJ", diag)

    def test_no_authorization_lower(self):
        diag = pipeline._data_chain_diag("authorization: Basic dXNl\nnormal")
        self.assertNotIn("dXNl", diag)

    def test_no_bearer(self):
        diag = pipeline._data_chain_diag("set Bearer abc123token\nnormal")
        self.assertNotIn("abc123token", diag)

    def test_truncation(self):
        long_text = "\n".join(f"line {i}: msg" for i in range(50))
        diag = pipeline._data_chain_diag(long_text)
        self.assertLessEqual(len(diag.split("\n")), 10)

    def test_empty(self):
        self.assertEqual(pipeline._data_chain_diag(""), "")
        self.assertEqual(pipeline._data_chain_diag(None), "")


# ══════════════════════════════════════════════════════════════
#  测试 4: 旧路径检查
# ══════════════════════════════════════════════════════════════

class TestStage6OldPathNotUsed(unittest.TestCase):

    def test_source_has_no_old_path(self):
        with open(RUNNER_PATH, "r") as f:
            content = f.read()
        self.assertNotIn("scripts/check-data-chain.mjs", content)

    def test_resolve_uses_canonical(self):
        resolved = pipeline._resolve_data_chain_path()
        self.assertIn("quality", resolved)

    def test_no_copied_helper_defs(self):
        with open(__file__, "r") as f:
            lines = f.readlines()
        old = ["_resolve_checker_path", "_run_data_chain_check",
               "_evaluate_data_chain_result", "_truncate_diagnostics"]
        for i, line in enumerate(lines):
            s = line.strip()
            if s.startswith("def ") and any(s.startswith(f"def {n}(") for n in old):
                self.fail(f"line {i+1}: 旧版 helper 定义: {s}")


class TestRealDataChainOntology(unittest.TestCase):
    def run_checker(self, ontology, relation_type, dependencies=None):
        repo = os.path.abspath(os.path.join(RUNTIME_DIR, "..", ".."))
        checker = os.path.join(repo, "scripts", "quality", "check-data-chain.mjs")
        with tempfile.TemporaryDirectory(prefix="ontology-data-chain-") as root:
            schema_dir = os.path.join(root, "TheSchema")
            os.mkdir(schema_dir)
            documents = {
                os.path.join(schema_dir, "enums.yaml"): {},
                os.path.join(schema_dir, "ontology.yaml"): ontology,
                os.path.join(root, "master.json"): {"nodes": [], "connections": [{"relationType": relation_type}]},
                os.path.join(root, "semantic.json"): {"components": [{"id": "n"}] if dependencies else [], "dependencies": dependencies or []},
                os.path.join(root, "layout.json"): {"nodes": {"n": {}} if dependencies else {}},
            }
            for filename, document in documents.items():
                with open(filename, "w", encoding="utf-8") as handle:
                    json.dump(document, handle)
            env = dict(os.environ, KB_VAULT=root, VAULT_PATH=root, ARCH_REPO=repo,
                       THESCHEMA_DIR=schema_dir, KB_DATA_DIR=root)
            result = subprocess.run([
                "node", checker, "--skip-consistency",
                "--master", os.path.join(root, "master.json"),
                "--semantic", os.path.join(root, "semantic.json"),
                "--layout", os.path.join(root, "layout.json"),
            ], cwd=repo, env=env, capture_output=True, text=True, timeout=30)
            report = json.loads(result.stdout)
            self.assertEqual(result.returncode, 0 if report["ok"] else 1, result.stderr)
            for filename, document in documents.items():
                with open(filename, encoding="utf-8") as handle:
                    self.assertEqual(handle.read(), json.dumps(document), "只读检查不得回填历史文件")
            return report

    def test_only_approved_relations_are_active(self):
        for definition in ({}, {"lifecycle_status": "approved"}):
            report = self.run_checker({"relation_types": {"R": definition}}, "R")
            self.assertTrue(report["ok"], report)
            self.assertEqual(report["ontology"]["relation_types"], 1)
        for status in ("draft", "submitted", "reserved", "retired", "unknown"):
            with self.subTest(status=status):
                report = self.run_checker({"relation_types": {"R": {"lifecycle_status": status}}}, "R")
                self.assertFalse(report["ok"])
                self.assertEqual(report["ontology"]["relation_types"], 0)
                self.assertEqual(report["blockers"]["ontologyRelationDrift"], 1)
                self.assertTrue(report["ontology"]["reference_errors"])
        self.assertFalse(self.run_checker({"relation_types": {}}, "R")["ok"], "空注册表不能放行未知关系")

    def test_retired_history_resolves_without_becoming_active_or_rewriting(self):
        ontology = {"relation_types": {
            "A": {"lifecycle_status": "retired", "retirement": {"reason": "a", "replaced_by": "B"}},
            "B": {"lifecycle_status": "retired", "retirement": {"reason": "b", "replaced_by": "C"}},
            "C": {},
            "Pending": {"lifecycle_status": "draft"},
        }}
        for _ in range(2):
            report = self.run_checker(ontology, "A", [{"from": "n", "to": "n", "relationType": "A"}])
            self.assertTrue(report["ok"], report)
            self.assertEqual(report["ontology"]["relation_types"], 1)
            self.assertEqual(report["ontology"]["normalized_references"], [{
                "original_id": "A", "resolved_id": "C", "replacement_chain": ["A", "B", "C"],
            }])

    def test_invalid_history_reports_reason_and_blocks(self):
        cases = [
            ({"A": {"lifecycle_status": "retired", "retirement": {"replaced_by": "Missing"}}}, "DANGLING_REPLACEMENT"),
            ({"A": {"lifecycle_status": "retired", "retirement": {"replaced_by": "A"}}}, "REPLACEMENT_SELF_REFERENCE"),
            ({"A": {"lifecycle_status": "retired", "retirement": {"replaced_by": "B"}},
              "B": {"lifecycle_status": "retired", "retirement": {"replaced_by": "A"}}}, "REPLACEMENT_CYCLE"),
            ({"A": {"lifecycle_status": "retired", "retirement": {"replaced_by": "B"}},
              "B": {"lifecycle_status": "draft"}}, "NO_APPROVED_REPLACEMENT"),
        ]
        for relations, error_code in cases:
            with self.subTest(error_code=error_code):
                report = self.run_checker({"relation_types": relations}, "A")
                self.assertFalse(report["ok"])
                self.assertEqual(report["ontology"]["reference_errors"][0]["code"], error_code)
        cross_type = self.run_checker({"node_types": {"Node": {}}, "relation_types": {
            "A": {"lifecycle_status": "retired", "retirement": {"replaced_by": "Node"}},
        }}, "A")
        self.assertFalse(cross_type["ok"])
        self.assertEqual(cross_type["ontology"]["reference_errors"][0]["code"], "CROSS_TYPE_REPLACEMENT")

    def test_retirement_does_not_bypass_legacy_delete(self):
        for deleted_id in ("A", "B"):
            ontology = {"relation_types": {
                "A": {"lifecycle_status": "retired", "retirement": {"reason": "a", "replaced_by": "B"}},
                "B": {},
            }}
            ontology["relation_types"][deleted_id]["legacy_policy"] = "delete"
            report = self.run_checker(ontology, "A")
            self.assertFalse(report["ok"])
            self.assertEqual(report["blockers"]["legacyDeleteRelationsProduced"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
