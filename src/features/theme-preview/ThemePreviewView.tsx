// ── 主题预览页（PR-025 阶段 4，契约 §四「可感知验收」的载体）──
// 用途：改 L0 token 后刷新本页目检全站视觉语言是否如期变化。
// 面向：非编码经验者。操作闭环 = 改 src/index.css 的 :root 里一个值 → 刷新本页 → 看。
// 仅 DEV 构建可路由（import.meta.env.DEV 门禁，见 App.tsx getNavFromHash/VIEWS）。
// 禁令自检：本页所有颜色引用一律走 L1 语义 token / Tailwind 语义类，零字面值——
// 它本身就是门禁 check:theme-tokens 的执法对象之一。
// WP-036：9 个散写 section 收编为 Panel（D9），页面骨架走 PageContainer。
// WP-147 二期尾项：用户可见中文全部收编至页级文案单源 theme-preview-copy.ts
// （ADR-019 §三.4 闭集仪式），本文件只持 token 名单与结构——预览镜像对账
// （check-theme-vocab §⑦）按本文件原文执法，token 名串不得迁走。
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, LoaderCircle, Lightbulb, GitFork } from "lucide-react";
import { useMode, type ModeKind } from "@/hooks/use-mode";
import { PageContainer } from "@/components/page-container";
import { Panel } from "@/components/panel";
import { BentoGrid, BentoCard } from "@/components/bento";
import { Statistic } from "@/components/statistic";
import {
  ACCENT_SAMPLES,
  BENTO_SAMPLES,
  CATEGORY_SAMPLES,
  DEPTH_SAMPLES,
  FONT_SAMPLES,
  MODE_LABELS,
  PANEL_TITLES,
  RADIUS_NOTES,
  STATUS_BADGES,
  STEP_ROLE_INTRO,
  STEP_ROLE_SAMPLES,
  TABLE_DEMO,
  TABLE_LIST_HINT,
  TABLE_SCALE_LABELS,
  TABLE_TOKEN_NOTES,
  TOKEN_GROUP_TITLES,
  TOKEN_ROLE_DESCS,
  TYPE_SCALE_SAMPLES,
  resolvedModeText,
  tableMetaText,
  STATUS_STEP_INTRO,
  STATUS_STEP_NOTES,} from "./theme-preview-copy";

const STATUS_STEP_TOKENS: [string, string][] = [
  ["--color-status-fact-2", STATUS_STEP_NOTES.s2],
  ["--color-status-fact-3", STATUS_STEP_NOTES.s3],
  ["--color-status-fact-6", STATUS_STEP_NOTES.s6],
  ["--color-status-fact-11", STATUS_STEP_NOTES.s11],
  ["--color-status-warn-2", STATUS_STEP_NOTES.s2],
  ["--color-status-warn-3", STATUS_STEP_NOTES.s3],
  ["--color-status-warn-4", STATUS_STEP_NOTES.s4],
  ["--color-status-warn-6", STATUS_STEP_NOTES.s6],
  ["--color-status-warn-7", STATUS_STEP_NOTES.s7],
  ["--color-status-warn-8", STATUS_STEP_NOTES.s8],
  ["--color-status-warn-11", STATUS_STEP_NOTES.s11],
  ["--color-status-error-2", STATUS_STEP_NOTES.s2],
  ["--color-status-error-3", STATUS_STEP_NOTES.s3],
  ["--color-status-error-6", STATUS_STEP_NOTES.s6],
  ["--color-status-error-7", STATUS_STEP_NOTES.s7],
  ["--color-status-error-11", STATUS_STEP_NOTES.s11],
  ["--color-status-loading-2", STATUS_STEP_NOTES.s2],
  ["--color-status-loading-6", STATUS_STEP_NOTES.s6],
];

/** L1 token 目录：唯一事实源 index.css 的镜像清单（人工维护，改 token 后同步）。
 *  token 名单住本文件（镜像对账按原文执法），角色/说明文案住 theme-preview-copy。 */
