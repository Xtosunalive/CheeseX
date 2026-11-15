// Layer: gate test（quality 脚本域）· 验证对象: scripts/quality/check-response-count-parity.mjs
// 先红后绿：真仓须 ok（topology 两对象已执法且合规）；夹具覆盖 R1/R2/R3 反例必红，无标记对象只登记不阻断。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runResponseCountParity } from "../check-response-count-parity.mjs";

// fields: 字段名 → description（null 表示裸 integer，无 description）
function fixture({ enforce, fields }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "count-parity-"));
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  const properties = {};
  for (const [name, desc] of Object.entries(fields)) {
    properties[name] = desc === null ? { type: "integer" } : { type: "integer", description: desc };
  }
  const demo = { type: "object", properties };
  if (enforce) demo["x-count-parity"] = true;
  const doc = { openapi: "3.1.0", paths: {}, components: { schemas: { Demo: demo } } };
  fs.writeFileSync(path.join(root, "contracts", "http-api.openapi.json"), JSON.stringify(doc));
  return root;
}

const GREEN_FIELDS = {
  totalNodes: "准入实体节点总数（经 graph-admission 过滤）",
  returnedNodes: "实际返回节点数，恒 ≤ totalNodes",
  totalEdges: "准入实体之间的边总数（经 graph-admission 过滤）",
  returnedEdges: "实际返回边数，恒 ≤ totalEdges",
};

test("真仓：六个执法对象（topology 两＋PR-269 新纳保四形状）合规，0 违例", () => {
  const result = runResponseCountParity();
  assert.equal(result.ok, true, result.violations.join("\n"));
  // PR-269 扩面（2026-11-15）：topology 两处原标记＋新纳保 ArticleUploadList/CanvasAdmissionData/
  // CanonicalDocumentSearchData/inference-conflicts 响应＝6；存量违例 8 条以修数清零，未设基线豁免。
  assert.equal(result.stats.enforcedObjects, 6);
});

test("绿：合规标记对象（同过滤口径＋returned 含 ≤）→ ok", () => {
  const root = fixture({ enforce: true, fields: GREEN_FIELDS });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, true, result.violations.join("\n"));
  assert.equal(result.stats.enforcedObjects, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R1：标记对象的计数字段无 description → 口径缺失", () => {
  const root = fixture({ enforce: true, fields: { totalNodes: null, totalEdges: "边总数（经 graph-admission 过滤）" } });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径缺失.*totalNodes/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R3：totalNodes 过滤、totalEdges 全量 → 口径冲突", () => {
  const root = fixture({
    enforce: true,
    fields: {
      totalNodes: "准入实体节点总数（经 graph-admission 过滤）",
      totalEdges: "原始图全部边总数",
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径冲突/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R2：returnedNodes 描述未声明 ≤ totalNodes → 配对缺失", () => {
  const root = fixture({
    enforce: true,
    fields: {
      totalNodes: "准入实体节点总数（经 graph-admission 过滤）",
      returnedNodes: "实际返回的节点数",
      totalEdges: "准入实体之间的边总数（经 graph-admission 过滤）",
      returnedEdges: "实际返回边数，恒 ≤ totalEdges",
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /配对缺失.*returnedNodes/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("无标记对象即使字段无描述也不阻断（只登记，enforced=0）", () => {
  const root = fixture({ enforce: false, fields: { totalNodes: null, totalEdges: null } });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, true);
  assert.equal(result.stats.enforcedObjects, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── PR-269 扩面（2026-11-15）：裸 total、计数图、$ref 级联、集合声明 R4、allOf 组合根 ──
function rawFixture(schemas) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "count-parity-p269-"));
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "contracts", "http-api.openapi.json"),
    JSON.stringify({ openapi: "3.1.0", paths: {}, components: { schemas } })
  );
  return root;
}

test("验收锚：ArticleUploadList 形状（裸 total vs items）标记后 total 无 description → 口径缺失", () => {
  const root = rawFixture({
    ArticleUploadList: {
      "x-count-parity": true,
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        total: { type: "integer" },
      },
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径缺失.*total/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("红 R4：total 描述未点名 items → 集合声明缺失（计数与数组两张皮）", () => {
  const root = rawFixture({
    ArticleUploadList: {
      "x-count-parity": true,
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        total: { type: "integer", description: "全库上传任务总数" },
      },
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /集合声明缺失.*total/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("绿：total 描述点名 items（集合声明齐备）→ ok", () => {
  const root = rawFixture({
    ArticleUploadList: {
      "x-count-parity": true,
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        total: { type: "integer", description: "全库上传任务总数（items 为分页切片）" },
      },
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, true, result.violations.join("\n"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("破坏实验：标记在场违例必红，撤标记必绿（执法随声明撤除），复原必红", () => {
  const schemas = {
    ArticleUploadList: {
      "x-count-parity": true,
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        total: { type: "integer" },
      },
    },
  };
  const root = rawFixture(schemas);
  assert.equal(runResponseCountParity({ rootDir: root }).ok, false); // 标记在场：违例入镜
  delete schemas.ArticleUploadList["x-count-parity"]; // 撤标记
  fs.writeFileSync(
    path.join(root, "contracts", "http-api.openapi.json"),
    JSON.stringify({ openapi: "3.1.0", paths: {}, components: { schemas } })
  );
  assert.equal(runResponseCountParity({ rootDir: root }).ok, true); // 撤标记：只登记不阻断
  fs.rmSync(root, { recursive: true, force: true });
});

test("级联＋$ref 解引：标记根的 summary 引用子对象里 totalResults 无 description → 红", () => {
  const root = rawFixture({
    CanonicalDocumentSummary: {
      type: "object",
      properties: { totalResults: { type: "integer" } },
    },
    SearchData: {
      "x-count-parity": true,
      type: "object",
      properties: {
        summary: { $ref: "#/components/schemas/CanonicalDocumentSummary" },
        documents: { type: "array", items: { type: "string" } },
      },
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径缺失.*totalResults/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("计数图：admittedByKind 无 description → 红（计数图形状入镜，PR-269）", () => {
  const root = rawFixture({
    CanvasAdmissionData: {
      "x-count-parity": true,
      type: "object",
      properties: {
        components: { type: "array", items: { type: "string" } },
        admittedByKind: { type: "object", additionalProperties: { type: "integer" } },
      },
    },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /口径缺失.*admittedByKind/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("allOf 组合根可被标记并执法（响应包络形态，walk visit 条件扩面）", () => {
  const root = rawFixture({
    ConflictData: {
      type: "object",
      properties: {
        conflicts: { type: "array", items: { type: "string" } },
        total: { type: "integer" },
      },
    },
    ConflictResponse: {
      "x-count-parity": true,
      allOf: [
        { $ref: "#/components/schemas/Envelope" },
        { type: "object", properties: { data: { $ref: "#/components/schemas/ConflictData" } } },
      ],
    },
    Envelope: { type: "object", properties: { ok: { type: "boolean" } } },
  });
  const result = runResponseCountParity({ rootDir: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join("\n"), /total/);
  fs.rmSync(root, { recursive: true, force: true });
});
