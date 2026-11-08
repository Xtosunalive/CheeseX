import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import type { components } from "@/lib/generated/api-types";
// seq209：字段中文名从 shared/field-labels.mjs 派生（实体修复主链路：entity 域优先、article 域兜底）。
import { fieldLabel as sharedFieldLabel } from "../../../shared/field-labels.mjs";
import { ENTITY_REPAIR_BLOCKER_COPY, ENTITY_REPAIR_BLOCKER_MESSAGES, LIB_REQUEST_COPY, entityRepairBlockerWithRaw, entityRepairCurrentValue } from "@/lib/lib-copy";

export type EntityRepairPreviewRequest = components["schemas"]["EntityRepairPreviewRequest"];
export type EntityRepairPreviewData = components["schemas"]["EntityRepairPreviewData"];
export type EntityRepairApplyData = components["schemas"]["EntityRepairApplyData"];

export function previewEntityRepair(request: EntityRepairPreviewRequest): Promise<EntityRepairPreviewData> {
  return unwrapEnvelope(apiFetchEnvelope<EntityRepairPreviewData>("/api/entity/repair/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }), LIB_REQUEST_COPY.REPAIR_PREVIEW_FAILED);
}

// E2'b #1：ADR043 退役 graph-fact Proposal——确认预览后直接写回正式源（乐观锁 + 原子写回 + 备份）
export function applyEntityRepair(previewId: string): Promise<EntityRepairApplyData> {
  return unwrapEnvelope(apiFetchEnvelope<EntityRepairApplyData>("/api/entity/repair/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previewId, confirmed: true }),
  }), LIB_REQUEST_COPY.REPAIR_APPLY_FAILED);
}

// seq178（#1457）：实体修复写门拒绝的字段级规则明细提取。后端 apply 在
// ENTITY_COMPLIANCE_BLOCKED 时回传 details.blockers（entity-repair-service.cjs，#1415：
// {ruleId, field, message} ≤10 条）；本函数做显式归一化（规则 5：跨边界数据禁止裸信任形状），
// 鸭子类型读取（不依赖 ApiError instanceof，兼容测试与运行时两种错误形态）。
export type RepairWriteGateBlocker = { ruleId: string; field: string; message: string };

// #1798：写门阻断中文化（展示层投影）。后端 ruleId/message 是机器契约（不动）；未知 ruleId 回退原文（不吞信息）。
// WP-152：映射表文案迁入 lib 层闭集 lib-copy.ts（ENTITY_REPAIR_BLOCKER_MESSAGES——维护口径与 F02「必填」锁词说明随表）。
const BLOCKER_MESSAGES = ENTITY_REPAIR_BLOCKER_MESSAGES;

export function describeBlocker(ruleId: string, message: string): string {
  const zh = BLOCKER_MESSAGES[ruleId];
  // 原文已是人话（含中文，如检查器直接产出的中文 message）→ 保持原文，禁止双重包装（规则 5 显式归一）；
  // 映射表仅作英文原文兜底（seq178 语义：检查器中文表述最贴场景，优先于静态映射）
  if (!zh || /[\u4e00-\u9fff]/.test(message)) return message;
  return entityRepairBlockerWithRaw(zh, message);
}

// seq179（#1470）：归一化内核单源（规则 8）——apply 拒绝面（seq178）与 preview 面（seq179）
// 共用同一 {ruleId,field,message} 显式归一化（规则 5：跨边界数据禁止裸信任形状）。
// #1798：message 经 describeBlocker 投影人读中文（常见 ruleId），未知回退原文。
// #1801：newViolations 元素携带 currentValue（如「7.0.6.8 → 7.0.6.7」）——拼入 message 让用户看到改什么。
function normalizeBlockerRecords(raw: unknown): RepairWriteGateBlocker[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const ruleId = typeof record.ruleId === "string" && record.ruleId ? record.ruleId : "UNKNOWN";
    const rawMessage = typeof record.message === "string" && record.message ? record.message : ENTITY_REPAIR_BLOCKER_COPY.REASON_MISSING;
    const currentValue = typeof record.currentValue === "string" && record.currentValue ? entityRepairCurrentValue(record.currentValue) : "";
    return {
      ruleId,
      field: typeof record.field === "string" ? record.field : "",
      message: describeBlocker(ruleId, rawMessage) + currentValue,
    };
  });
}

// 写门拒绝的两条服务端路径（#1801 实测 tr_8ef76b6d：preview 阶段 POST_CHECK_REGRESSION 同样拒写）：
// - ENTITY_COMPLIANCE_BLOCKED → details.blockers（阻断集）
// - POST_CHECK_REGRESSION → details.newViolations（受守护规则「从过变不过」增量，元素含 currentValue）
export function extractRepairBlockers(error: unknown): RepairWriteGateBlocker[] {
  const candidate = error as { errorCode?: unknown; details?: unknown } | null;
  if (!candidate || typeof candidate !== "object") return [];
  if (candidate.errorCode !== "ENTITY_COMPLIANCE_BLOCKED" && candidate.errorCode !== "POST_CHECK_REGRESSION") return [];
  const details = candidate.details as { blockers?: unknown; newViolations?: unknown } | null;
  const raw = details?.blockers ?? details?.newViolations;
  return normalizeBlockerRecords(raw);
}

// seq179（#1470）：preview 阶段（「查看修复结果」成功响应）的 postCheck.blockers 归一化。
// 展示时机前移——用户不点「直接写回」就能在字段位置看到阻断原因（ADR024 展示时机条款）。
// postCheck 形状=契约 BlockerDetail[]（EG-1a 定型）；文章分支渐进补齐期不返回 → 空数组。
export function extractPostCheckBlockers(postCheck: unknown): RepairWriteGateBlocker[] {
  const raw = (postCheck as { blockers?: unknown } | null)?.blockers;
  return normalizeBlockerRecords(raw);
}

// 字段中文名读取入口（seq181 合并 → seq209 收口到 shared/field-labels.mjs）。
// 消费方：EntityRepairDrawer.fieldLabel、PropertyCheckRow.fieldLabel、extractFieldBlocker 行内报错拼装。
// 本模块不再持有中文字面量——改键只需动 shared 一份。
export function fieldLabel(field: string): string {
  return sharedFieldLabel(field);
}

// seq181：preview 请求被拒通道的字段归一化（第三入口，与 extractRepairBlockers/extractPostCheckBlockers
// 共同汇入 repairBlockers 单槽）。后端字段级校验错误（VALIDATION_ERROR 族）携带 details={field,rule}
// （EG-1b details 透传结构承载），本函数将其归一为 {ruleId, field, message}，message 拼装中文字段标签
// （shared/field-labels.mjs 单源）+ 去字段名前缀的规则文本；无 field 归因的错误返回 null（保持全局条兜底）。
export function extractFieldBlocker(error: unknown): RepairWriteGateBlocker | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { errorCode?: unknown; message?: unknown; details?: unknown };
  const details = candidate.details as { field?: unknown; rule?: unknown } | null;
  if (!details || typeof details !== "object" || typeof details.field !== "string" || !details.field) return null;
  const field = details.field;
  const label = sharedFieldLabel(field);
  const raw = typeof candidate.message === "string" ? candidate.message : "";
  const ruleText = raw.startsWith(field) ? raw.slice(field.length).trimStart() : raw;
  const ruleId = typeof candidate.errorCode === "string" && candidate.errorCode ? candidate.errorCode : "UNKNOWN";
  return { ruleId, field, message: ruleText ? `${label} ${ruleText}` : label };
}