const TOKEN_SECTIONS: { group: string; items: [string, string, string][] }[] = [
  {
    group: TOKEN_GROUP_TITLES.surface,
    items: [
      ["--color-surface-root", ...TOKEN_ROLE_DESCS.surfaceRoot],
      ["--color-surface-card", ...TOKEN_ROLE_DESCS.surfaceCard],
      ["--color-surface-hover", ...TOKEN_ROLE_DESCS.surfaceHover],
      ["--color-surface-alter", ...TOKEN_ROLE_DESCS.surfaceAlter],
    ],
  },
  {
    group: TOKEN_GROUP_TITLES.text,
    items: [
      ["--color-text-main", ...TOKEN_ROLE_DESCS.textMain],
      ["--color-text-sub", ...TOKEN_ROLE_DESCS.textSub],
      ["--color-text-hint", ...TOKEN_ROLE_DESCS.textHint],
      ["--color-text-placeholder", ...TOKEN_ROLE_DESCS.textPlaceholder],
    ],
  },
  {
    group: TOKEN_GROUP_TITLES.accent,
    items: [
      ["--color-accent-base", ...TOKEN_ROLE_DESCS.accentBase],
      ["--color-accent-bg", ...TOKEN_ROLE_DESCS.accentBg],
      ["--color-accent-bg-strong", ...TOKEN_ROLE_DESCS.accentBgStrong],
      ["--color-accent-contrast", ...TOKEN_ROLE_DESCS.accentContrast],
      ["--color-accent-fg", ...TOKEN_ROLE_DESCS.accentFg],
      ["--color-border-focus", ...TOKEN_ROLE_DESCS.borderFocus],
      ["--color-border-thin", ...TOKEN_ROLE_DESCS.borderThin],
      ["--color-border-soft", ...TOKEN_ROLE_DESCS.borderSoft],
    ],
  },
  {
    group: TOKEN_GROUP_TITLES.status,
    items: [
      ["--color-status-fact", ...TOKEN_ROLE_DESCS.statusFact],
      ["--color-status-inferred", ...TOKEN_ROLE_DESCS.statusInferred],
      ["--color-status-warn", ...TOKEN_ROLE_DESCS.statusWarn],
      ["--color-status-error", ...TOKEN_ROLE_DESCS.statusError],
      ["--color-status-loading", ...TOKEN_ROLE_DESCS.statusLoading],
    ],
  },
  {
    group: TOKEN_GROUP_TITLES.line,
    items: [
      ["--color-line-edge", ...TOKEN_ROLE_DESCS.lineEdge],
      ["--color-line-faint", ...TOKEN_ROLE_DESCS.lineFaint],
      ["--color-line-subtle", ...TOKEN_ROLE_DESCS.lineSubtle],
      ["--color-grid-line", ...TOKEN_ROLE_DESCS.gridLine],
      ["--color-grid-line-strong", ...TOKEN_ROLE_DESCS.gridLineStrong],
    ],
  },
  {
    group: TOKEN_GROUP_TITLES.glass,
    items: [
      ["--color-overlay", ...TOKEN_ROLE_DESCS.overlay],
      ["--color-glass", ...TOKEN_ROLE_DESCS.glass],
    ],
  },
];

/** 圆角档位（PR-026 起 --radius-panel 为首个语义名档位；
 *  --radius-xs/--radius-pill 随收官存量清零批退役——单消费者改字面/零消费）。
 *  token 名单住本文件（radius 族镜像执法面），文案住 theme-preview-copy。 */
const RADIUS_SAMPLES: [string, string][] = [
  ["--radius-sm", RADIUS_NOTES.sm],
  ["--radius-md", RADIUS_NOTES.md],
  ["--radius-lg", RADIUS_NOTES.lg],
  ["--radius-panel", RADIUS_NOTES.panel],
  ["--radius-xl", RADIUS_NOTES.xl],
];

function Swatch({ token, note }: { token: string; note?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-9 w-9 shrink-0 rounded-md ring-1 ring-border-thin"
        style={{ background: `var(${token})` }}
        aria-hidden
      />
      <code className="font-mono text-xs text-text-sub">{token}</code>
      {note ? <span className="text-xs text-text-hint">{note}</span> : null}
    </div>
  );
}

