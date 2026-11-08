#!/usr/bin/env python3
"""archive-enums-legacy.py — enums.yaml AnyShare 主体词表归档式清空（ADR-008 后续批 / 多主体方向预留）

设计同构 TALOS archive（talosctl.py archive_project）：
  · 受控命令唯一入口（手改 yaml 归档=违约——writers 登记本脚本为显式授权写者）
  · 车道 lane=paused（Master 2026-10-17 多主体裁决：AnyShare 是第一套主体，挂起非废弃；
    TALOS 车道语义 paused=主动暂停未来可恢复——预留主体数据包重挂载）
  · 预演模式 --check：只读输出清空范围摘要，不动文件
  · 事务性：temp+rename 原子写，任一步失败原文件不动
  · 指纹：manifest 记归档前全文 SHA-256（字节级可验证归档未被偷改）
  · 快照：写前留 history/enums/ 快照（schema-rules-data write_protocol 三要件）
  · 焦点保护的同构物：验证链最小种子（每域 1 个带 label 子域）——骨架内置，清空不弄死文章流

用法：
  python3 archive-enums-legacy.py --check     # 预演：看清空范围与骨架预览
  python3 archive-enums-legacy.py --write     # 执行：快照→原子重写→manifest
"""
from write_gateway import write_text_atomic, append_line, write_bytes_atomic
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import yaml



def resolve_vault():
    env = os.environ.get("VAULT_PATH")
    if env and Path(env).exists():
        return Path(env)
    # 仓根 .env（server/main.cjs 同款依赖）
    here = Path(__file__).resolve()
    for root in [here.parent.parent, here.parent.parent.parent]:
        envf = root / ".env"
        if envf.exists():
            for line in envf.read_text().splitlines():
                if line.strip().startswith("VAULT_PATH="):
                    v = line.split("=", 1)[1].strip().strip('"\'')
                    if v and Path(v).exists():
                        return Path(v)
    return None


SCHEMA_DIR_PARTS = ("知识库", "TheSchema")
HISTORY_DIR_PARTS = ("知识库", "TheSchema", "history", "enums")

# ── 元层骨架（Master 2026-10-17 批准切分表）──
# 保留：通用文档管理结构 + 8 层通用骨架（去 intelligence/plate 两处产品烙印）
#       + 7 域各 1 个最通用种子（带 label——「出生即带义」原则自证示范）
# 清空：modules（45 条产品档案）/ subdomain_layer_map / tags / arch_categories /
#       architecture_projection 产品身份 / 其余子域
KEEP_LAYERS = ["gateway", "foundation", "data-lake", "cloud-native", "service", "open", "application", "external", "crosscutting"]
SEED_SUBDOMAINS = {
    "ref": [("overview", "总览")],
    "ops": [("maintain", "维护")],
    "concept": [("method", "方法论")],
    "meta": [("doc", "文档")],
    "arch": [("architecture", "架构")],
    "tech": [("api", "应用程序接口")],
    "product": [("general", "通用")],
}


def sha256_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes):
    # 波5 批①：原语收口 write_gateway（fsync=False 保持原行为）
    from write_gateway import write_bytes_atomic
    write_bytes_atomic(path, data, fsync=False)


def build_skeleton(enums: dict) -> dict:
    """从当前 enums 派生元层骨架版（保留段结构，清产品实例词）。"""
    kept_layers = [l for l in (enums.get("layers") or []) if isinstance(l, dict) and l.get("id") in KEEP_LAYERS]
    return {
        "domains": enums.get("domains") or {},
        "subdomains": {dom: [{"id": sid, "label": label} for sid, label in seeds] for dom, seeds in SEED_SUBDOMAINS.items()},
        "article_types": enums.get("article_types") or [],
        "doc_types": enums.get("doc_types") or [],
        "tags": {},
        "lifecycle": enums.get("lifecycle") or {"review_cycle": ["30d", "90d", "180d", "365d", "never"], "status": ["灰度", "在线", "退役", "已驳回"], "default_status": "灰度"},
        "arch_categories": [],
        "layers": kept_layers,
        "architecture_projection": {
            # 产品身份清空（多主体机制就位前元层不预设主体）；段结构保留供后续主体挂载
            "product": "",
            "version": "",
            "product_aliases": {},
            "layer_aliases": {},
            "category_aliases": {},
            "subdomain_aliases": {},
            "projected_relation_types": (enums.get("architecture_projection") or {}).get("projected_relation_types") or [],
            "wikilink_type_labels": (enums.get("architecture_projection") or {}).get("wikilink_type_labels") or {},
        },
        "category_map": {},
        "modules": {},
        "subdomain_layer_map": {},
        "tag_aliases": {},
    }


