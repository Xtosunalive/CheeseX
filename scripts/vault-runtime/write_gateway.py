"""write_gateway — Python 侧统一写通道（runtime-scope 波5）。

结构收敛的写侧单点：管线/工具脚本不再各自 open(..., 'w')——写原语收口在本模块，
调用方只给「经登记解析器解析出的目标路径」＋内容。作用域判断不在本模块（路径由
kb_paths/环境注入给出），本模块只负责原语形态：原子写（temp+rename）、追加写
（mkdir parents＋append）。Node 侧对位＝repo-schema-io repoWrite / vault-io。
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_text_atomic(path: str | Path, text: str) -> None:
    """整文件原子写：tempfile 同目录＋os.replace——读者要么见旧要么见新，无半截。
    WP-015/SPEC-029：实体·概念页族写前裁决（人改面×写面相交即拒）＋写后基线登记。"""
    target = Path(path)
    from human_edit_guard import check_write as _heg_check, record as _heg_record  # 局部导入防环
    _heg_check(target, text)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(tmp, target)
        _heg_record(target, text)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_bytes_atomic(path: str | Path, data: bytes, *, fsync: bool = False, seal_readonly: bool = False) -> None:
    """字节级原子写（H2 红队注：本原语未接人改裁决门——现无 entities/concepts 调用方〔归档/账本专用〕；
    未来若有该两类页的写字节需求，必须先改走 write_text_atomic 或在此接 check_write，不得裸用旁路）。"""
    """字节级原子写：tempfile＋os.replace；fsync=True 时落盘确认（归档形态）；
    seal_readonly=True 时替换后 chmod 0444 封存（read-only-evidence 纪律——promote 归档先例）。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            if fsync:
                os.fsync(handle.fileno())
        os.replace(tmp, target)
        if seal_readonly:
            os.chmod(target, 0o444)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def append_line(path: str | Path, line: str) -> None:
    """单行追加（jsonl 账本形态）：父目录自建；不读旧内容（append-only 语义）。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(line)
