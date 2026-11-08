"""D3 降级测试（SPEC-025 C3）——空产品上下文不拒跑。层级：纯单元（临时 vault 结构＋函数级断言）。"""
import os
import sys
import tempfile
from pathlib import Path

# 模块级 vault 解析（kb_paths.vault_roots）要求 <KB_VAULT>/知识库 存在——先建临时结构再 import 被测模块
_TMP = tempfile.mkdtemp(prefix="eg-degrade-")
(_T := Path(_TMP) / "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ.setdefault("KB_DATA_DIR", str(Path(_TMP) / "data"))  # SPEC-012：运行时工件目录（模块级解析要求）
_HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HERE))

import extract_graph as eg  # noqa: E402


def test_product_version_empty_not_raise(monkeypatch):
    """空配置 → 返回 ("","") 而非 raise（W0 前为 RuntimeError 拒跑——本测试即行为基线翻转）"""
    monkeypatch.setattr(eg.schema_loader, "architecture_projection", lambda: {})
    for k in ("ARCH_PRODUCT", "PRODUCT_NAME", "ARCH_VERSION", "ARCH_BRANCH"):
        monkeypatch.delenv(k, raising=False)
    assert eg._architecture_product_version() == ("", "")


def test_pipeline_context_status_shape():
    st = eg._pipeline_context_status("", "")
    assert st["status"] == "needs_product_context"
    assert st["skipped"] and "product_context_extraction" in st["skipped"][0]
    assert "next_action" in st and "architecture_projection" in st["next_action"]
    assert eg._pipeline_context_status("P", "V") is None  # 有值不降级


def test_import_closure_repo_paths():
    """C1/C12 闭包：迁仓后 import 零 vault 路径依赖（kb_paths/schema_loader 来自仓内 vault-runtime）"""
    import kb_paths, schema_loader
    assert "vault-runtime" in str(Path(kb_paths.__file__).resolve())
    assert "vault-runtime" in str(Path(schema_loader.__file__).resolve())
