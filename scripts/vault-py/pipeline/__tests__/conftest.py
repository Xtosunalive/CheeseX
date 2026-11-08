"""同 scripts/vault-runtime/py-tests/conftest.py（W2）：供 KB_VAULT/KB_DATA_DIR 临时结构。"""
import os
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="vpp-pytests-")
Path(_TMP, "知识库").mkdir(parents=True, exist_ok=True)
Path(_TMP, "data").mkdir(parents=True, exist_ok=True)
os.environ.setdefault("KB_VAULT", _TMP)
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP, "data")))
os.environ.setdefault("PIPELINE_TRAJECTORIES_DIR", str(Path(_TMP, "data", "governance")))
