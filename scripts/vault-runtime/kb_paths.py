# Component: Vault-Paths
# @responsible: KB_VAULT 路径约定，兼容旧环境变量，所有 Python 脚本的路径入口
# @inputs: 环境变量
# @outputs: vault_roots 路径元组
# @context: A. 知识源上下文 (Vault Context)
"""KB_VAULT 路径约定。

默认指向 Obsidian **仓库根**（例如 ``~/Obsidian Vault``）。Schema、wiki、raw 在仓库下的 ``知识库/``。

兼容旧约定：若环境变量仍设为 ``…/知识库``，自动识别为知识库根，并向上推导仓库根。
"""

from __future__ import annotations

import os

__all__ = ["vault_roots", "normalize_vault_cli", "data_dir", "staging_dir", "staging_path", "theschema_dir"]


def _dir_has_yaml(dir_path):
    """目录存在且含至少一个 .yaml（置备状态探测——WP-052 T3 词表文件名中性化）."""
    try:
        return any(name.endswith(".yaml") for name in os.listdir(dir_path))
    except OSError:
        return False


def _abspath(path: str) -> str:
    return os.path.abspath(os.path.expanduser(path))


def vault_roots(environ_value: str | None = None) -> tuple[str, str]:
    """返回 ``(vault_root, knowledge_root)``。

    - ``vault_root``：Obsidian 仓库根（``.ledger/``、``vector-cache.json`` 等通常在此）。
    - ``knowledge_root``：``vault_root/知识库``（TheSchema（已迁仓 data/theschema，vault 侧仅存 legacy-archive）、wiki、raw）。
    """
    if environ_value is not None:
        raw = _abspath(environ_value)
    else:
        default = _abspath(os.path.join(os.path.dirname(__file__), "../../.."))
        raw = _abspath(os.environ.get("KB_VAULT", default))
    if os.path.basename(raw) == "知识库":
        knowledge = raw
        vault_root = os.path.dirname(knowledge)
    else:
        vault_root = raw
        knowledge = os.path.join(vault_root, "知识库")
    # SPEC-011 §三·附 设计 4：推导结果存在性校验——经 symlink 运行时 __file__ 不解析而 sys.path[0]
    # 解析，同目录 import 拿到仓内这份，缺省推导会落到仓侧不存在的目录；静默返回会让枚举集全空、
    # 写错位置。不存在即硬失败（不改成"强制 KB_VAULT"：vault 侧 B/C 脚本依赖缺省推导且推导正确）。
    if not os.path.isdir(knowledge):
        raise RuntimeError(
            f"KB_VAULT 解析出的知识库目录不存在：{knowledge}\n"
            f"（未设 KB_VAULT 时按脚本位置推导，基准={os.path.dirname(__file__)}）\n"
            f"——请显式设置 KB_VAULT 为 vault 仓库根目录的绝对路径"
        )
    return vault_root, knowledge


def normalize_vault_cli(path: str) -> tuple[str, str]:
    """解析 CLI ``--vault``：允许传仓库根或 ``…/知识库``。"""
    return vault_roots(path)


# ── 工件落点单源（SPEC-012 wave-2 类消收敛，Master 裁 2026-10-15）──
# 图族/运行时工件住 repo 侧 data/（②③④类），落点推导此前散布五处独立实现
# （pipeline-runner/generate-sa/extract_graph/_runtime_state_db 各拼各的），wave-2 搬家时
# 漏改即「旧位引用残留」一族的温床。收敛后：搬家＝改这里一处，消费方零感知；
# 旧 vault .anyshare 位唯一合法读者＝Node 侧 importLegacyGraphArtifacts 迁移链（读完即删）。

_DATA_DIR_GUIDE = (
    "KB_DATA_DIR 未设置：运行时工件（master_graph/extract_manifest/管线状态等）"
    "已迁 repo 侧 data/（SPEC-012）。服务端链路由管线 env 注入；"
    "手工运行请 export KB_DATA_DIR=<repo>/data"
)


def data_dir() -> str:
    """repo 侧持久层根（KB_DATA_DIR）；缺失即 fail-closed（附统一指引）。"""
    value = os.environ.get("KB_DATA_DIR")
    if not value:
        raise RuntimeError(_DATA_DIR_GUIDE)
    return value



def ledger_dir(vault_root: str | None = None) -> str:
    """账本目录唯一出处（PR-243 批B）：`.anyshare` 为实例产品名残留，退役改 `.ledger`。
    Node 侧单源＝server/vault-paths.cjs LEDGER_DIRNAME，两侧同值改须同笔。"""
    root = _abspath(vault_root) if vault_root else None
    if root is None:
        root = vault_roots()[0]
    return os.path.join(root, ".ledger")
def staging_dir() -> str:
    """图族 staging 落点（extract 写 / Node ingest 读，同一目录）。"""
    return os.path.join(data_dir(), "staging")


def staging_path(name: str) -> str:
    """staging 内工件路径——Python 侧图族落点的唯一推导入口。"""
    return os.path.join(staging_dir(), name)


def theschema_dir(knowledge_root: str | None = None) -> str:
    """SPEC-023 波 1：TheSchema 目录唯一解析点（与 server/shared/theschema-root.cjs 同优先级）。

    THESCHEMA_DIR 环境注入（测试/e2e）＞ vault 侧 知识库/TheSchema（迁移窗口主源）＞
    仓内 data/theschema（切换后主源——repo 回落经 realpath 定位，A 类 symlink 运行时亦可解析）。
    """
    injected = os.environ.get("THESCHEMA_DIR")
    if injected:
        return injected  # 硬钉：设即生效（与 node resolver 同语义）
    # WP-052 T3：探测面改为「目录含任一 yaml」（阶梯判置备状态语义等价）——词表文件名从
    # Python 侧代码消失（vocab-load-port 基线收敛；目标态 Python 无词表知识）
    if knowledge_root and _dir_has_yaml(os.path.join(knowledge_root, "TheSchema")):
        return os.path.join(knowledge_root, "TheSchema")
    repo_dir = os.path.join(
        os.path.dirname(os.path.realpath(__file__)), "..", "..", "data", "theschema"
    )
    if _dir_has_yaml(repo_dir):
        return repo_dir
    return os.path.join(knowledge_root, "TheSchema") if knowledge_root else repo_dir
