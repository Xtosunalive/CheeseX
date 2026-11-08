import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# A 类脚本按 PR-016 事实源取版：ARCH_REPO 注入时优先（待验分支修复经此进入测试链），
# 否则用 vault 镜像（realpath 同指主仓 scripts/vault-runtime）
_factsource = os.path.join(os.environ["ARCH_REPO"], "scripts", "vault-runtime") if os.environ.get("ARCH_REPO") else SCRIPT_DIR
SCRIPT_PATH = os.path.join(_factsource, "generate-sa.py")
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
# generate-sa 是 A 类脚本（vault 侧 symlink→repo scripts/vault-runtime），其模块级
# `from _vault_ledger import ledger` 只在真身目录可解析——按 realpath 把真身目录上 path
RUNTIME_DIR = os.path.dirname(os.path.realpath(SCRIPT_PATH))
if RUNTIME_DIR not in sys.path:
    sys.path.append(RUNTIME_DIR)  # 追加不抢位：vault 侧 kb_paths 优先，repo 目录只补 _vault_ledger 等缺口


def load_generate_sa():
    spec = importlib.util.spec_from_file_location("generate_sa", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256_or_none(file_path):
    if not os.path.exists(file_path):
        return None
    with open(file_path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


class GenerateSaVersionContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # generate-sa 模块级 staging_path 需要 KB_DATA_DIR（缺省 fail-closed）；
        # PROJECTION_SCHEMA 需要 architecture_projection 产品身份——真库现为 ADR-009 元层态
        # （主体挂起、身份为空，import 即 ValueError），测试钉 THESCHEMA_DIR 到带身份的 fixture
        import tempfile
        cls._saved = {k: os.environ.get(k) for k in ("KB_DATA_DIR", "THESCHEMA_DIR", "KB_VAULT")}
        if not cls._saved["KB_DATA_DIR"]:
            os.environ["KB_DATA_DIR"] = tempfile.mkdtemp(prefix="generate-sa-test-")
        # --json 预览经 project_dependencies 读 staging 主图——临时数据目录自含最小图
        # （旧测试隐式依赖真库 .ledger 旧位，SPEC-012 后该位无写者）
        staging = Path(os.environ["KB_DATA_DIR"]) / "staging"
        staging.mkdir(parents=True, exist_ok=True)
        if not (staging / "master_graph.json").exists():
            (staging / "master_graph.json").write_text(
                json.dumps({"_format_version": "1.0", "nodes": [], "connections": []}), encoding="utf-8")
        cls._schema_dir = tempfile.mkdtemp(prefix="generate-sa-theschema-")
        import yaml
        with open(os.path.join(cls._schema_dir, "enums.yaml"), "w", encoding="utf-8") as handle:
            yaml.safe_dump({
                "architecture_projection": {"product": "FixtureProduct", "version": "v1"},
                "layers": [{"id": "application"}],
            }, handle, allow_unicode=True)
        os.environ["THESCHEMA_DIR"] = cls._schema_dir
        cls.module = load_generate_sa()

    @classmethod
    def tearDownClass(cls):
        import shutil
        for key, value in cls._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(cls._schema_dir, ignore_errors=True)

    def test_component_until_is_exclusive(self):
        fixture_path = os.environ.get("VERSION_CONTRACT_FIXTURE")
        if not fixture_path:
            self.skipTest("VERSION_CONTRACT_FIXTURE 未注入（JS/Python parity 编排器提供；单跑跳过）")
        with open(fixture_path, "r", encoding="utf-8") as handle:
            fixture = json.load(handle)
        for item in fixture["ranges"]:
            component = {"arch_since": item["since"] or "", "arch_until": item["until"] or ""}
            self.assertEqual(
                self.module.component_active_at(component, item["version"]),
                item["active"],
                item,
            )

    def test_json_preview_is_machine_readable_and_does_not_write_artifacts(self):
        before_sa = sha256_or_none(self.module.SA_PATH)
        before_layout = sha256_or_none(self.module.LAYOUT_PATH)
        # ARCH_REPO 事实源取版时脚本住在 repo 侧，KB_VAULT 缺省推导失效——显式钉到
        # vault 镜像所在仓根（realpath 三级上溯），未设才补
        env = {**os.environ}
        if not env.get("KB_VAULT"):
            env["KB_VAULT"] = os.path.realpath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH, "--json", "--version", "7.0"],
            cwd=SCRIPT_DIR,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["_generated_for_version"], "7.0")
        self.assertIn("_generated_at", payload)
        self.assertIsInstance(payload["components"], list)
        self.assertTrue(all(
            component["sourcePath"].startswith("知识库/wiki/entities/")
            and not os.path.isabs(component["sourcePath"])
            for component in payload["components"]
        ))
        self.assertIsInstance(payload["dependencies"], list)
        self.assertEqual(sha256_or_none(self.module.SA_PATH), before_sa)
        self.assertEqual(sha256_or_none(self.module.LAYOUT_PATH), before_layout)


if __name__ == "__main__":
    unittest.main()
