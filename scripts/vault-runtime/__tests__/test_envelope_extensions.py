"""WP-054 E-B（SPEC-049 X3）：扩展件两读点三例——正例（在册取件）／缺件（软语义逐字保持）／
坏件（fail-closed 或滤除）。层级：纯单元＋信封 fixture。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO / "scripts" / "vault-runtime"))
sys.path.insert(0, str(_REPO / "scripts" / "vault-py" / "pipeline"))

from vocab_envelope import load_envelope  # noqa: E402


def _materialize(vault, files):
    ts = Path(vault, "知识库", "TheSchema")
    ts.mkdir(parents=True, exist_ok=True)
    # 阶梯成立条件：vault 侧目录须含 enums.yaml（theschema-root 探针）——否则回落仓内主源
    (ts / "enums.yaml").write_text("domains: {}\n", encoding="utf-8")
    for name, text in (files or {}).items():
        fname = "entity-aliases.yaml" if name == "entity-aliases" else f"{name}.yaml"
        target = ts / fname
        if text is None:
            target.unlink(missing_ok=True)
        else:
            target.write_text(text, encoding="utf-8")
    out = Path(vault, ".ledger", "vocab-envelope.json")
    proc = subprocess.run(
        ["node", str(_REPO / "scripts" / "vault-runtime" / "dump-vocab-envelope.mjs"),
         "--vault", str(vault), "--out", str(out)],
        capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"},
    )
    assert proc.returncode == 0, proc.stderr
    os.environ["VOCAB_ENVELOPE_PATH"] = str(out)
    import schema_loader
    schema_loader.reset_envelope_cache()
    return out


def test_正例_扩展件在册取件():
    vault = tempfile.mkdtemp(prefix="vext-ok-")
    _materialize(vault, {
        "article_associations": "decisions:\n  - id: d1\n",
        "entity-aliases": "别名A: 正名\n坏值: 42\n",
    })
    env = load_envelope()
    assert env.has("article_associations") and env.has("entity-aliases")
    assert env.doc("entity-aliases")["别名A"] == "正名"
    # 非串值 42 由 schema 收口降级丢键（宽容面与 schema.py 旧过滤语义一致）
    assert "坏值" not in env.doc("entity-aliases")


def test_缺件_软语义保持():
    vault = tempfile.mkdtemp(prefix="vext-miss-")
    _materialize(vault, {"article_associations": None, "entity-aliases": None})
    env = load_envelope()
    assert not env.has("article_associations")
    assert not env.has("entity-aliases")
    # schema.py load_aliases 缺件→{}（行为级：直调）
    import schema as schema_mod
    assert schema_mod.load_aliases(vault) == {}


def test_正例_schema_load_aliases_串值滤除():
    vault = tempfile.mkdtemp(prefix="vext-alias-")
    _materialize(vault, {"entity-aliases": "别名A: 正名\n"})
    import schema as schema_mod
    assert schema_mod.load_aliases(vault) == {"别名A": "正名"}
