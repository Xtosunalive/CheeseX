"""随迁 Python 测试共用环境：kb_paths 模块级解析要求 KB_VAULT（<root>/知识库）与 KB_DATA_DIR——临时结构，不触真库。"""
import os
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="vaultpy-tests-")
Path(_TMP, "知识库").mkdir(parents=True, exist_ok=True)
Path(_TMP, "data").mkdir(parents=True, exist_ok=True)
os.environ.setdefault("KB_VAULT", _TMP)
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP, "data")))
os.environ.setdefault("PIPELINE_TRAJECTORIES_DIR", str(Path(_TMP, "data", "governance")))
