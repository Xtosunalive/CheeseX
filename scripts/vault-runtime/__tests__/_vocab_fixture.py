"""测试信封 fixture 助手（WP-049 L3）：写词表 fixture → Node 装载端口物化信封 → 注入
VOCAB_ENVELOPE_PATH 并清 schema_loader 缓存。被测代码经信封取数、零词表文件读取
（ADR-016 §四-2 同宿主裁决）；测试自己写 fixture 文件属测试供数面，不属被测读面。"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_RUNTIMEDIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _RUNTIMEDIR.parent.parent
sys.path.insert(0, str(_RUNTIMEDIR))

DEFAULT_FIXTURES = {
    "enums": "domains: {}\nsubdomains: {}\n",
    "ontology": "node_types: {}\nrelation_types: {}\n",
    "versions": "products: {}\n",
    "fields": "fields: {}\n",
    "dependencies": "dependencies: []\n",
}


def install_vocab_envelope(vault_root, files=None):
    """写词表 fixture（vault 侧 知识库/TheSchema）→ 经 Node dump CLI 物化信封与指纹件 →
    设 VOCAB_ENVELOPE_PATH、清 schema_loader 缓存。返回信封路径。

    files: {名: yaml 文本或 dict}，None 值＝删除该件（测缺件语义）。缺省五件最小 fixture。
    subprocess 型被测（extract_graph 等）经 os.environ 继承拿到同一信封。
    """
    import yaml

    ts = Path(vault_root) / "知识库" / "TheSchema"
    ts.mkdir(parents=True, exist_ok=True)
    merged = dict(DEFAULT_FIXTURES)
    merged.update(files or {})
    for name, text in merged.items():
        target = ts / f"{name}.yaml"
        if text is None:
            target.unlink(missing_ok=True)
        elif isinstance(text, dict):
            with open(target, "w", encoding="utf-8") as handle:
                yaml.safe_dump(text, handle, allow_unicode=True, sort_keys=False)
        else:
            target.write_text(text, encoding="utf-8")
    out_dir = Path(vault_root) / ".ledger"
    out = out_dir / "vocab-envelope.json"
    # 物化瞬间中和 THESCHEMA_DIR 钉扎——fixture 恒写 vault 侧 知识库/TheSchema，钉扎变量
    # （部分测试 setUp 指向别处）不得劫持物化阶梯。
    dump_env = {k: v for k, v in os.environ.items() if k != "THESCHEMA_DIR"}
    proc = subprocess.run(
        [
            "node",
            str(_REPO_ROOT / "scripts" / "vault-runtime" / "dump-vocab-envelope.mjs"),
            "--vault",
            str(vault_root),
            "--out",
            str(out),
        ],
        capture_output=True,
        text=True,
        env=dump_env,
    )
    assert proc.returncode == 0, f"信封物化失败: {proc.stderr}"
    os.environ["VOCAB_ENVELOPE_PATH"] = str(out)
    import schema_loader

    schema_loader.reset_envelope_cache()
    return out


def install_doc_envelope(vault_root):
    """文档信封 fixture 助手（WP-117 批2）：对当前 vault 经 Node dump CLI 物化全语料信封 →
    设 DOC_ENVELOPE_PATH。被测（extract_graph 等）的文档面经信封取数、零 .md 直读
    （SPEC-084 §二.1）；subprocess 型被测经 os.environ 继承拿到同一信封。
    vault 内容变化后重调本助手即重物化（信封是本次装载产出）。"""
    out = Path(vault_root) / ".ledger" / "doc-envelope.json"
    proc = subprocess.run(
        [
            "node",
            str(_REPO_ROOT / "scripts" / "vault-runtime" / "dump-doc-envelope.mjs"),
            "--vault",
            str(vault_root),
            "--out",
            str(out),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"文档信封物化失败: {proc.stderr}"
    os.environ["DOC_ENVELOPE_PATH"] = str(out)
    return out
