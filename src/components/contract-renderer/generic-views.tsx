import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CONTRACT_RENDERER_COPY } from "@/components/components-copy";
import { TERM } from "@/constants/term-const";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { Input } from "@/components/ui/input";
import {
  impactText,
  renderContractValue,
  rowValue,
  type ContractActionContext,
  type ContractField,
  type ContractRow,
  type ScreenButton,
  type ScreenContract,
  type ScreenSection,
} from "@/lib/contract-renderer";

export type GenericContractViewProps = {
  screen: ScreenContract;
  fields: ContractField[];
  rows: ContractRow[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  busy?: boolean;
  form?: {
    title: string;
    values: Record<string, unknown>;
    onChange: (name: string, value: unknown) => void;
    onCancel: () => void;
    readOnlyFields?: string[];
  } | null;
  detailValues?: Record<string, unknown> | null;
  forbiddenReason?: string | null;
  retiredMessage?: string | null;
  ariaLabel: string;
  onAction: (context: ContractActionContext) => void;
};

const SYSTEM_LABELS: Record<string, string> = {
  id: "ID",
  individualId: CONTRACT_RENDERER_COPY.SYSTEM_LABELS.individualId,
  title: CONTRACT_RENDERER_COPY.SYSTEM_LABELS.title,
  revision: CONTRACT_RENDERER_COPY.SYSTEM_LABELS.revision,
};

function ActionButton({ button, row, busy, onAction }: { button: ScreenButton; row?: ContractRow; busy: boolean; onAction: GenericContractViewProps["onAction"] }) {
  const unavailable = button.availability.allowed !== true || button.confirmation === "block" || button.confirmation === "approve";
  const reason = button.confirmation === "block"
    ? CONTRACT_RENDERER_COPY.RISK_BLOCKED
    : button.confirmation === "approve"
      ? CONTRACT_RENDERER_COPY.APPROVAL_REQUIRED
      : button.availability.reason || (button.availability.allowed === null ? CONTRACT_RENDERER_COPY.AVAILABILITY_UNKNOWN : null);
  const description = impactText(button);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={button.action_id.endsWith(".retire") ? "outline" : "default"}
        disabled={busy || unavailable}
        title={reason || description || undefined}
        onClick={() => {
          if (button.confirmation === "confirm" && !window.confirm(`${button.label_cn}\n${description}`)) return;
          onAction({ action: button, row });
        }}
      >
        {button.label_cn}
      </Button>
      {description ? <span className="max-w-64 text-kg-xs leading-4 text-text-hint">{description}</span> : null}
      {reason ? <span className="text-kg-xs text-status-warn">{reason}</span> : null}
    </span>
  );
}

function FieldControl({ field, widget, value, disabled, onChange }: { field: ContractField; widget?: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const control = widget || field.type;
  if (control === "boolean" || control === "bool" || control === "checkbox") {
    return <Checkbox checked={Boolean(value)} disabled={disabled} onCheckedChange={(checked) => onChange(checked === true)} aria-label={field.display} />;
  }
  if (control === "textarea") {
    return (
      <textarea
        aria-label={field.display}
        required={field.required}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-20 w-full max-w-md rounded-md bg-surface-root px-3 py-2 text-sm text-text-main ring-1 ring-border-thin focus:outline-none focus:ring-2 focus:ring-accent"
      />
    );
  }
  const numeric = ["integer", "float", "decimal", "unsigned integer", "number"].includes(control);
  const array = ["list", "array"].includes(control);
  return (
    <Input
      type={numeric ? "number" : "text"}
      aria-label={field.display}
      required={field.required}
      value={array ? (Array.isArray(value) ? value.join(", ") : "") : String(value ?? "")}
      disabled={disabled}
      onChange={(event) => {
        if (numeric) onChange(event.target.value === "" ? undefined : Number(event.target.value));
        else if (array) onChange(event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean));
        else onChange(event.target.value);
      }}
      className="h-8 w-full max-w-md"
    />
  );
}

function orderedFields(section: ScreenSection, order: string[]): string[] {
  return [...section.fields].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
  });
}

function fieldLabel(fields: ContractField[], name: string): string {
  return fields.find((field) => field.name === name)?.display || SYSTEM_LABELS[name] || name;
}

