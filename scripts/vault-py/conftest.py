"""vault-py 测试收集前置（WP-049 L3）：extract_graph 等被测模块在 import 期经 schema_loader
取词表（信封递入，ADR-016 §四-2 同宿主裁决）——收集阶段先落一份缺省信封防 import 爆炸；
各测试自装 vault 级信封（_vocab_fixture.install_vocab_envelope）时覆盖 env 即可。"""
import os
import sys
import tempfile
from pathlib import Path

_RUNTIME_DIR = Path(__file__).resolve().parent.parent / "vault-runtime"
if str(_RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(_RUNTIME_DIR))
_TESTS_DIR = _RUNTIME_DIR / "__tests__"
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

# WP-117 批2（SPEC-084 §二.1）：extract_graph 文档面 import 期即强制装载文档信封
# （入口收权 fail-closed）——收集阶段先落一份缺省文档信封防 import 爆炸；各测试自装
# vault 级信封（_vocab_fixture.install_doc_envelope）时覆盖 env 即可。
_doc_existing = os.environ.get("DOC_ENVELOPE_PATH")
if not _doc_existing or not Path(_doc_existing).exists():
    import subprocess as _sp_doc
    import tempfile as _tf_doc

    _doc_vault = _tf_doc.mkdtemp(prefix="doc-envelope-conftest-")
    _doc_out = Path(_doc_vault) / ".ledger" / "doc-envelope.json"
    _doc_proc = _sp_doc.run(
        ["node", str(_RUNTIME_DIR / "dump-doc-envelope.mjs"), "--vault", _doc_vault, "--out", str(_doc_out)],
        capture_output=True, text=True,
    )
    assert _doc_proc.returncode == 0, _doc_proc.stderr
    os.environ["DOC_ENVELOPE_PATH"] = str(_doc_out)

_existing = os.environ.get("VOCAB_ENVELOPE_PATH")
if not _existing or not Path(_existing).exists():
    # 缺省信封＝仓内主源真词表（空 vault 物化经阶梯回落 data/theschema——与旧装载器
    # 「无 vault 侧 TheSchema 时回落仓内」行为一致；测试自装 fixture 信封时覆盖 env）
    import subprocess as _sp

    _empty_vault = Path(tempfile.mkdtemp(prefix="vocab-conftest-"))
    _out = _empty_vault / ".ledger" / "vocab-envelope.json"
    _proc = _sp.run(
        ["node", str(_RUNTIME_DIR / "dump-vocab-envelope.mjs"), "--vault", str(_empty_vault), "--out", str(_out)],
        capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"},
    )
    assert _proc.returncode == 0, _proc.stderr
    os.environ["VOCAB_ENVELOPE_PATH"] = str(_out)
    import schema_loader as _sl

    _sl.reset_envelope_cache()

import pytest


@pytest.fixture(autouse=True)
def _vocab_envelope_env_guard():
    """每用例隔离信封环境（WP-049 L3）：用例自装 vault 级信封后必须还原缺省——防跨文件
    串台（最小 fixture 缺 layers/enums 面会炸后续用例）；缓存随还原复位。"""
    saved = os.environ.get("VOCAB_ENVELOPE_PATH")
    yield
    if saved is None:
        os.environ.pop("VOCAB_ENVELOPE_PATH", None)
    else:
        os.environ["VOCAB_ENVELOPE_PATH"] = saved
    try:
        import schema_loader

        schema_loader.reset_envelope_cache()
    except Exception:
        pass
