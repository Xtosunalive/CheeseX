#!/usr/bin/env python3
# Component: Relation-Expectation-Validator
# @responsible: 验证 UI 已确认关系在 master_graph connections 中形成预期类型与方向。
# @inputs: relation_write_expectations.json + master_graph.json
# @outputs: 验证 JSON；成功时可消费已验证期望
# @context: Pipeline

# W2 迁仓闭包（SPEC-025 C1/C12）：kb_paths/schema_loader 解析自仓内 vault-runtime（A 类事实源）；同族脚本同目录。
# PR-132：write_gateway 同住 vault-runtime——自举必须先于导入（65aee107 曾把导入插在自举前＝必炸）
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
for _dep in (_HERE, _HERE.parents[1] / "vault-runtime"):
    _s = str(_dep)
    if _s not in _sys.path:
        _sys.path.insert(0, _s)
from write_gateway import write_text_atomic
import argparse, json, os, sys

def _resolve_rules_root():
    """规则资产根（runtime-scope 域登记解析器，V02 修复）：PIPELINE_RULES_DIR ＞
    ARCH_REPO/data/governance/pipeline-rules（起链必传）；皆缺席即 RuntimeError——
    不再按 __file__ 位置猜仓根。仅规则资产通道消费；运行时通道（--expectations-file）不触此根。"""
    _override = os.environ.get("PIPELINE_RULES_DIR")
    if _override:
        return _Path(_override)
    _arch = os.environ.get("ARCH_REPO")
    if _arch:
        return _Path(_arch) / "data" / "governance" / "pipeline-rules"
    raise RuntimeError(
        "规则资产根未解析：export PIPELINE_RULES_DIR 或 ARCH_REPO"
        "（runtime-scope——写路径不允许按脚本位置猜）"
    )

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--vault", required=True); parser.add_argument("--consume", action="store_true"); parser.add_argument("--rules-version", default=None, help="D6：校验版本门指定候选/版本（vN-cK｜vN），缺省 active——人工规则资产通道")
    parser.add_argument("--expectations-file", default=None, help="运行时期望通道（#76 语义拆分）：管线每轮生成的期望文件（如 vault .ledger/…）——运行时数据可 consume，与版本门互斥"); args = parser.parse_args()
    # D6（SPEC-025 C6）：期望数据从仓内规则资产版本门读（candidates/vN-cK 或 versions/vN，缺省 active 指针）——
    # vault .ledger 旧位退役；候选校验不碰 active。
    _rules_root = None  # 懒解析（runtime-scope V02）：运行时通道不需要规则资产根，不因缺 env 误伤
    if args.expectations_file:
        # #76 语义拆分：运行时期望通道（管线每轮产物）——直接文件级读写，consume 合法（运行时数据可覆盖）
        import re as _re, sys as _sys
        exp_path = args.expectations_file
        if not os.path.isfile(exp_path):
            print(json.dumps({"ok": True, "checked": 0, "mismatches": [], "channel": "runtime"})); return 0
        _ver = "runtime"
    else:
        import re as _re, sys as _sys
        _rules_root = _resolve_rules_root()
        _ver = getattr(args, "rules_version", None) or __import__("json").load(open(_rules_root / "active.json", encoding="utf-8"))["active"]
    # 红队复验修复（#76 面2c）：版本名白名单 vN / vN-cK——防路径穿越与任意串
    if _ver != "runtime" and not _re.fullmatch(r"v\d+(-c\d+)?", _ver):
        print(json.dumps({"ok": False, "error": f"非法版本名: {_ver!r}（白名单 vN / vN-cK）"})); return 1
    if _ver != "runtime":
        _bucket = "candidates" if "-c" in _ver else "versions"
        exp_path = str(_rules_root / _bucket / _ver / "relation-expectations.json")
    if not os.path.isfile(exp_path):
        print(json.dumps({"ok": False, "error": f"版本不存在: {_ver}（{_bucket}）"})); return 1  # 红队修复：不存在=硬错非假绿
    if not os.path.isfile(exp_path): print(json.dumps({"ok": True, "checked": 0, "mismatches": []})); return 0
    with open(exp_path, encoding="utf-8") as f: expectations = json.load(f)
    # W3b：图真身读 kb_paths.staging_dir（与 extract_graph 同源——SPEC-012 wave-2 图族迁 repo data；
    # vault .ledger 旧位投影停读停写，仅兜底）。KB_DATA_DIR 决定 staging 落点。
    _mg = None
    try:
        from kb_paths import staging_dir as _sd
        _mg = os.path.join(_sd(), "master_graph.json")
    except Exception:
        pass
    if not _mg or not os.path.isfile(_mg):
        _mg = os.path.join(args.vault, ".ledger", "master_graph.json")
    with open(_mg, encoding="utf-8") as f: graph = json.load(f)
    edges = set()
    for edge in graph.get("connections", []):
        props = edge.get("properties") or {}
        edges.add((edge.get("source") or edge.get("from"), edge.get("target") or edge.get("to"), edge.get("relationType") or edge.get("relation_type") or props.get("relationType") or props.get("relation_type") or props.get("type")))
    mismatches = []
    for item in expectations:
        key = (item.get("source"), item.get("target"), item.get("relationType")); present = key in edges
        if item.get("operation") == "remove" and present:
            mismatches.append({"expected": "absent", "edge": key})
        if item.get("operation") != "remove" and not present:
            mismatches.append({"expected": "present", "edge": key})
    report = {"ok": not mismatches, "checked": len(expectations), "mismatches": mismatches}; print(json.dumps(report, ensure_ascii=False))
    # 红队复验修复（#76 面2b）：--consume 只许消费候选（清空）——versions/ 已发布永不覆盖
    # （README「Accept 发布永不覆盖」机器兑现：消费路径不再触达已发布版本）
    if report["ok"] and args.consume:
        if _ver == "runtime":
            pass  # 运行时通道：consume 合法（每轮产物，校验后清空）
        elif "-c" not in _ver:
            print(json.dumps({"ok": False, "error": "consume 仅限候选（vN-cK）——已发布版本不可覆盖"})); return 1
        write_text_atomic(exp_path, "[]")
    return 0 if report["ok"] else 1

if __name__ == "__main__": sys.exit(main())
