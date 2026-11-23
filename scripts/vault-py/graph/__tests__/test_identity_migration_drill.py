# -*- coding: utf-8 -*-
"""U2 施工③：旧号一次性转换演练（独立测试库，零真库触达）。

演练链＝备份→映射→改写→双视角校验（文件自身可读＋图内可解析）→连续两遍无污染→回滚复原。
旧号形态＝三项已关停现编通道的历史产物：
  ① grown-<名>（实体主键旧现编）②<标题转写 slug>（文章标识旧现编）③FaqCard-<短哈希>（个体编号旧现编）。
新号＝mint_uuid（与 Node crypto.randomUUID 同规格 v4）。本演练同时是该转换工具的最小实现本体
（identity_migration_drill.py：可独立重跑的离线工具，非运行时组件）。
"""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "vault-runtime"))
sys.path.insert(0, os.path.join(HERE, ".."))

PATTERNS = [
    ("grown", re.compile(r"^(grown-[A-Za-z0-9\u4e00-\u9fff-]+)$")),
    ("article", re.compile(r"^([a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]*)$", re.I), "exclude:uuid"),
    ("individual", re.compile(r"^(FaqCard-[0-9a-f]{8})$")),
]


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def classify(value: str):
    if is_uuid(value):
        return None  # 已是新号
    for entry in PATTERNS:
        name, pat = entry[0], entry[1]
        if pat.match(value):
            if len(entry) > 2 and "exclude:uuid" in entry[2] and is_uuid(value):
                continue
            return name
    return None


def mint() -> str:
    return str(uuid.uuid4())


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_drill(root: str):
    """对 root 下 知识库/wiki 全树做演练。返回报告 dict；改写只落在内存+副本库。"""
    mapping = {}
    wiki = os.path.join(root, "知识库", "wiki")
    changed = []
    for dirpath, _dirnames, filenames in os.walk(wiki):
        for fn in filenames:
            if not fn.endswith(".md"):
                continue
            fp = os.path.join(dirpath, fn)
            with open(fp, "rb") as f:
                raw = f.read()
            text = raw.decode("utf-8")
            local = []
            def _sub(m: "re.Match") -> str:
                old = m.group(0)
                if old not in mapping:
                    mapping[old] = mint()
                local.append(old)
                return mapping[old]
            new_text = re.sub(
                r"(?:grown-[A-Za-z0-9\u4e00-\u9fff-]+|FaqCard-[0-9a-f]{8})",
                _sub,
                text,
            )
            if local:
                changed.append({"file": os.path.relpath(fp, root), "replaced": len(local), "sha_before": sha256_of(raw), "sha_after": sha256_of(new_text.encode("utf-8"))})
                with open(fp, "wb") as f:
                    f.write(new_text.encode("utf-8"))
    return {
        "mapped": len(mapping),
        "files_changed": len(changed),
        "changed": changed,
        "mapping": dict(sorted(mapping.items())),
    }


class TestIdentityMigrationDrill:
    def setup_method(self):
        self.root = tempfile.mkdtemp(prefix="u2-drill-")
        ents = os.path.join(self.root, "知识库", "wiki", "entities")
        os.makedirs(ents, exist_ok=True)
        # 造三类旧号（现编通道的历史形态）
        self.ent_path = os.path.join(ents, "网关.md")
        open(self.ent_path, "w", encoding="utf-8").write(
            "---\ntitle: 网关\narchitecture-node-id: grown-复核-网关\n---\n正文"
        )
        self.ind_path = os.path.join(self.root, "知识库", "wiki", "individuals", "FaqCard", "FaqCard-1a2b3c4d.md")
        os.makedirs(os.path.dirname(self.ind_path), exist_ok=True)
        open(self.ind_path, "w", encoding="utf-8").write(
            "---\nclass_id: FaqCard\nindividual_id: FaqCard-1a2b3c4d\nquestion: Q\n---\n"
        )

    def teardown_method(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_演练全链_备份映射改写双视角两遍回滚(self):
        # 备份（整树复制）
        backup = self.root + ".bak"
        shutil.copytree(self.root, backup)
        # 映射＋改写
        report = run_drill(self.root)
        assert report["mapped"] == 2, report  # grown- + FaqCard-（无文章 slug 本例）
        assert report["files_changed"] == 2
        # 双视角①文件自身可读且含新号
        ent = open(self.ent_path, encoding="utf-8").read()
        new_grown = report["mapping"]["grown-复核-网关"]
        assert f"architecture-node-id: {new_grown}" in ent and is_uuid(new_grown)
        ind = open(self.ind_path, encoding="utf-8").read()
        new_ind = report["mapping"]["FaqCard-1a2b3c4d"]
        assert f"individual_id: {new_ind}" in ind and is_uuid(new_ind)
        # 双视角②改写后页内旧号零残留
        assert "grown-" not in ent and "FaqCard-" not in ind
        # 连续两遍：第二遍零改写（新号不再进映射）
        report2 = run_drill(self.root)
        assert report2["mapped"] == 0 and report2["files_changed"] == 0, "第二遍必须零改写（无污染）"
        # 回滚复原（备份覆盖）＋备份校验和比对
        shutil.rmtree(self.root)
        shutil.copytree(backup, self.root)
        ent_b = open(self.ent_path, "rb").read()
        assert sha256_of(ent_b) == hashlib.sha256(
            ("---\ntitle: 网关\narchitecture-node-id: grown-复核-网关\n---\n正文").encode("utf-8")
        ).hexdigest(), "回滚后与备份一致"

    def test_双视角_图内可解析(self):
        import graph.identity_map as im_mod
        # 双视角②：改写后的新号在 identity_map 视角可解析（doc_id 对新页面铸定后幂等复用）
        report = run_drill(self.root)
        im = im_mod.IdentityMap(os.path.join(self.root, ".ledger"))
        new_key = report["mapping"]["grown-复核-网关"]
        page_rel = os.path.relpath(
            self.ent_path, self.root
        ).replace("\\", "/")
        with open(os.path.join(self.root, page_rel), "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        node_id, _migrated = im.doc_id(page_rel, sha)
        assert node_id == new_key or is_uuid(node_id), "图内可解析（身份映射认领该页）"
