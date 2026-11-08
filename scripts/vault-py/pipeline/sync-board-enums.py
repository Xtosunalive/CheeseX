#!/usr/bin/env python3
# Component: Board-Cache-Syncer
# @responsible: 读词表 enums modules 段（经信封——WP-049 L3），生成 `_enums-cache.md` 供 Board 页面 DataviewJS 动态查询
# @inputs: 词表 enums（经信封，非文件直读）
# @outputs: `raw/boards/_enums-cache.md`
# @context: B. 逻辑中枢上下文 (Pipeline Context)
# contract: writes _enums-cache.md
# contract: reads 词表 enums（经信封）
"""
词表 enums → _enums-cache.md 同步脚本
为 Board 页面 DataviewJS 提供模块注册缓存，消除硬编码数组。

用法:
  python3 sync-board-enums.py              # 预览（dry-run）
  python3 sync-board-enums.py --apply      # 写入 _enums-cache.md
"""

# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
# PR-132：write_gateway 同住 vault-runtime——自举必须先于导入（65aee107 曾把导入插在自举前＝必炸）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)
from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import json
import os
import sys
from pathlib import Path

import yaml


VAULT = Path(os.environ.get("KB_VAULT", Path(__file__).resolve().parents[3]))
if (VAULT / "知识库").exists():
    VAULT = VAULT / "知识库"
# WP-049 L3（ADR-016 §四-2）：词表经 schema_loader→信封取数，不再构造词表文件路径
CACHE_PATH = VAULT / "raw" / "boards" / "_enums-cache.md"


def load_modules():
    import schema_loader  # WP-049 L3：读侧经信封
    data = schema_loader.load_the_schema("enums")[0] or {}
    modules = data.get("modules", {})
    result = []
    for name, mod in modules.items():
        result.append({
            "name": name,
            "system": mod.get("system", ""),
            "subdomain": mod.get("subdomain", ""),
            "since": str(mod.get("since", "")),
            "until": str(mod.get("until", "")) if mod.get("until") else "",
            "products": mod.get("products", []),
        })
    return result


def build_cache(modules):
    lines = []
    lines.append("---")
    lines.append("modules:")
    for m in modules:
        entry = json.dumps(m, ensure_ascii=False, separators=(",", ": "))
        lines.append(f"  - {entry}")
    lines.append("---")
    lines.append("")
    lines.append("# 模块注册缓存")
    lines.append("")
    lines.append("> 自动生成，勿手改。由 `sync-board-enums.py` 维护。")
    lines.append("> 数据源: 词表 enums 的 modules 节（经装载信封）。")
    lines.append("> DataviewJS 用法: `dv.page('\"知识库/raw/boards/_enums-cache\"').modules`")
    return "\n".join(lines) + "\n"


def main():
    apply_mode = "--apply" in sys.argv

    modules = load_modules()
    content = build_cache(modules)
    preview = content[:300]

    print(f"[sync-board-enums] 从词表 enums（信封）读取 {len(modules)} 个模块")
    products = set()
    for m in modules:
        for p in m.get("products", []):
            products.add(p)
    print(f"[sync-board-enums] 覆盖产品: {', '.join(sorted(products))}")

    if apply_mode:
        write_text_atomic(CACHE_PATH, content)
        print(f"[sync-board-enums] 已写入: {CACHE_PATH}")
        print(f"[sync-board-enums] 缓存大小: {len(content)} 字节")
    else:
        print(f"\n[DRY-RUN] 将写入 {CACHE_PATH}")
        print(f"预览（前 300 字符）:\n{preview}...")
        print(f"\n总大小: {len(content)} 字节")
        print("使用 --apply 执行写入")


if __name__ == "__main__":
    main()
