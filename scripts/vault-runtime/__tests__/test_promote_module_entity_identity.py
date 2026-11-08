"""WP-113 M4：promote 建的模块 stub 不再用词表 system 名顶替组件身份号。

事实说明：此前 promote-article 的 ensure_module_entities 在本仓**无任何测试覆盖**（只
test_promote_archive_readonly.py 覆盖归档分支），故本条是新增最小覆盖，不是断言迁移。
现场另有一处实况：ensure_module_entities 已从 promote_one 主路径退役（promote-article.py:412
注释在册），本刀只改语义不复活调用，也不删函数（不在本批范围）。

判据：architecture-node-id 留空，补号交实体修复流（唯一铸造口 server/shared/entity-identity-mint.cjs）；
Python 侧不自写 UUID v4 编码器。留空后仍可见：F02（必填）实测对 arch_component:false 一样拦截。
category-path 里的 system 标签是「模块挂哪个系统」的描述，非身份号，行为保持不变（正对照）。
层级：纯单元（临时 vault 目录＋函数级断言，不触真库、不起外部服务）。
"""
import sys
from pathlib import Path
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "promote_article", str(Path(__file__).resolve().parents[1] / "promote-article.py")
)
pa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pa)

MOD_NAME = "测试模块"
SYSTEM_LABEL = "测试系统"


def _isolate(monkeypatch, tmp_path):
    ents = tmp_path / "wiki" / "entities"
    ents.mkdir(parents=True)
    monkeypatch.setattr(pa, "ENTITIES_DIR", str(ents))
    monkeypatch.setattr(pa, "load_enums_modules", lambda: {
        MOD_NAME: {"system": SYSTEM_LABEL, "products": ["产品甲"]}
    })
    monkeypatch.setattr(pa, "build_wikilink_index", lambda: set())
    return ents


def _article(tmp_path):
    """stub 的关联目标要读文章路径（article_target 无条件取 basename）——给一个真实存在的临时件。"""
    article = tmp_path / "raw" / "article.md"
    article.parent.mkdir(parents=True, exist_ok=True)
    article.write_text("---\ntitle: 甲文\nsource_file: raw/imported/x.md\n---\n正文\n", encoding="utf-8")
    return str(article)


def _read_stub(path):
    """promote-article.parse_frontmatter 只回 frontmatter 字典（不回 body）——正文另取原文。"""
    return pa.parse_frontmatter(str(path)), Path(path).read_text(encoding="utf-8")


def test_模块stub的身份号留空不再用系统名顶替(monkeypatch, tmp_path):
    ents = _isolate(monkeypatch, tmp_path)

    created, skipped, names = pa.ensure_module_entities(
        {"module": f"[[{MOD_NAME}]]"}, _article(tmp_path), "甲文"
    )

    assert (created, skipped, names) == (1, 0, [MOD_NAME]), (created, skipped, names)
    stub_path = ents / f"{MOD_NAME}.md"
    assert stub_path.exists(), "stub 应落盘"
    fm, raw = _read_stub(stub_path)
    assert not str(fm.get("architecture-node-id") or "").strip(), (
        f"身份号必须留空交补号流，实况 {fm.get('architecture-node-id')!r}"
    )
    assert "architecture-node-id" in fm, "留空≠删键——显式空位才是「待补号」的可见声明"
    id_lines = [ln for ln in raw.splitlines() if ln.startswith("architecture-node-id")]
    assert id_lines == ["architecture-node-id:"], f"该键只留空位，不掺任何现编值：{id_lines}"
    assert fm.get("arch_component") is False, "本刀不改晋升标记"


def test_身份号留空仍被F02判缺(monkeypatch, tmp_path):
    """正对照之外的关键实况：留空不是「绕开必填」——F02 对 arch_component:false 的实体同样拦截（空值/缺值皆不通过）。"""
    ents = _isolate(monkeypatch, tmp_path)
    pa.ensure_module_entities({"module": MOD_NAME}, _article(tmp_path), "甲文")
    stub_path = ents / f"{MOD_NAME}.md"
    fm, _raw = _read_stub(stub_path)

    engine = None
    try:
        import subprocess, json
        probe = subprocess.run(
            ["node", "-e",
             "const {ruleDiag}=require('./scripts/quality/__tests__/helpers/entity-rule-tester.cjs');"
             "const fm=JSON.parse(process.argv[1]);"
             "const d=ruleDiag(fm,'F02');"
             "console.log(JSON.stringify({passed:d.passed,severity:d.severity,message:d.message}));",
             json.dumps(fm, default=str)],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parents[3]),
        )
        assert probe.returncode == 0, probe.stderr
        engine = json.loads(probe.stdout)
    except Exception as exc:  # pragma: no cover - 探针不可用时显式失败，不静默放过
        raise AssertionError(f"F02 探针未能运行，无法证明留空仍可判缺：{exc}")

    assert engine["passed"] is False, f"留空应仍被 F02 判缺（必填无条件生效）：{engine}"
    assert engine["severity"] == "error", engine


def test_category_path的system标签保持不变(monkeypatch, tmp_path):
    """正对照：只撤身份号那一处，category-path 与正文的系统描述照旧（否则本刀就成了误杀描述的假红）。"""
    ents = _isolate(monkeypatch, tmp_path)
    pa.ensure_module_entities({"module": MOD_NAME}, _article(tmp_path), "甲文")
    fm, raw = _read_stub(ents / f"{MOD_NAME}.md")
    assert fm.get("category-path") == f"ref:module:{SYSTEM_LABEL}", fm.get("category-path")
    assert SYSTEM_LABEL in raw.split("---", 2)[-1], "正文的「关联系统」描述不得被撤号一并删掉"


def test_未注册模块仍跳过不建页(monkeypatch, tmp_path):
    """既有语义不变（差分基线）：词表未注册的 module 计 skipped，不产 stub。"""
    _isolate(monkeypatch, tmp_path)
    created, skipped, names = pa.ensure_module_entities({"module": "[[没登记的模块]]"}, None, None)
    assert (created, skipped, names) == (0, 1, []), (created, skipped, names)
    assert list(Path(pa.ENTITIES_DIR).glob("*.md")) == []
