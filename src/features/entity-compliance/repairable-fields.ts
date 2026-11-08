// seq205 计数单源：可修复字段问题的唯一派生出口（规则 8 在 UI 层直译）。
// 列表卡片徽标与修复抽屉的字段框都必须从本 selector 派生——历史上三口径各算
// （后端 severity 计数 / 前端 editable∩EDITABLE 过滤 / 带建议子集）导致「列表数 ≠ 抽屉框数」。
// 口径（WP-110/D-1a 判据分离）：可见性＝字段 ∈ EDITABLE 白名单（受管字段一律成行，含只读行）；
// 可改性＝check.editable（能力位，交抽屉渲染只读）。此前把 !check.editable 当「不渲染」判据——
// 服务端如实把「创建后不可修改」的身份字段置 editable=false 时整行消失，抽屉 immutableLocked 只读分支永不可达。
// 只读行的前置条件（复核 C2，WP-110 随批）：锁定位必须「有现值可展示」才成行——现值通道（sourceValues）
// 没这个键时，只读行既报不出当前值、又会在展开后让人对着未知旧值盲改（aliases 实测即如此：诊断侧
// EDITABLE_FIELDS 不含它 → 能力位 false，而写门接受它 → 一旦成行就成了覆盖旧表的入口）。
// 按字段去重，字段序=首次出现序（稳定渲染）。
// 双口径（seq206 用户裁决，复核 C3 收紧）：count = 渲染出的字段行数（抽屉编辑面，#1409 多值编辑能力锚定）；
// failedCount = 未通过**且改得动**的字段数（卡片徽标「修复 N 字段」专用——徽标必须回答"真需修复几处"；
// 锁死行不参与徽标，因为改名退出通道 PR-229 第④步未批，计入即成死胡同徽章）。抽屉渲染全部 issues 且未通过排前。
import type { EntityComplianceResult } from "./entity-compliance-types";
import { EDITABLE } from "./entity-editable-fields";

export interface RepairableFieldIssue {
  field: string;
  failed: boolean;
  locked: boolean;
  checks: NonNullable<
    NonNullable<EntityComplianceResult["groups"]>[number]["checks"]
  >;
  best: NonNullable<
    NonNullable<EntityComplianceResult["groups"]>[number]["checks"]
  >[number];
}

export interface RepairableFieldReport {
  count: number;
  failedCount: number;
  issues: RepairableFieldIssue[];
}

// 现值通道是否存在该键（null/空串算存在——空值行照常渲染，只是显示「未填写」）
function hasValueChannel(entity: EntityComplianceResult | null | undefined, field: string): boolean {
  const values = entity?.sourceValues as Record<string, unknown> | undefined;
  return Boolean(values) && Object.prototype.hasOwnProperty.call(values, field);
}

export function repairableFieldIssues(entity: EntityComplianceResult | null | undefined): RepairableFieldReport {
  const byField = new Map<string, RepairableFieldIssue>();
  for (const group of entity?.groups || []) {
    for (const check of group.checks || []) {
      if (!check.field) continue;
      const field = String(check.field);
      if (!EDITABLE.has(field)) continue;
      const locked = check.editable === false;
      // 锁定位无现值可展示 → 不成行（复核 C2：否则展开后是对未知旧值的盲编辑）
      if (locked && !hasValueChannel(entity, field)) continue;
      const existing = byField.get(field);
      if (existing) {
        existing.checks.push(check);
        if (!check.passed) existing.failed = true;
        if (!locked) existing.locked = false;
      } else {
        byField.set(field, { field, failed: !check.passed, locked, checks: [check], best: check });
      }
    }
  }
  const issues = [...byField.values()];
  return {
    count: issues.length,
    failedCount: issues.filter((issue) => issue.failed && !issue.locked).length,
    issues,
  };
}
