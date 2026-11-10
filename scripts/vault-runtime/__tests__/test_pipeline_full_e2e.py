import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

import yaml


SCRIPT_DIR = Path(__file__).resolve().parents[1]
KNOWLEDGE_DIR = SCRIPT_DIR.parents[1]
# ARCH_REPO 缺省经 A 类脚本 symlink 真身定位（vault→repo 布局下无 ../cheese-h 旧库可依）：
# scripts/tests → 知识库/.claude/scripts/pipeline-runner.py 是 symlink，realpath 后三级上溯＝repo 根
_arch_repo_env = os.environ.get("ARCH_REPO")
REBUILD_ROOT = Path(_arch_repo_env) if _arch_repo_env else Path(
    os.path.realpath(SCRIPT_DIR / "pipeline-runner.py")).parents[2]


def wait_for_api(process):
    # PR-097：启动等待预算可配（PIPELINE_E2E_API_TIMEOUT，秒）＋默认自 10s 加宽至 60s——
    # 全量链并发负载下 node 冷启可超 10s（WP-006 集成四轮实测 1 轮超时；单跑 ~3s 不变——
    # 预算只在失败路径生效，过闸速度不受影响）。
    budget = float(os.environ.get("PIPELINE_E2E_API_TIMEOUT", "60"))
    started_at = time.time()
    deadline = started_at + budget
    while time.time() < deadline:
        line = process.stdout.readline()
        if not line:
            if process.poll() is not None:
                raise AssertionError(f"API 提前退出: {process.stderr.read()}")
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("event") == "server-start":
            return entry["port"]
    raise AssertionError(
        f"等待 API 启动超时（预算 {budget:.0f}s 已用尽；进程 poll={process.poll()}——"
        "链上并发负载下调大 PIPELINE_E2E_API_TIMEOUT，或查 API 自身启动日志）"
    )


