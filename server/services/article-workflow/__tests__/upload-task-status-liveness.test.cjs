// upload-task-status-liveness — 任务派生①加产活面＋聚合入口在册面（WP-133 子项①迁移件）
// 层级：纯单元（真源=仓内服务端源文件直读＋uploadTaskStatus 纯函数行为）。
//
// 迁移映射（自退役门禁 scripts/quality/check-state-liveness.mjs，断言语义逐条对齐）：
//   旧门禁③「加产活面」——TASK_STATUSES 六值必须在 uploadTaskStatus 的 return 路径字面量集
//     可达（returnLiterals＝/return[^;]*;/g 语句内 "([a-z_]+)" 字面量并集；dead 即红）
//     → 本文件 test A（同一提取谓词）＋ test C（行为面加强：六值构造输入真可达，非仅文本扫描）。
//   旧门禁④「派生①聚合规则源在册」——聚合决策唯一入口＝uploadTaskStatus
//     （service 含 syncUploadTasks＋upload 文件含 uploadTaskStatus(matches, task, vaultPath, approvalStatusOf) 签名串）
//     → 本文件 test B（同一断言原文）。
//   旧门禁①②③三源一致面 → gen-value-domains 生成器 --check 承接（derivation-sync 纳保），不在本文件。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { TASK_STATUSES, uploadTaskStatus } = require("../article-upload-status.cjs");

const UPLOAD_SRC = fs.readFileSync(path.join(__dirname, "..", "article-upload-status.cjs"), "utf8");
const SERVICE_SRC = fs.readFileSync(path.join(__dirname, "..", "article-workflow-service.cjs"), "utf8");

test("A 加产活面：TASK_STATUSES 每值在 uploadTaskStatus return 路径可达（旧门禁③同谓词）", () => {
  // return 语句（含三元/条件形态）内的字符串字面量集＝生产路径面（与退役门禁提取逐字对齐）
  const returnLiterals = [...new Set([...UPLOAD_SRC.matchAll(/return[^;]*;/g).flatMap((m) => [...m[0].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]))])];
  const dead = TASK_STATUSES.filter((v) => !returnLiterals.includes(v));
  assert.deepEqual(dead, [], `任务态死枚举（登记无生产路径——uploadTaskStatus 无 return）：${JSON.stringify(dead)}`);
});

test("B 聚合入口在册：聚合决策唯一落 uploadTaskStatus（旧门禁④同断言）", () => {
  assert.ok(SERVICE_SRC.includes("syncUploadTasks"), "article-workflow-service 须调 syncUploadTasks（SPEC-030 §三聚合表落码处）");
  assert.ok(
    UPLOAD_SRC.includes("uploadTaskStatus(matches, task, vaultPath, approvalStatusOf)"),
    "聚合入口漂移——聚合决策须唯一落 uploadTaskStatus（SPEC-030 §三）",
  );
});

test("C 行为面加强：六值构造输入真可达（return 路径不止文本在册，行为可达）", () => {
  const noApproval = () => null; // 探针缺省＝按未发布（fail-safe）
  const snapshot = () => "snapshot";
  const base = { taskId: "t", originalFileName: "a.md", draftPath: "知识库/raw/drafts/投稿/a.md", status: "awaiting_architect_processing", articleIds: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  const reached = new Set();
  const probe = (matches, task, vaultPath, approvalStatusOf) => reached.add(uploadTaskStatus(matches, task, vaultPath, approvalStatusOf));
  const std = (s) => ({ id: "a1", sourcePath: "知识库/raw/precleaned/a.md", standardizationStatus: s });

  probe([], { ...base, status: "digested" }, null, noApproval); // digested 终态短路
  probe([], { ...base, articleIds: ["x"], vaultPath: undefined }, undefined, snapshot); // 历史候选审批达 snapshot→published
  probe([], { ...base, articleIds: ["x"] }, undefined, noApproval); // 历史候选未达→source_deleted
  probe([], { ...base, draftPath: "gone" }, "/definitely/missing", noApproval); // 源文件不存在→source_deleted
  probe([], { ...base }, null, noApproval); // 无候选源在→awaiting_architect_processing
  probe([std("pending_standardization")], base, null, noApproval); // 候选未标准化→awaiting_approval
  probe([std("blocked")], base, null, noApproval); // 候选阻断→awaiting_approval
  probe([std("standardized")], base, null, noApproval); // 候选齐整未发布→standardized
  probe([std("standardized")], base, null, snapshot); // 全候选审批达 snapshot→published

  for (const value of TASK_STATUSES) {
    assert.ok(reached.has(value), `值 ${value} 行为不可达——聚合表与 return 路径脱钩`);
  }
});