function SectionValues({ section, order, fields, values }: { section: ScreenSection; order: string[]; fields: ContractField[]; values: Record<string, unknown> }) {
  return (
    <section key={section.id} className="space-y-2">
      <h3 className="text-xs font-medium text-text-main">{section.title_cn}</h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-kg-xs">
        {orderedFields(section, order).map((name) => (
          <div key={name} className="contents">
            <dt className="text-text-hint">{fieldLabel(fields, name)}</dt>
            <dd className="whitespace-pre-wrap text-text-main">{renderContractValue(values[name])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function GenericContractView({
  screen,
  fields,
  rows,
  loading = false,
  error = null,
  onRetry,
  busy = false,
  form = null,
  detailValues = null,
  forbiddenReason = null,
  retiredMessage = null,
  ariaLabel,
  onAction,
}: GenericContractViewProps) {
  const fieldMap = new Map(fields.map((field) => [field.name, field]));
  const columns: Array<Column<ContractRow>> = (screen.list?.columns || []).map((name) => ({
    key: name,
    title: fieldLabel(fields, name),
    render: (row) => renderContractValue(rowValue(row, name)),
  }));
  const rowButtons = screen.buttons.filter((button) => button.placement === "row" || button.placement === "menu");
  if (rowButtons.length) {
    columns.push({
      key: "__actions",
      title: CONTRACT_RENDERER_COPY.ACTIONS,
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          {rowButtons.map((button) => <ActionButton key={`${button.action_id}:${button.label_cn}`} button={button} row={row} busy={busy} onAction={onAction} />)}
        </div>
      ),
    });
  }
  const filteredRows = rows.filter((row) => (screen.list?.filters || []).every((filter) => {
    const actual = rowValue(row, filter.field);
    if (filter.operator === "contains") return renderContractValue(actual).includes(String(filter.value ?? ""));
    return actual === filter.value;
  }));
  const sort = screen.list?.default_sort;
  const sortedRows = sort ? [...filteredRows].sort((left, right) => {
    const a = renderContractValue(rowValue(left, sort.field));
    const b = renderContractValue(rowValue(right, sort.field));
    return (a.localeCompare(b, "zh-CN") || left.id.localeCompare(right.id)) * (sort.direction === "desc" ? -1 : 1);
  }) : filteredRows;
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {screen.buttons.filter((button) => button.placement === "toolbar").map((button) => (
        <ActionButton key={`${button.action_id}:${button.label_cn}`} button={button} busy={busy} onAction={onAction} />
      ))}
    </div>
  );
  const empty = screen.empty;
  const primary = empty.primary_action_id ? screen.buttons.find((button) => button.action_id === empty.primary_action_id) : null;
  const emptyGuide = empty.guide ? `${empty.guide.what}——${CONTRACT_RENDERER_COPY.EMPTY_GUIDE_WHERE}${empty.guide.where}${CONTRACT_RENDERER_COPY.EMPTY_GUIDE_SUFFIX}` : TERM.EMPTY_DATA;

  return (
    <div className="space-y-3">
      {forbiddenReason ? <Alert variant="warn">{screen.states.forbidden.message_cn}{forbiddenReason ? `：${forbiddenReason}` : ""}</Alert> : null}
      {retiredMessage ? <Alert variant="error">{retiredMessage || screen.states.retired.message_cn}</Alert> : null}
      {form && screen.form ? (
        <div className="space-y-3 rounded-lg bg-surface-root p-3 ring-1 ring-border-thin">
          <h3 className="text-xs font-medium text-text-main">{form.title}</h3>
          {screen.form.sections.map((section) => (
            <section key={section.id} className="space-y-2">
              <h4 className="text-kg-xs font-medium text-text-hint">{section.title_cn}</h4>
              {orderedFields(section, screen.form!.field_order).map((name) => {
                const field = fieldMap.get(name) || { name, display: name, required: false, type: "text", declared: false };
                const widget = screen.form?.widget_overrides?.find((override) => override.field === name)?.widget;
                return (
                  <label key={name} className="block">
                    <span className="mb-1 block text-kg-xs text-text-hint">{field.display}{field.required ? <span className="ml-1 text-status-error">*</span> : null}</span>
                    <FieldControl field={field} widget={widget} value={form.values[name]} disabled={busy || Boolean(form.readOnlyFields?.includes(name))} onChange={(value) => form.onChange(name, value)} />
                  </label>
                );
              })}
            </section>
          ))}
          <div className="flex flex-wrap gap-2">
            {screen.buttons.filter((button) => button.placement === "detail").map((button) => (
              <ActionButton key={`${button.action_id}:${button.label_cn}`} button={button} busy={busy} onAction={onAction} />
            ))}
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={form.onCancel}>{TERM.CANCEL_ACTION}</Button>
          </div>
        </div>
      ) : null}
      {detailValues && screen.detail ? (
        <div className="space-y-3 rounded-lg bg-surface-root p-3 ring-1 ring-border-thin">
          {screen.detail.sections.map((section) => <SectionValues key={section.id} section={section} order={screen.detail!.sections.flatMap((item) => item.fields)} fields={fields} values={detailValues} />)}
        </div>
      ) : null}
      {!loading && !error && !retiredMessage && sortedRows.length === 0 ? (
        <EmptyState
          variant={empty.variant}
          title={empty.guide?.what || TERM.EMPTY_DATA}
          description={emptyGuide}
          action={primary ? <ActionButton button={primary} busy={busy} onAction={onAction} /> : null}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={sortedRows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={screen.states.error.retry ? onRetry : undefined}
          loadingLabel={screen.states.loading.label_cn}
          toolbar={toolbar}
          ariaLabel={ariaLabel}
        />
      )}
    </div>
  );
}