def get_json(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status, json.loads(response.read())



def _settle_before_teardown(root, timeout_s=5.0, window_s=0.3):
    """PR-210：拆临时树前等写者静默（连续两窗无 mtime/条目变化）。只等待、不吞错。"""
    import time as _time

    def _snapshot(base):
        marks = []
        for dirpath, _dirnames, filenames in os.walk(base):
            try:
                marks.append(os.stat(dirpath).st_mtime)
            except OSError:
                pass
            for name in filenames:
                try:
                    marks.append(os.stat(os.path.join(dirpath, name)).st_mtime)
                except OSError:
                    pass
        return marks

    deadline = _time.monotonic() + timeout_s
    prev = _snapshot(root)
    while _time.monotonic() < deadline:
        _time.sleep(window_s)
        cur = _snapshot(root)
        if cur == prev:
            return
        prev = cur


class FullPipelineE2ETest(unittest.TestCase):
    maxDiff = None

    def test_one_markdown_reaches_artifacts_and_http(self):
        self.assertTrue((REBUILD_ROOT / "server" / "main.cjs").is_file())
        self.assertTrue((REBUILD_ROOT / "scripts" / "quality" / "check-data-chain.mjs").is_file())

        with tempfile.TemporaryDirectory(prefix="pipeline-one-md-") as temp_dir:
            vault = Path(temp_dir)
            scripts = vault / "知识库" / ".claude" / "scripts"
            shutil.copytree(
                SCRIPT_DIR,
                scripts,
                ignore=shutil.ignore_patterns("tests", "__pycache__", "graph_data.json"),
            )
            # A 类脚本按 PR-016 事实源取 ARCH_REPO 版覆盖 vault 镜像副本——vault symlink
            # 指向主仓工作区，待验分支的修复只有经 ARCH_REPO 注入才会进入临时执行链
            for _name in ("pipeline-runner.py", "generate-sa.py", "schema_loader.py",
                          "kb_paths.py", "promote-article.py", "sa_projection_support.py"):
                _src = REBUILD_ROOT / "scripts" / "vault-runtime" / _name
                if _src.is_file():
                    shutil.copy2(_src, scripts / _name)
            # SPEC-023 切换后 TheSchema 主源在 repo data/theschema（vault 侧已封存为 legacy 归档）；
            # 落位到临时 vault 的 知识库/TheSchema 以维持 theschema_dir「vault 优先」解析次序不变
            # PR-158：源改洁净基线夹具——repo data/theschema 是活库运行态载体（released 版本/依赖
            # 引用随用随长），活态依赖按真库图节点校验使夹具管道 Stage 1 exit 1（doc-article-agents 前科）
            shutil.copytree(REBUILD_ROOT / "test" / "fixtures" / "theschema-baseline", vault / "知识库" / "TheSchema")
            # schema_loader 的 contracts 形态源按真库同构挂 symlink（副本脱离 repo 结构后
            # realpath 相对推导会指向临时 vault 内不存在的 知识库/contracts）
            (vault / "知识库" / "contracts").symlink_to(REBUILD_ROOT / "contracts")

            enums_path = vault / "知识库" / "TheSchema" / "enums.yaml"
            enums = yaml.safe_load(enums_path.read_text(encoding="utf-8"))
            # 元层态（ADR-009：AnyShare 主体挂起）真库 modules 为空——无模板可抄时自建
            # 最小合法定义（各字段 schema 皆可选；subdomain 取注册表现存词条防校验踩空）
            template_module = next(iter(enums["modules"].values())) if enums.get("modules") else {
                "subdomain": "architecture", "system": "fixture-system",
                "since": "1.0", "products": ["FixtureProduct"],
            }
            enums["modules"] = {"Fixture Module": template_module}
            projection = enums.setdefault("architecture_projection", {})
            projection["product"] = "FixtureProduct"
            projection["version"] = "v1"
            projection["projected_relation_types"] = ["DEPENDS_ON"]
            projection["wikilink_type_labels"] = {"依赖": "DEPENDS_ON"}
            projection["layer_aliases"] = {"legacy-application": "application"}
            projection["category_aliases"] = {"backend": "服务"}
            projection["subdomain_aliases"] = {"legacy-fixture": "fixture"}
            enums["subdomains"].setdefault("arch", []).append("fixture")
            enums_path.write_text(
                yaml.safe_dump(enums, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )

            entities = vault / "知识库" / "wiki" / "entities"
            entities.mkdir(parents=True)
            source = entities / "fixture-component.md"
            source.write_text(
                """---
title: Fixture Component
architecture-node-id: fixture-component
arch_component: true
arch_layer: legacy-application
arch_category: backend
arch_subdomain: legacy-fixture
arch_since: "1.0"
module: Fixture Module
status: 在线
date: 2026-07-09
updated: 2026-07-09
tags:
  - fixture
---

# Fixture Component

依赖::[[fixture-component]]
""",
                encoding="utf-8",
            )
            precleaned = vault / "知识库" / "raw" / "precleaned"
            precleaned.mkdir(parents=True)
            approved_articles = vault / "知识库" / "wiki" / "articles" / "fixture-admitted"
            approved_articles.mkdir(parents=True)
            admitted_article = approved_articles / "snapshot.md"
            admitted_article.write_text(
                """---
article_id: fixture-admitted
title: Admitted Article
product: FixtureProduct
module: Fixture Module
article_type: 排错指南
version: "1.0"
---

已批准候选文章。
""",
                encoding="utf-8",
            )
            excluded_article = precleaned / "excluded.md"
            excluded_article.write_text(
                """---
article_id: fixture-excluded
title: Excluded Article
product: FixtureProduct
module: Fixture Module
article_type: 排错指南
version: "1.0"
---

未进入本批次的候选文章。
""",
                encoding="utf-8",
            )
            # SPEC-012 wave-2/F3：准入清单允许根＝KB_DATA_DIR/admission-batches（暂存随图族迁 data 侧）
            data_dir = Path(temp_dir) / "data"
            admission_dir = data_dir / "admission-batches"
            admission_dir.mkdir(parents=True)
            admission_manifest = admission_dir / "fixture-batch.json"
            admission_manifest.write_text(
                json.dumps({
                    "schemaVersion": "2.0",
                    "batchId": "fixture-batch",
                    "purpose": "article_graph_publication",
                    "createdAt": "2026-07-16T00:00:00Z",
                    "articles": [{
                        "articleId": "fixture-admitted",
                        "sourcePath": "知识库/wiki/articles/fixture-admitted/snapshot.md",
                        "contentHash": hashlib.sha256(admitted_article.read_bytes()).hexdigest(),
                        "approvalDecisionId": "fixture-decision",
                    }],
                }),
                encoding="utf-8",
            )
            (vault / "知识库" / "raw" / "boards").mkdir(parents=True)
            # SPEC-012 wave-2：图族工件住 repo 侧 data（staging＋master_graph.db）——临时数据目录
            # 同场注入管线与服务端子进程，整链隔离不碰真库（admission-batches 已随清单落位先建）
            data_dir.mkdir(exist_ok=True)

            env = {
                **os.environ,
                "KB_VAULT": str(vault),
                "ARCH_REPO": str(REBUILD_ROOT),
                "KB_DATA_DIR": str(data_dir),
                # THESCHEMA_DIR 钉扎临时 TheSchema（repo-schema-io 合法领地）：读侧 theschema_dir
                # 与写侧目的地执法同源认此钉扎，Stage 3 enums 同步才能合法落在 fixture 内
                "THESCHEMA_DIR": str(vault / "知识库" / "TheSchema"),
                "PIPELINE_SKIP_BACKWRITE": "1",
                # 临时 vault 的 runner 副本导入 _vault_ledger 等真身目录模块（A 类私有件
                # 只住 repo scripts/vault-runtime，vault 侧 symlink 翻向后不再有本地副本）
                "PYTHONPATH": os.pathsep.join(filter(None, [
                    str(REBUILD_ROOT / "scripts" / "vault-runtime"),
                    os.environ.get("PYTHONPATH", ""),
                ])),
            }
            # WP-117 批3：父环境陈旧 DOC_ENVELOPE_PATH 不漏入（与 buildVaultRuntimeEnv false
            # 显式 delete 同款纪律）——全池跑时 vault-py conftest 的缺省信封指向他者文档集，
            # runner _ensure_doc_envelope 见值在即跳过自动物化 → 本 vault 文档集失配。删除后
            # runner 按本 vault 自动物化。
            env.pop("DOC_ENVELOPE_PATH", None)
            # WP-049 L3：直拉 runner 前先物化词表信封（生产链由 Node 拉起点自动做；手工/测试
            # 直拉须先跑 dump——信封含钉扎 TheSchema 阶梯解析的真词表）
            envelope = vault / ".ledger" / "vocab-envelope.json"
            for _ in range(2):
                dump = subprocess.run(
                    ["node", str(REBUILD_ROOT / "scripts" / "vault-runtime" / "dump-vocab-envelope.mjs"),
                     "--vault", str(vault), "--out", str(envelope)],
                    capture_output=True, text=True, env=env,
                )
                self.assertEqual(dump.returncode, 0, dump.stderr)
                env["VOCAB_ENVELOPE_PATH"] = str(envelope)
                run = subprocess.run(
                    [sys.executable, str(scripts / "pipeline-runner.py"), "--force", "--article-admission-manifest", str(admission_manifest)],
                    cwd=scripts,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=180,
                )
                self.assertEqual(run.returncode, 0, run.stdout + "\n" + run.stderr)

            # SPEC-012 wave-2 落位：staging 两件＋document_index 库住 KB_DATA_DIR
            master_path = data_dir / "staging" / "master_graph.json"
            db_path = data_dir / "master_graph.db"
            manifest_path = data_dir / "staging" / "extract_manifest.json"
            # PR-082：SA/layout 迁派生通用槽（staging/sa/，无产品段）
            architecture = data_dir / "staging" / "sa"
            self.assertTrue(source.is_file())
            self.assertTrue(master_path.is_file())
            self.assertTrue(db_path.is_file())
            self.assertTrue(manifest_path.is_file())
            semantic_path = architecture / "semantic_architecture.json"
            self.assertTrue(semantic_path.is_file())
            self.assertTrue((architecture / "architecture_layout.json").is_file())
            master = json.loads(master_path.read_text(encoding="utf-8"))
            self.assertEqual(master["_format_version"], "1.0")
            document_paths = {node["properties"].get("file_path") for node in master["nodes"] if "Document" in node.get("labels", [])}
            self.assertIn("知识库/wiki/articles/fixture-admitted/snapshot.md", document_paths)
            self.assertNotIn("知识库/raw/precleaned/excluded.md", document_paths)
            trusted_relations = [edge for edge in master["connections"] if (edge.get("reviewStatus") or edge.get("properties", {}).get("reviewStatus")) == "approved"]
            for edge in trusted_relations:
                properties = edge.get("properties", {})
                sources = properties.get("sources") or []
                first_source = sources[0] if sources else {}
                has_source_lineage = bool(
                    (edge.get("sourceFile") or properties.get("sourceFile") or first_source.get("file"))
                    and (edge.get("sourceHash") or properties.get("sourceHash") or first_source.get("source_hash"))
                    and (edge.get("lineNumber") or properties.get("lineNumber") or first_source.get("line_number"))
                    and (edge.get("evidenceHash") or properties.get("evidenceHash") or first_source.get("evidence_hash"))
                )
                has_derived_lineage = bool(properties.get("ruleId") and properties.get("ruleRevision") and properties.get("inputCoordinates"))
                self.assertTrue(has_source_lineage or has_derived_lineage, edge)
            fixture_node = next(node for node in master["nodes"] if node["id"] == "fixture-component")
            self.assertNotEqual(fixture_node["properties"].get("version"), "7.0.6.5")
            self.assertEqual(fixture_node["properties"]["arch_layer"], "legacy-application")
            self.assertEqual(fixture_node["properties"]["arch_layer_canonical"], "application")
            self.assertEqual(fixture_node["properties"]["arch_category"], "backend")
            self.assertEqual(fixture_node["properties"]["arch_category_canonical"], "服务")
            self.assertEqual(fixture_node["properties"]["arch_subdomain"], "legacy-fixture")
            self.assertEqual(fixture_node["properties"]["arch_subdomain_canonical"], "fixture")
            semantic = json.loads(semantic_path.read_text(encoding="utf-8"))
            self.assertEqual(semantic["components"][0]["module"], "Fixture Module")
            self.assertEqual(semantic["components"][0]["modules"], ["Fixture Module"])
            self.assertEqual(semantic["components"][0]["layer"], "application")
            self.assertEqual(semantic["components"][0]["category"], "服务")
            self.assertEqual(semantic["components"][0]["arch_subdomain_canonical"], "fixture")
            import sqlite3
            with sqlite3.connect(db_path) as connection:
                row = connection.execute(
                    "SELECT arch_layer, arch_layer_canonical, arch_category, arch_category_canonical, arch_subdomain, arch_subdomain_canonical FROM document_index WHERE node_id=?",
                    ("fixture-component",),
                ).fetchone()
            self.assertEqual(row, ("legacy-application", "application", "backend", "服务", "legacy-fixture", "fixture"))

            api = subprocess.Popen(
                ["node", str(REBUILD_ROOT / "server" / "main.cjs")],
                cwd=REBUILD_ROOT,
                env={**env, "VAULT_PATH": str(vault), "API_PORT": "0"},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                port = wait_for_api(api)
                base = f"http://127.0.0.1:{port}"
                status, dashboard = get_json(base + "/api/dashboard/topology?scope=full")
                self.assertEqual(status, 200)
                self.assertTrue(dashboard["success"])
                self.assertGreaterEqual(dashboard["data"]["totalNodes"], 1)

                status, compliance = get_json(base + "/api/entity/check?filter=all")
                self.assertEqual(status, 200)
                self.assertGreaterEqual(compliance["data"]["total"], 1)
                component_check = next(item for item in compliance["data"]["items"] if item.get("sourceKey") == "知识库/wiki/entities/fixture-component.md")
                self.assertEqual(component_check["blockerCount"], 0)
            finally:
                api.terminate()
                api.communicate(timeout=10)
                # PR-210 py 位点修（2026-11-03 第四次复现取证：TemporaryDirectory.__exit__ 的 rmtree 在
                # data 子目录上 ENOTEMPTY——api 已 communicate 等退出，写者＝经 env（KB_DATA_DIR）拿到
                # 临时 data 的孙进程（pipeline-runner run(cmd, shell=True) 的后台子链），迟写撞上夹具拆除。
                # 修法与 Node 位点同构＝拆前等静默：轮询临时树直至连续两个采样窗无变化（或 5s 上限），
                # 再由 with 体退出交 TemporaryDirectory 正常清理。残余风险＝静默后仍迟写（调度极端）→ 仍会红，
                # 按登记簿复现即 reopened 纪律附日志处理，不静默吞。
                _settle_before_teardown(temp_dir)


if __name__ == "__main__":
    unittest.main()
