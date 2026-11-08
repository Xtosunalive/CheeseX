# 层级：真实集成（write_gateway 咽喉级）——WP-015/SPEC-077「机器回写不覆盖人手改」Python 侧双向锚。
# 与 server/shared/__tests__/human-edit-guard.test.cjs 同判据（跨语言单源＝侧账文件本身）。
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from human_edit_guard import HumanEditConflict, check_write, check_delete, record, _baseline_path_for  # noqa: E402
from write_gateway import write_text_atomic  # noqa: E402


def fm(kv: dict) -> str:
    lines = ["---"] + [f"{k}: {v}" for k, v in kv.items()] + ["---"]
    return "\n".join(lines)


def page(kv: dict, body: str = "# 样例\n\n正文内容。\n") -> str:
    return fm(kv) + "\n\n" + body


class HumanEditGuardTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="heg-py-")
        self.vault = Path(self._tmp.name)
        self.page = self.vault / "知识库" / "wiki" / "entities" / "sample.md"
        self.page.parent.mkdir(parents=True, exist_ok=True)
        self.addCleanup(self._tmp.cleanup)

    def baseline(self):
        bp = _baseline_path_for(self.page)
        return json.loads(bp.read_text(encoding="utf-8"))["知识库/wiki/entities/sample.md"]

    def test_red_frontmatter_same_key(self):
        """红例①：人改键 × 机器写同键 → 拒，盘上保留人改值。"""
        self.page.write_text(page({"title": "样例", "tags": "a,b", "status": "draft"}), encoding="utf-8")
        write_text_atomic(self.page, page({"title": "样例", "tags": "a,b", "status": "active"}))
        self.assertEqual(self.baseline()["fm"]["status"], "active", "机写后基线登记")
        self.page.write_text(page({"title": "样例", "tags": "a,b,人改", "status": "active"}), encoding="utf-8")
        with self.assertRaises(HumanEditConflict) as ctx:
            check_write(self.page, page({"title": "样例", "tags": "机器盖", "status": "active"}))
        self.assertIn("tags", ctx.exception.overlap)
        self.assertIn("人改", self.page.read_text(encoding="utf-8"), "拒写后人改值保留")

    def test_green_disjoint_keys(self):
        """绿例①：人改 tags × 机器写 status → 放行且人改保留，写后基线吸纳人改形态。"""
        self.page.write_text(page({"title": "样例", "tags": "a,b"}), encoding="utf-8")
        write_text_atomic(self.page, page({"title": "样例", "tags": "a,b", "status": "active"}))
        self.page.write_text(page({"title": "样例", "tags": "a,b,人改", "status": "active"}), encoding="utf-8")
        check_write(self.page, page({"title": "样例", "tags": "a,b,人改", "status": "retired"}))
        write_text_atomic(self.page, page({"title": "样例", "tags": "a,b,人改", "status": "retired"}))
        text = self.page.read_text(encoding="utf-8")
        self.assertIn("人改", text)
        self.assertIn("retired", text)
        self.assertEqual(self.baseline()["fm"]["tags"], "a,b,人改")

    def test_red_and_green_body(self):
        """红例②：人改正文×机器写正文 → 拒；绿例②：机器只写 frontmatter → 放行。"""
        self.page.write_text(page({"title": "样例"}, "# 样例\n\n原始正文。\n"), encoding="utf-8")
        write_text_atomic(self.page, page({"title": "样例"}, "# 样例\n\n原始正文。\n"))
        self.page.write_text(page({"title": "样例"}, "# 样例\n\n人手重写的正文。\n"), encoding="utf-8")
        with self.assertRaises(HumanEditConflict) as ctx:
            check_write(self.page, page({"title": "样例"}, "# 样例\n\n机器重写的正文。\n"))
        self.assertIn("body", ctx.exception.overlap)
        check_write(self.page, page({"title": "样例", "status": "retired"}, "# 样例\n\n人手重写的正文。\n"))

    def test_seeding_legacy_page(self):
        """播种：协议前存量无基线首次写放行并登记；此后人改同键即拒。"""
        self.page.write_text(page({"title": "存量页", "tags": "老值"}), encoding="utf-8")
        write_text_atomic(self.page, page({"title": "存量页", "tags": "老值", "status": "active"}))
        self.assertTrue(self.baseline(), "播种登记")
        self.page.write_text(page({"title": "存量页", "tags": "新人改"}), encoding="utf-8")
        with self.assertRaises(HumanEditConflict):
            check_write(self.page, page({"title": "存量页", "tags": "机器值"}))

    def test_delete_guard(self):
        """删除裁决：有基线被手改拒删；无基线放行。"""
        self.page.write_text(page({"title": "占位", "status": "制定中"}), encoding="utf-8")
        write_text_atomic(self.page, page({"title": "占位", "status": "制定中"}))
        self.page.write_text(page({"title": "占位", "status": "制定中"}, "# 占位\n\n人开始写了。\n"), encoding="utf-8")
        with self.assertRaises(HumanEditConflict):
            check_delete(self.page)
        other = self.vault / "知识库" / "wiki" / "entities" / "never-existed.md"
        check_delete(other)  # 无基线 → 放行（不抛）

    def test_h6_date_keys_real_shape(self):
        """H6 钉：含日期键真实形态页——基线登记不崩（default=str）、同键人改拒。"""
        self.page.write_text("---\ntitle: 真实页\ndate: 2026-10-08\nfirst_seen: 2026-09-01\nstatus: draft\n---\n\n# 真实页\n", encoding="utf-8")
        write_text_atomic(self.page, "---\ntitle: 真实页\ndate: 2026-10-08\nfirst_seen: 2026-09-01\nstatus: active\n---\n\n# 真实页\n")
        self.assertEqual(self.baseline()["fm"]["date"], "2026-10-08", "日期键字符串化入基线")
        self.page.write_text("---\ntitle: 真实页\ndate: 2026-11-01\nfirst_seen: 2026-09-01\nstatus: active\n---\n\n# 真实页\n", encoding="utf-8")
        with self.assertRaises(HumanEditConflict):
            check_write(self.page, "---\ntitle: 真实页\ndate: 2026-10-09\nfirst_seen: 2026-09-01\nstatus: active\n---\n\n# 真实页\n")

    def test_h4_seeded_marker(self):
        """H4 钉：播种条目带 seeded 标记（首次机写吞人改可审计）。"""
        self.page.write_text(fm({"title": "手工新页", "tags": "人填"}), encoding="utf-8")
        write_text_atomic(self.page, fm({"title": "手工新页", "tags": "人填"}) + "\n\n# 手工新页\n")
        self.assertTrue(self.baseline().get("seeded"), "播种标记在册")

    def test_out_of_scope_untouched(self):
        """非实体页（文章等）不进裁决——既有行为零变化。"""
        article = self.vault / "知识库" / "raw" / "precleaned" / "a.md"
        article.parent.mkdir(parents=True, exist_ok=True)
        article.write_text(fm({"title": "文章"}), encoding="utf-8")
        check_write(article, fm({"title": "文章", "module": "x"}))  # 不抛
        record(article, fm({"title": "文章", "module": "x"}))
        self.assertIsNone(_baseline_path_for(article), "范围外路径不解析基线位＝不落侧账")


if __name__ == "__main__":
    unittest.main()