def summarize(before: dict, after: dict) -> dict:
    def sub_count(e):
        return sum(len([x for x in (v or []) if isinstance(x, (str, dict))]) for v in (e.get("subdomains") or {}).values())
    return {
        "subdomains": f"{sub_count(before)} → {sub_count(after)}",
        "modules": f"{len(before.get('modules') or {})} → {len(after.get('modules') or {})}",
        "layers": f"{len(before.get('layers') or [])} → {len(after.get('layers') or [])}",
        "tags_groups": f"{len(before.get('tags') or {})} → {len(after.get('tags') or {})}",
        "subdomain_layer_map": f"{len(before.get('subdomain_layer_map') or {})} → 0",
        "arch_categories": f"{len(before.get('arch_categories') or [])} → 0",
        "product_identity": ((before.get("architecture_projection") or {}).get("product") or "(空)") + " → (空)",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只读预演：输出清空范围摘要")
    ap.add_argument("--write", action="store_true", help="执行归档（快照→原子重写→manifest）")
    args = ap.parse_args()
    if not (args.check or args.write):
        ap.error("需指定 --check 或 --write")

    vault = resolve_vault()
    if not vault:
        print("FATAL: VAULT_PATH 未解析（环境变量或 .env）", file=sys.stderr)
        sys.exit(1)
    enums_path = vault.joinpath(*SCHEMA_DIR_PARTS) / "enums.yaml"
    raw = enums_path.read_bytes()
    before = yaml.safe_load(raw) or {}
    skeleton = build_skeleton(before)
    skeleton_bytes = yaml.safe_dump(skeleton, allow_unicode=True, sort_keys=False).encode("utf-8")

    print("=== 归档式清空预览（lane=paused，主体 AnyShare 挂起）===")
    for k, v in summarize(before, skeleton).items():
        print(f"  {k}: {v}")

    if args.check:
        print("--- 骨架 subdomains 预览 ---")
        for dom, seeds in SEED_SUBDOMAINS.items():
            print(f"  {dom}: {[s[0] for s in seeds]}")
        print("check 模式：未写任何文件")
        return

    # --write：①写前快照（schema-rules-data write_protocol）
    hist_dir = vault.joinpath(*HISTORY_DIR_PARTS)
    hist_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"
    snap_name = f"{ts}-{hashlib.sha256(raw).hexdigest()[:12]}.yaml"
    write_bytes_atomic(hist_dir / snap_name, raw, fsync=False)
    print(f"快照已留: history/enums/{snap_name}")

    # ②manifest（TALOS archive-manifest 同构：双指纹+车道+主体+回溯指针）
    manifest = {
        "schema_version": 1,
        "lane": "paused",
        "subject": "AnyShare",
        "reason": "AnyShare 架构退役，系统转向元层构建+多主体方向（Master 2026-10-17 裁决）——主体挂起非废弃，多主体词表机制就位后可作为首套主体数据包重挂载",
        "archived_on": datetime.date.today().isoformat(),
        "enums_sha256_before": sha256_bytes(raw),
        "snapshot": f"知识库/TheSchema/history/enums/{snap_name}",
        "git_recover": "vault git 历史（归档前任意提交可完整回溯）",
        "cleared": summarize(before, skeleton),
        "kept_skeleton": {"layers": KEEP_LAYERS, "seed_subdomains": {d: [s[0] for s in v] for d, v in SEED_SUBDOMAINS.items()}},
    }
    manifest_path = vault.joinpath(*SCHEMA_DIR_PARTS) / "history" / "enums-legacy-archive-manifest.json"
    atomic_write(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")

    # ③原子重写 enums.yaml（temp+rename）
    atomic_write(enums_path, skeleton_bytes)
    print(f"enums.yaml 已重写为元层骨架（{len(skeleton_bytes)} bytes）")
    print(f"manifest: 知识库/TheSchema/history/enums-legacy-archive-manifest.json")


if __name__ == "__main__":
    main()
