"""SPEC-028 C6：promote-article.py 产品分桶归档回退分支——归档件写一次即只读（0o444）。

回退分支可达性（surveying 结论，SPEC-028 §六）：source_file 未走 Node 归档锚的
存量/手工草稿（如指向 raw/imported 的原始件）会进本分支，故保留并加只读封条。
"""
import hashlib
import os
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "promote_article", str(Path(__file__).resolve().parents[1] / "promote-article.py")
)
pa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pa)


def test_legacy_bucket_archive_lands_readonly():
    vault = pa.ARCHIVE_DIR  # conftest 注入 KB_VAULT 临时结构下的 知识库/raw/archive
    os.makedirs(vault, exist_ok=True)
    source = Path(vault).parent / "raw" / "imported" / "legacy.txt"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("legacy bytes", encoding="utf-8")
    source_bytes = source.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()

    ok, message, archive_dest = pa._archive_product_bucket(str(source), "通用", source_bytes, source_hash)

    assert ok is True, f"归档须成功: {message}"
    dest = Path(archive_dest)
    assert dest.exists(), "归档件须落盘"
    assert dest.name.startswith(source_hash), "内容寻址命名（<sha256>-原名）"
    assert stat.S_IMODE(dest.stat().st_mode) == 0o444, "SPEC-028：归档件落地权限须为只读 0o444"
    assert dest.read_bytes() == source_bytes, "字节保真"
    # 幂等：已存在（含 0o444）时跳过写入不报错
    ok2, message2, dest2 = pa._archive_product_bucket(str(source), "通用", source_bytes, source_hash)
    assert ok2 is True and dest2 == str(dest)


def test_legacy_bucket_archive_verifies_and_rejects_tampered_dest():
    """写后哈希校验保留（SPEC-028 C9 第二层纵深）——目标被替换为不一致内容时拒绝。"""
    vault = pa.ARCHIVE_DIR
    os.makedirs(vault, exist_ok=True)
    source = Path(vault).parent / "raw" / "imported" / "tamper.txt"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("original", encoding="utf-8")
    source_bytes = source.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()

    # 预置同名但内容不一致的归档件（模拟被篡改/历史坏件）
    product_dir = Path(vault) / "通用"
    product_dir.mkdir(parents=True, exist_ok=True)
    preexisting = product_dir / f"{source_hash}-{source.name}"
    preexisting.write_text("tampered", encoding="utf-8")

    ok, message, _ = pa._archive_product_bucket(str(source), "通用", source_bytes, source_hash)
    assert ok is False, "内容哈希不一致须拒绝（fail-closed）"
    assert "归档校验失败" in message
