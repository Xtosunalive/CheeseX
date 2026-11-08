// Component: Null-Segment-Guard Tests（数据域治理批 A6——红绿夹具）
// @responsible: 反例①rogue 写方 doc.set("<null段>") 被报（含文件:行号）；
//               反例②注册表 null+reserved 段不入扫描集（预留位无被写语义）；
//               正例③合法段写（layers 等有页签段）零命中。
// @inputs: shared/null-segment-guard.mjs 纯函数
// @outputs: node:test 断言
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectNullSegments, scanNullSegmentDirectWrites } from "../shared/null-segment-guard.mjs";

const REGISTRY = {
  entries: [
    {
      file: "data/theschema/enums.yaml",
      segments: [
        { segment: "lifecycle", edited_by_tab: null },
        { segment: "subdomain_layer_map + category_map", edited_by_tab: null },
        { segment: "concept_types", edited_by_tab: null, status: "reserved" },
        { segment: "layers", edited_by_tab: "layers" },
      ],
    },
    { file: "data/theschema/fields.yaml", segments: [{ segment: "fields[]", edited_by_tab: null }] },
  ],
};

test("A6 红：collectNullSegments 只收 enums 行的 null 且非 reserved 段（复合拆分、跨文件不收）", () => {
  assert.deepEqual(collectNullSegments(REGISTRY).sort(), ["category_map", "lifecycle", "subdomain_layer_map"]);
});

test("A6 红：rogue 写方 doc.set(\"<null段>\") 被报——含文件与行号", () => {
  const hits = scanNullSegmentDirectWrites({
    nullSegments: ["lifecycle", "category_map"],
    files: [
      { rel: "server/services/demo.cjs", content: 'const x = 1;\ndoc.set("lifecycle", doc.createNode(next));\n' },
      { rel: "scripts/vault-runtime/demo.mjs", content: 'doc.set("category_map",\n  node);' },
    ],
  });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { file: "server/services/demo.cjs", line: 2, segment: "lifecycle" });
  assert.equal(hits[1].segment, "category_map");
});

test("A6 绿：有页签段（layers）与无关 set 零命中", () => {
  const hits = scanNullSegmentDirectWrites({
    nullSegments: ["lifecycle"],
    files: [{ rel: "a.cjs", content: 'doc.set("layers", n);\nstore.set("lifecycle_display", v);\nplain.set(lifecycle, n);\n' }],
  });
  assert.deepEqual(hits, []);
});
