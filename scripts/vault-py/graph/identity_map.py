"""identity_map —— 图节点稳定身份映射（WP-215；PR-339／PR-229④ 合流落地）。

身份立法源：ADR-016 §二（不透明 ID：比较、去重、缓存只用 ID，禁止拼名造身份）
＋PR-229 口径「人给就沿用，否则铸 UUID」。铸造版本随 WP-113 已签收裁定取 **v4**
（Node 侧 entity-identity-mint.cjs 用内建 randomUUID 同源；本仓不引 UUID 库、
不自写 v7 编码器——SPEC-046 §六在册；Python 侧＝stdlib uuid.uuid4，零新依赖）。

持久化：``<staging>/identity_map.json``（与 master_graph.json 同属抽取输出族）。
I4 纪律：身份键不入任何指纹/增量比对输入——本文件只被本模块读写，
抽取指纹面只扫 vault .md，天然不含身份键。

改名退出通道（D-1 裁 B＝replaced_by 生命周期退出，PR-229④ 闭合）：
产品改名经注册表既有别名机制（product_aliases 旧名→新名）声明；解析侧拿到
via 名（旧名）与 canonical（新名）后，若映射表有旧名条目而新名缺位，则
**同一身份迁移**到新名键，旧行为以 renamedFrom 线性记录（不删历史、不改 id）。

文档路径迁移（D-2 裁 B＝保留 fallback＋迁移映射）：路径变更以**内容 sha256
前 16 位精确匹配**为唯一自动迁移信号——无歧义才动手；内容也变的（歧义）
一律新身份，不猜（fail-closed 口径＝PR-229 参照结论「窄谓词才自动、歧义列
清单交人裁」；旧节点幽灵清理归 PR-337 剪枝批，非本件范围）。
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

MAP_FILENAME = "identity_map.json"
SHA16_LEN = 16


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def mint_uuid() -> str:
    """铸造不透明身份号——stdlib v4（WP-113 裁定同源：不引库、不自造编码器）。"""
    return str(uuid.uuid4())


def sha16_of(sha256_hex: str) -> str:
    """内容短指纹（sha256 十六进制前 16 位）——文档迁移匹配键。"""
    return str(sha256_hex or "").removeprefix("sha256:").strip()[:SHA16_LEN]


class IdentityMap:
    """身份映射表：products 以规范名为键，docs 以知识库相对路径为键。"""

    def __init__(self, base_dir: str):
        self.path = os.path.join(base_dir, MAP_FILENAME)
        self.data = self._load()
        self.dirty = False

    # ── 持久化 ──

    def _load(self) -> dict:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("identity_map 顶层必须是对象")
        except (OSError, ValueError, json.JSONDecodeError):
            data = {}
        data.setdefault("version", 1)
        data.setdefault("products", {})
        data.setdefault("docs", {})
        data.setdefault("renames", [])
        return data

    def save(self) -> None:
        """原子写盘（tmp＋replace，与账本族同款纪律）；仅 dirty 时落盘。"""
        if not self.dirty:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, self.path)
        self.dirty = False

    # ── 产品身份（D-3 A：人给就沿用，否则首见铸造） ──

    def product_id(self, canonical: str, via_name: str = "", registry_identity: str = "") -> str:
        """产品稳定身份。canonical＝resolve_product_identity 归一后的规范名；
        via_name＝解析前原文（别名/旧名信号）；registry_identity＝注册表显式身份
        （versions.yaml 产品条目可选 identity 字段，人给即权威）。"""
        canonical = str(canonical or "").strip()
        if not canonical:
            return ""
        registry_identity = str(registry_identity or "").strip()
        prods = self.data["products"]

        # 1) 注册表显式身份＝人给，最高权威（沿用了即同步进映射，保证单一事实）
        if registry_identity:
            entry = prods.get(canonical)
            if not entry or entry.get("id") != registry_identity:
                prods[canonical] = {
                    "id": registry_identity,
                    "source": "registry",
                    "updatedAt": _now(),
                }
                self.dirty = True
            return registry_identity

        # 2) 规范名直查
        entry = prods.get(canonical)
        if entry and entry.get("id"):
            return entry["id"]

        # 3) 改名迁移（D-1 B）：via 名（旧名/别名原词）在册而新名缺位 → 同身份迁移
        via = str(via_name or "").strip()
        if via and via != canonical and via in prods and prods[via].get("id"):
            same_id = prods[via]["id"]
            prods[canonical] = {
                "id": same_id,
                "renamedFrom": via,
                "migratedAt": _now(),
            }
            del prods[via]  # 旧键移除——别名解析恒先于本查询，旧名不会再来直查
            self.data["renames"].append({"from": via, "to": canonical, "at": _now()})
            self.dirty = True
            return same_id

        # 4) 首见铸造
        new_id = mint_uuid()
        prods[canonical] = {"id": new_id, "mintedAt": _now()}
        self.dirty = True
        return new_id

    def apply_alias_renames(self, alias_pairs) -> None:
        """注册表别名＝改名声明（D-1 B）——每轮抽取前按别名对预迁移，顺序无关。

        动机：改名后文章可能已先改成新名（via 信号消失），仅靠查询侧 via 检测接不住；
        以别名对（旧名→新名）为声明源 proactive 迁移：旧名在册而新名缺位 → 同身份迁移。
        幂等：新名已在册（迁过）即无操作；旧名不在册同理。pairs 形态＝
        architecture_projection.product_aliases（{旧名: 新名}）。"""
        for old, new in dict(alias_pairs or {}).items():
            old, new = str(old).strip(), str(new).strip()
            if not old or not new or old == new:
                continue
            prods = self.data["products"]
            if old in prods and prods[old].get("id") and new not in prods:
                same_id = prods[old]["id"]
                prods[new] = {"id": same_id, "renamedFrom": old, "migratedAt": _now()}
                del prods[old]
                self.data["renames"].append({"from": old, "to": new, "at": _now()})
                self.dirty = True

    # ── 文档路径 fallback 身份（D-2 B：保留＋sha16 精确迁移） ──

    def doc_id(self, rel_path: str, sha256_hex: str = "", current_paths=None) -> tuple[str, str]:
        """文档 fallback 稳定身份。返回 (node_id, migratedFrom)——migratedFrom 非空
        表示本次按内容精确匹配完成了路径迁移（可观测，不静默）。
        current_paths＝本轮扫描的全部受管路径集合（迁移候选必须不在其中，防误配在册路径）。"""
        rel_path = str(rel_path or "").strip()
        if not rel_path:
            return "", ""
        docs = self.data["docs"]
        entry = docs.get(rel_path)
        if entry and entry.get("id"):
            return entry["id"], ""

        sha16 = sha16_of(sha256_hex)
        excluded = set(current_paths or ())
        if sha16:
            for old_path, old in docs.items():
                if old_path in excluded or old_path == rel_path:
                    continue
                if old.get("sha16") == sha16 and old.get("id"):
                    same_id = old["id"]
                    docs[rel_path] = {
                        "id": same_id,
                        "sha16": sha16,
                        "renamedFrom": old_path,
                        "migratedAt": _now(),
                    }
                    del docs[old_path]
                    self.data["renames"].append({"from": old_path, "to": rel_path, "at": _now()})
                    self.dirty = True
                    return same_id, old_path

        new_id = mint_uuid()
        docs[rel_path] = {"id": new_id, "sha16": sha16 or None, "mintedAt": _now()}
        self.dirty = True
        return new_id, ""
