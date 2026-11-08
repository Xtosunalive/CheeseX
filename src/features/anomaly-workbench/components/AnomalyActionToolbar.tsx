import { useMemo } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ArticleGroup } from "@/features/anomaly-workbench/anomaly-article-groups";
import { projectActionsForIssues, selectIssuesForKeys, type AnomalyActionKind, type ProjectedAction } from "@/features/anomaly-workbench/anomaly-action-registry";
import { ACTION_TOOLBAR_JUMP_TRIGGER_LABEL, actionToolbarJumpTriggerAriaLabel, ANOMALY_TOOLBAR_COPY } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { safeNavigateHash } from "@/lib/navigation";

type AnomalyActionToolbarProps = {
  groups: ArticleGroup[];
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onAction: (kind: AnomalyActionKind, issues: ProjectedAction["issueIds"]) => void;
};

export function AnomalyActionToolbar({ groups, selectedKeys, onSelectionChange, onAction }: AnomalyActionToolbarProps) {
  const selectedIssues = useMemo(() => selectIssuesForKeys(groups, selectedKeys), [groups, selectedKeys]);
  const projectedActions = useMemo(() => projectActionsForIssues(selectedIssues), [selectedIssues]);

  // 整改 5：空态不渲染（原型 selbar 语义——无选中集整条浮层不存在，含全选框与占位文案）
  if (selectedIssues.length === 0) return null;

  const handleAction = (action: ProjectedAction) => {
    if (action.scope === "handoff" && action.hash) {
      safeNavigateHash(action.hash);
      return;
    }
    onAction(action.kind, action.issueIds);
  };

  // WP-146 件3（Master 清单 #13 裁定）：动作条分主次，不再 9 钮同形态纵排——
  // ①主操作＝registry scope=in-page 的页内执行类（补齐字段/修复关系/待裁决占位）：实心主钮直点；
  // ②次操作＝scope=handoff 的跳转类：收纳进「前往处理」下拉（现成 dropdown-menu 件，向上展开）；
  // ANOMALY_ACTION_PRIORITY 排序保留：两类内部仍按优先级次序呈现。
  const primaryActions = projectedActions.filter((action) => action.scope !== "handoff");
  const handoffActions = projectedActions.filter((action) => action.scope === "handoff");

  // 形态（Master 2026-10-16 两轮裁定参照 antd FloatButton/FloatButtonGroup）：
  // ①viewport 常驻固定（position:fixed——不随内容滚，锚点＝antd 默认 insetBlockEnd=marginXXL(48px)/
  // insetInlineEnd=marginLG(24px)）；②层级高于模块卡片（z-docked：压卡片与吸顶表头，低于弹层 50）；
  // ③elevated 中性药丸纵排（antd size 40/boxShadowSecondary/colorBgElevated→本仓 surface-card＋shadow-card）；
  // 主钮＝icon＋选中数（description 形）。空态不渲染不变（整改5 裁定＋测试钉住）。
  return (
    <div
      role="toolbar"
      aria-label={ANOMALY_TOOLBAR_COPY.ARIA}
      className="pointer-events-auto fixed bottom-12 right-6 z-docked flex w-fit flex-col items-end gap-1.5"
    >
      {primaryActions.map((action) => (
        <Button
          key={action.kind}
          onClick={() => onAction(action.kind, action.issueIds)}
          className="h-10 rounded-md bg-accent-base px-3 text-xs font-medium text-accent-contrast shadow-card hover:bg-accent-base/90"
        >
          {action.label}
        </Button>
      ))}

      {handoffActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label={actionToolbarJumpTriggerAriaLabel(handoffActions.length)}
              className="h-10 rounded-md bg-surface-card px-3 text-xs font-medium text-text-main shadow-card ring-1 ring-border-thin hover:bg-surface-hover"
            >
              {ACTION_TOOLBAR_JUMP_TRIGGER_LABEL}
              <ChevronDown aria-hidden className="ml-1 h-4 w-4 text-text-hint" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end">
            {handoffActions.map((action) => (
              <DropdownMenuItem key={action.kind} onSelect={() => handleAction(action)}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="ghost"
        onClick={() => onSelectionChange([])}
        className="h-10 rounded-md bg-surface-card px-3 text-xs font-medium text-text-sub shadow-card ring-1 ring-border-thin hover:bg-surface-hover hover:text-text-main"
      >
        {ANOMALY_TOOLBAR_COPY.CLEAR_ACTION}
      </Button>

      <div className="flex h-10 items-center gap-2 rounded-xl bg-accent-base px-3 text-xs text-accent-contrast shadow-card">
        <ListChecks aria-hidden className="h-4 w-4" />
        <span className="tabular-nums"><span className="font-medium">{selectedKeys.length}</span>{ANOMALY_TOOLBAR_COPY.SELECTED_SUFFIX}</span>
      </div>
    </div>
  );
}
