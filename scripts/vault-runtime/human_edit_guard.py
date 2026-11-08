"""human_edit_guard — 实体·概念页族「机器回写不覆盖人手改」裁决门（WP-015／SPEC-077）。

与 server/shared/human-edit-guard.cjs 同判据同侧账（跨语言单源＝侧账文件本身）：
  人改面（现文件 vs 基线）× 写面（现文件 vs 写后内容）求交非空 → 拒 HumanEditConflict。
侧账：<vault>/知识库/wiki/.machine-write-baseline.json（git 即账）。
播种语义：文件在而无基线＝协议前存量，现盘形态视为已知（SPEC-077 §三），写后即全保护。
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from ruamel.yaml import YAML

ENTITY_PAGE_MARKER = "/知识库/wiki/entities/"  # 路径含此段（或 concepts 段）即入裁决
ENTITY_PAGE_MARKER_CONCEPTS = "/知识库/wiki/concepts/"
_BASELINE_SEGMENTS = ("知识库", "wiki", ".machine-write-baseline.json")

_yaml = YAML(typ="safe", pure=True)


class HumanEditConflict(RuntimeError):
    """机器回写与人手改动在同一面相交——按域行 write_protocol③ 拒写。"""

    def __init__(self, rel: str, overlap: list[str], human_dirty: list[str]):
        self.rel = rel
        self.overlap = overlap
        self.human_dirty = human_dirty
        super().__init__(
            f"人手改动与机器回写在同一面相交（{'、'.join(overlap)}）——"
            f"按 write_protocol③「机器回写不覆盖人手改」拒写（{rel}）"
        )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _baseline_path_for(target: Path) -> Path | None:
    """从目标路径反推 vault 根（路径须含 知识库/wiki/ 段）；不合形返回 None。"""
    parts = list(Path(target).parts)
    for i in range(len(parts) - 2):
        if parts[i] == "知识库" and parts[i + 1] == "wiki":
            return Path(*parts[:i]).joinpath(*_BASELINE_SEGMENTS)
    return None


def _rel_for(target: Path) -> str | None:
    parts = list(Path(target).parts)
    for i in range(len(parts) - 2):
        if parts[i] == "知识库" and parts[i + 1] == "wiki":
            return "/".join(parts[i:])
    return None


def _in_scope(rel: str) -> bool:
    return ENTITY_PAGE_MARKER in "/" + rel or ENTITY_PAGE_MARKER_CONCEPTS in "/" + rel


def _split_page(raw: str) -> dict:
    """切 frontmatter（--- 界定）与正文：返回 {fm, body_sha, fm_block}。YAML 坏→整块退化单键。"""
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end != -1:
            fm_text = raw[3:end].lstrip("\n")
            body = raw[end + 4:] if raw[end + 4:].startswith("\n") else raw[end + 4:]
            try:
                parsed = _yaml.load(fm_text)
                fm = dict(parsed) if isinstance(parsed, dict) else {}
                if not isinstance(parsed, dict):
                    fm = {"__frontmatter_block__": fm_text}
            except Exception:
                fm = {"__frontmatter_block__": fm_text}
            return {"fm": fm, "body_sha": _sha256(body), "fm_block": fm_text}
    return {"fm": {}, "body_sha": _sha256(raw), "fm_block": ""}


def _diff_keys(a: dict, b: dict) -> set:
    keys = set(list((a or {}).keys()) + list((b or {}).keys()))
    dirty = {k for k in keys if str((a or {}).get(k)) != str((b or {}).get(k))}
    if "__frontmatter_block__" in (a or {}) or "__frontmatter_block__" in (b or {}):
        dirty.add("__frontmatter_block__")
    return dirty


def _load(baseline: Path) -> dict:
    try:
        parsed = json.loads(baseline.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except OSError:
        return {}
    except ValueError:
        return {}


def _save(baseline: Path, data: dict) -> None:
    baseline.parent.mkdir(parents=True, exist_ok=True)
    tmp = baseline.with_suffix(".json.tmp")
    # H6（红队）：ruamel safe 把 date: 2026-10-08 解析成 datetime.date——json.dumps 加 default=str，
    # 否则含日期键的真实页面在 record 时 TypeError＝Python 半边裁决门整体失效（基线永不落盘）
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")
    os.replace(tmp, baseline)


def check_write(target: str | Path, next_raw: str) -> None:
    """写前裁决：相交即 raise HumanEditConflict；放行路径不落侧账（登记由 record 在写后做）。"""
    target = Path(target)
    rel = _rel_for(target)
    if not rel or not _in_scope(rel):
        return
    baseline = _baseline_path_for(target)
    if baseline is None:
        return
    if not target.exists():
        return  # 新建：写后 record 登记
    baselines = _load(baseline)
    base = baselines.get(rel)
    now_raw = target.read_text(encoding="utf-8")
    now_sha = _sha256(now_raw)
    if base is None:
        human_dirty: set = set()  # 播种：现盘形态即已知（H4：打 seeded 标记可审计，语义取舍呈报 Master）
        baselines[rel] = {"sha256": now_sha, "fm": _split_page(now_raw)["fm"], "body_sha": _split_page(now_raw)["body_sha"], "seeded": True}
        _save(baseline, baselines)
    elif base.get("sha256") == now_sha:
        human_dirty = set()
    else:
        now = _split_page(now_raw)
        human_dirty = _diff_keys(now["fm"], base.get("fm") or {})
        if now["body_sha"] != base.get("body_sha"):
            human_dirty.add("body")
    now_page = _split_page(now_raw)
    next_page = _split_page(next_raw)
    write_dirty = _diff_keys(now_page["fm"], next_page["fm"])
    if now_page["body_sha"] != next_page["body_sha"]:
        write_dirty.add("body")
    overlap = sorted(human_dirty & write_dirty)
    if overlap:
        raise HumanEditConflict(rel, overlap, sorted(human_dirty))


def record(target: str | Path, written_raw: str) -> bool:
    """写成功后登记基线。返回侧账是否变化。"""
    target = Path(target)
    rel = _rel_for(target)
    if not rel or not _in_scope(rel):
        return False
    baseline = _baseline_path_for(target)
    if baseline is None:
        return False
    page = _split_page(written_raw)
    entry = {"sha256": _sha256(written_raw), "fm": page["fm"], "body_sha": page["body_sha"]}
    baselines = _load(baseline)
    if baselines.get(rel, {}).get("seeded"):
        entry["seeded"] = True  # H4：播种痕迹持久（审计痕）
    if baselines.get(rel) == entry:
        return False
    baselines[rel] = entry
    _save(baseline, baselines)
    return True


def check_delete(target: str | Path) -> None:
    """删除裁决：有基线且已被改 → 拒（不可逆从严）；无基线（存量占位）→ 放行（SPEC-077 如实记）。"""
    target = Path(target)
    rel = _rel_for(target)
    if not rel or not _in_scope(rel):
        return
    baseline = _baseline_path_for(target)
    if baseline is None:
        return
    baselines = _load(baseline)
    base = baselines.get(rel)
    if base is None or not target.exists():
        return
    if _sha256(target.read_text(encoding="utf-8")) != base.get("sha256"):
        raise HumanEditConflict(rel, ["delete"], ["page"])
