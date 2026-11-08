"""同 scripts/vault-runtime/py-tests/conftest.py（W2）：供 KB_VAULT/KB_DATA_DIR 临时结构。
WP-049 L3：被测模块 import 期经 schema_loader 取词表（信封递入）——收集阶段先落一份缺省
信封；各测试自装 vault 级信封（_vocab_fixture.install_vocab_envelope）时覆盖 env。"""
import os
import sys
import tempfile
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parent
_RUNTIME_DIR = _TESTS_DIR.parent
for _p in (str(_RUNTIME_DIR), str(_TESTS_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_TMP = tempfile.mkdtemp(prefix="vpp-pytests-")
Path(_TMP, "知识库").mkdir(parents=True, exist_ok=True)
Path(_TMP, "data").mkdir(parents=True, exist_ok=True)
os.environ.setdefault("KB_VAULT", _TMP)
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP, "data")))
os.environ.setdefault("PIPELINE_TRAJECTORIES_DIR", str(Path(_TMP, "data", "governance")))

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
    """每用例隔离信封环境（WP-049 L3）：还原缺省＋缓存复位——防跨文件串台。"""
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