/** 表格组件 token（P0 首批 L2）：镜像清单——门禁预览对账（检查⑦）的 table 族事实源。
 *  token 名单住本文件（table 族镜像执法面），文案住 theme-preview-copy。 */
const TABLE_TOKENS: [string, string][] = [
  ["--table-cell-py-lg / --table-cell-px-lg", TABLE_TOKEN_NOTES.cellLg],
  ["--table-cell-py-md / --table-cell-px-md", TABLE_TOKEN_NOTES.cellMd],
  ["--table-cell-py-sm / --table-cell-px-sm", TABLE_TOKEN_NOTES.cellSm],
  ["--table-cell-py / --table-cell-px", TABLE_TOKEN_NOTES.cellCurrent],
  ["--table-font-size", TABLE_TOKEN_NOTES.fontSize],
  ["--table-line-height", TABLE_TOKEN_NOTES.lineHeight],
  ["--table-radius", TABLE_TOKEN_NOTES.radius],
  ["--table-toolbar-height", TABLE_TOKEN_NOTES.toolbarHeight],
  ["--table-selection-width", TABLE_TOKEN_NOTES.selectionWidth],
  ["--table-pagination-height / --table-pagination-height-sm", TABLE_TOKEN_NOTES.paginationHeight],
  ["--table-state-padding", TABLE_TOKEN_NOTES.statePadding],
  ["--table-action-gap", TABLE_TOKEN_NOTES.actionGap],
  ["--table-sticky-z", TABLE_TOKEN_NOTES.stickyZ],
  ["--table-sticky-corner-z", TABLE_TOKEN_NOTES.stickyCornerZ],
  ["--table-fixed-shadow-left / --table-fixed-shadow-right", TABLE_TOKEN_NOTES.fixedShadow],
];

function TableScaleSample({ density, label }: { density: "lg" | "md" | "sm"; label: string }) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-text-hint">{label}</span>
      <div className="data-table" data-density={density}>
        <div className="data-table__toolbar">
          <span className="text-xs text-text-sub">{TABLE_DEMO.toolbar}</span>
        </div>
        <div className="data-table__scroll">
          <table className="data-table__table">
            <thead className="data-table__thead">
              <tr>
                <th className="data-table__th">{TABLE_DEMO.colA}</th>
                <th className="data-table__th">{TABLE_DEMO.colB}</th>
                <th className="data-table__th">{TABLE_DEMO.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="data-table__row data-table__row--interactive" tabIndex={0}>
                <td className="data-table__td">{TABLE_DEMO.rowFocus}</td>
                <td className="data-table__td">12</td>
                <td className="data-table__td">{TABLE_DEMO.cellFact}</td>
              </tr>
              <tr className="data-table__row">
                <td className="data-table__td">{TABLE_DEMO.cellHover}</td>
                <td className="data-table__td">34</td>
                <td className="data-table__td">{TABLE_DEMO.cellInferred}</td>
              </tr>
              <tr className="data-table__row">
                <td className="data-table__td" colSpan={3}>
                  <div className="data-table__state">{TABLE_DEMO.stateArea}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="data-table__meta">{tableMetaText(density)}</div>
      </div>
    </div>
  );
}

