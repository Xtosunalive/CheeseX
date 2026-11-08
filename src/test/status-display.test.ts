// status-display 域守护测试（PR-130/STATUS-DISPLAY-001）——显示单源的活性面：
// ①parity：四机显示映射键集 ≡ 各自值集（契约枚举机另有编译期钉子——api-types 单源）
// ②行为：label 词与 TERM 单源一致；tone 四档语义正确；fail-safe 缺省回落待处理态
// ③破坏实验面在 parity——feature 私有映射复活时（旧路径 import 消失/键集对不上）此文件或 tsc 红。
import { describe, expect, it } from "vitest";
import { TERM } from "@/constants/term-const";
import {
  ADMISSION_STATUS_DISPLAY,
  VERSION_STATUS_DISPLAY,
  ADMISSION_STATUS_VALUES,
  APPROVAL_STATUS_DISPLAY,
  ARTICLE_TASK_STATUS_DISPLAY,
  STANDARDIZATION_STATUS_DISPLAY,
  admissionStatusDisplay,
  approvalStatusDisplay,
  articleTaskStatusDisplay,
  isAdmissionStatusValue,
  standardizationStatusDisplay,
  versionStatusDisplay,
} from "@/lib/domain/StatusDisplay";

describe("status-display 域：parity（四机键集全覆盖）", () => {
  it("审批五态键集 ≡ 契约 ApprovalStatusEnum 派生键集", () => {
    expect(Object.keys(APPROVAL_STATUS_DISPLAY).sort()).toEqual(
      ["approved", "draft", "pending", "rejected", "snapshot"],
    );
  });

  it("标准化三态 / 任务六态 / 准入三态键集与值集全等", () => {
    expect(Object.keys(STANDARDIZATION_STATUS_DISPLAY).sort()).toEqual(
      ["blocked", "pending_standardization", "standardized"],
    );
    expect(Object.keys(ARTICLE_TASK_STATUS_DISPLAY).sort()).toEqual(
      ["awaiting_approval", "awaiting_architect_processing", "digested", "published", "source_deleted", "standardized"],
    );
    expect(Object.keys(ADMISSION_STATUS_DISPLAY).sort()).toEqual([...ADMISSION_STATUS_VALUES].sort());
  });
});

describe("status-display 域：显示词走 TERM（单源词表）", () => {
  it("抽钉：approval/standardization/task/admission 各至少一键的 label ≡ TERM", () => {
    expect(APPROVAL_STATUS_DISPLAY.snapshot.label).toBe(TERM.APPROVAL_SNAPSHOT);
    expect(STANDARDIZATION_STATUS_DISPLAY.blocked.label).toBe(TERM.STANDARDIZATION_BLOCKED);
    expect(ARTICLE_TASK_STATUS_DISPLAY.digested.label).toBe(TERM.TASK_DIGESTED);
    expect(ADMISSION_STATUS_DISPLAY.PENDING.label).toBe(TERM.ADMISSION_PENDING); // PD-5：REJECTED 死值退役
  });
});

describe("status-display 域：tone 语义（四档）", () => {
  it("审批机：draft=neutral、pending=warn、approved/snapshot=fact、rejected=error", () => {
    expect(approvalStatusDisplay("draft").tone).toBe("neutral");
    expect(approvalStatusDisplay("pending").tone).toBe("warn");
    expect(approvalStatusDisplay("approved").tone).toBe("fact");
    expect(approvalStatusDisplay("snapshot").tone).toBe("fact");
    expect(approvalStatusDisplay("rejected").tone).toBe("error");
  });

  it("准入机与标准化机：生效 fact / 待处理 warn / 阻断 error", () => {
    expect(admissionStatusDisplay("APPROVED").tone).toBe("fact");
    expect(admissionStatusDisplay("PENDING").tone).toBe("warn");
    expect(standardizationStatusDisplay("standardized").tone).toBe("fact");
    expect(standardizationStatusDisplay("blocked").tone).toBe("error");
  });

  it("任务机中性态：source_deleted/digested=neutral", () => {
    expect(articleTaskStatusDisplay("source_deleted").tone).toBe("neutral");
    expect(articleTaskStatusDisplay("digested").tone).toBe("neutral");
  });
});

describe("status-display 域：版本生命周期机（PR-130 复查补漏·第五机）", () => {
  it("三态键集 ≡ 契约 VersionRegistryEntry.status 枚举派生键集", () => {
    expect(Object.keys(VERSION_STATUS_DISPLAY).sort()).toEqual(["deprecated", "draft", "released"]);
  });

  it("tone 语义：draft=neutral、released=fact、deprecated=warn（弃用提醒非错误）；fail-safe 按 draft", () => {
    expect(versionStatusDisplay("draft")).toEqual({ label: TERM.VERSION_DRAFT, tone: "neutral" });
    expect(versionStatusDisplay("released").tone).toBe("fact");
    expect(versionStatusDisplay("deprecated").tone).toBe("warn");
    expect(versionStatusDisplay("nope").label).toBe(TERM.VERSION_DRAFT);
  });
});

describe("status-display 域：fail-safe 与值域守卫", () => {
  it("非法/缺省回落各机待处理态（与 reviewStatusDisplay 同思路）", () => {
    expect(approvalStatusDisplay("garbage").label).toBe(TERM.APPROVAL_PENDING);
    expect(approvalStatusDisplay(undefined).tone).toBe("warn");
    expect(standardizationStatusDisplay("nope").label).toBe(TERM.STANDARDIZATION_PENDING);
    expect(articleTaskStatusDisplay(null).label).toBe(TERM.TASK_AWAITING_ARCHITECT);
    expect(admissionStatusDisplay("nope").label).toBe(TERM.ADMISSION_PENDING);
  });

  it("准入值域守卫：两真值收口、其他拒绝", () => {
    expect(isAdmissionStatusValue("APPROVED")).toBe(true);
    expect(isAdmissionStatusValue("PENDING")).toBe(true);
    expect(isAdmissionStatusValue("REJECTED")).toBe(false); // PD-5：死值退役后不再是受控值
    expect(isAdmissionStatusValue("approved")).toBe(false);
  });
});