export function ThemePreviewView() {
  const { mode, setMode, resolved } = useMode();
  return (
    <PageContainer>

      {/* 显示模式四态切换（PR②）：切档即时全站生效；默认跟随系统，手动选择存 localStorage */}
      <Panel title={PANEL_TITLES.mode}>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(MODE_LABELS) as ModeKind[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? "rounded-md bg-accent-base px-3 py-1.5 text-xs font-medium text-accent-contrast"
                  : "rounded-md border border-border-thin px-3 py-1.5 text-xs text-text-sub transition-colors hover:bg-surface-hover hover:text-text-main"
              }
            >
              {MODE_LABELS[m]}
            </button>
          ))}
          <span className="ml-2 text-xs text-text-hint">{resolvedModeText(resolved, mode === "auto")}</span>
        </div>
      </Panel>

      {/* 表格尺度（P0）：三档密度实样＋L2 token 清单——暖色模式下表头可见性为本页重点目检项 */}
      <Panel title={PANEL_TITLES.tableScale}>
        <div className="grid gap-4 md:grid-cols-3">
          <TableScaleSample density="lg" label={TABLE_SCALE_LABELS.lg} />
          <TableScaleSample density="md" label={TABLE_SCALE_LABELS.md} />
          <TableScaleSample density="sm" label={TABLE_SCALE_LABELS.sm} />
        </div>
        <div className="mt-4 border-t border-border-soft pt-3">
          <div className="mb-2 text-xs text-text-hint">{TABLE_LIST_HINT}</div>
          <ul className="grid gap-1 md:grid-cols-2">
            {TABLE_TOKENS.map(([token, note]) => (
              <li key={token} className="flex items-baseline gap-2">
                <code className="font-mono text-xs text-text-sub">{token}</code>
                <span className="text-xs text-text-hint">{note}</span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* 状态徽章样例：契约禁令 4（文字+图形并用，颜色只是第三重冗余） */}
      <Panel title={PANEL_TITLES.status}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-status-fact-2 px-2.5 py-0.5 text-xs text-status-fact ring-1 ring-status-fact-6">
            <CheckCircle2 className="h-4 w-4" />{STATUS_BADGES.fact}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-status-warn-2 px-2.5 py-0.5 text-xs text-status-warn ring-1 ring-status-warn-6">
            <AlertCircle className="h-4 w-4" />{STATUS_BADGES.warn}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-status-error-2 px-2.5 py-0.5 text-xs text-status-error ring-1 ring-status-error-6">
            <AlertCircle className="h-4 w-4" />{STATUS_BADGES.error}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-status-loading-2 px-2.5 py-0.5 text-xs text-status-loading ring-1 ring-status-loading-6">
            <LoaderCircle className="h-4 w-4" />{STATUS_BADGES.loading}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-status-inferred/10 px-2.5 py-0.5 text-xs text-status-inferred ring-1 ring-status-inferred/20">
            <Lightbulb className="h-4 w-4" />{STATUS_BADGES.inferred}
          </span>
        </div>
      </Panel>

            {/* 状态色档桥（WP-147 scope_revision 3：携带式 alpha → step 封闭类；夜间随 .dark 换 vendor dark palette） */}
      <Panel title={PANEL_TITLES.statusSteps}>
        <p className="mb-3 text-xs text-text-hint">{STATUS_STEP_INTRO}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {STATUS_STEP_TOKENS.map(([token, note]) => (
            <Swatch key={token} token={token} note={note} />
          ))}
        </div>
      </Panel>

{/* 主操作语言 */}
      <Panel title={PANEL_TITLES.accent}>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">{ACCENT_SAMPLES.primary}</Button>
          <Button size="sm" variant="secondary">{ACCENT_SAMPLES.secondary}</Button>
          <button type="button" className="rounded-md bg-accent-bg px-3 py-1.5 text-xs text-accent-base transition-colors hover:bg-accent-bg-strong">
            {ACCENT_SAMPLES.softBg}
          </button>
          <Badge variant="outline">{ACCENT_SAMPLES.countBadge}</Badge>
        </div>
      </Panel>

      {/* 字体家族（W4：Nunito 标题圆润粗体 + Inter 正文；--font-* 恒定侧） */}
      <Panel title={PANEL_TITLES.fontFamily}>
        <div className="flex flex-wrap items-end gap-8">
          <div className="space-y-1">
            <div className="font-display text-xl font-semibold text-text-main">{FONT_SAMPLES.display}</div>
            <code className="font-mono text-xs text-text-hint">{FONT_SAMPLES.displayHint}</code>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-text-sub">{FONT_SAMPLES.body}</div>
            <code className="font-mono text-xs text-text-hint">{FONT_SAMPLES.bodyHint}</code>
          </div>
        </div>
      </Panel>

      <Panel title={PANEL_TITLES.typeScale}>
        <div className="flex flex-wrap items-end gap-8">
          <div className="space-y-1">
            <div className="font-display text-2xl font-bold text-text-main">{TYPE_SCALE_SAMPLES.text2xl}</div>
            <code className="font-mono text-xs text-text-hint">text-2xl · 28px</code>
          </div>
          <div className="space-y-1">
            <div className="font-display text-3xl font-bold text-text-main">{TYPE_SCALE_SAMPLES.text3xl}</div>
            <code className="font-mono text-xs text-text-hint">text-3xl · 32px</code>
          </div>
          <div className="space-y-1">
            <div className="font-display text-5xl font-bold text-text-main">{TYPE_SCALE_SAMPLES.text5xl}</div>
            <code className="font-mono text-xs text-text-hint">text-5xl · 48px</code>
          </div>
        </div>
      </Panel>

      <Panel title={PANEL_TITLES.bento}>
        <BentoGrid className="mb-4">
          <BentoCard colSpan={2} title={BENTO_SAMPLES.mainTitle} description={BENTO_SAMPLES.mainDesc}>
            <p className="text-sm text-text-sub">{BENTO_SAMPLES.mainBody}</p>
          </BentoCard>
          <BentoCard title={BENTO_SAMPLES.subTitle}>
            <p className="text-sm text-text-sub">{BENTO_SAMPLES.subBody}</p>
          </BentoCard>
        </BentoGrid>
        <BentoGrid>
          <Statistic size="xl" label={BENTO_SAMPLES.statXl} value={1234} />
          <Statistic size="lg" label={BENTO_SAMPLES.statLg} value={321} />
          <Statistic label={BENTO_SAMPLES.statStd} value={45} />
        </BentoGrid>
      </Panel>

      {/* Token 目录 */}
      {TOKEN_SECTIONS.map((section) => (
        <Panel key={section.group} title={section.group}>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.items.map(([token, role, desc]) => (
              <Swatch key={token} token={token} note={`${role} · ${desc}`} />
            ))}
          </div>
        </Panel>
      ))}

      {/* 分类色抽样（WP-147 连名换装：--color-<族>-<step>；文案与 step 词清单住 theme-preview-copy） */}
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <GitFork className="h-4 w-4 text-text-hint" />{PANEL_TITLES.category}
          </span>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CATEGORY_SAMPLES.map(([token, note]) => (
            <Swatch key={token} token={token} note={note} />
          ))}
        </div>
        <div className="mt-4 border-t border-border-thin pt-4">
          <p className="mb-3 text-xs text-text-hint">{STEP_ROLE_INTRO}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {STEP_ROLE_SAMPLES.map(([token, note]) => (
              <Swatch key={token} token={token} note={note} />
            ))}
          </div>
        </div>
      </Panel>

      {/* 圆角档位 */}
      <Panel title={PANEL_TITLES.radius}>
        <div className="flex flex-wrap items-center gap-4">
          {RADIUS_SAMPLES.map(([token, note]) => (
            <div key={token} className="flex items-center gap-2">
              <div aria-hidden className="h-9 w-9 shrink-0 bg-accent-bg ring-1 ring-border-thin" style={{ borderRadius: `var(${token})` }} />
              <div className="text-xs">
                <code className="font-mono text-xs text-text-sub">{token}</code>
                <span className="ml-1.5 text-text-hint">{note}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* 深度层 */}
      <Panel title={PANEL_TITLES.depth}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-lg bg-glass px-4 py-2 text-xs text-text-main ring-1 ring-border-thin">{DEPTH_SAMPLES.glass}</div>
          <div className="rounded-lg bg-surface-root px-4 py-2 text-xs text-text-sub ring-1 ring-border-thin shadow-card">{DEPTH_SAMPLES.shadow}</div>
          <div className="rounded-md border border-border-focus px-4 py-2 text-xs text-text-sub">{DEPTH_SAMPLES.focusRing}</div>
        </div>
      </Panel>
    </PageContainer>
  );
}
